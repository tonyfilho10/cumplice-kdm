import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseOFX } from '@/lib/parsers/ofx'
import { parseCSV } from '@/lib/parsers/csv'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { verificarPeriodoAberto } from '@/lib/supabase/periodo-guard'
import { conciliarPeriodo } from '@/lib/conciliar'
import { categoriaOFXParaDespesa } from '@/lib/extrato-para-despesas'
import { cruzarFornecedores } from '@/lib/matching/fornecedores'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params

  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const periodo = formData.get('periodo') as string
    const conta = (formData.get('conta') as string) || null

    if (!file)    return NextResponse.json({ erro: 'Arquivo não enviado' }, { status: 400 })
    if (!periodo) return NextResponse.json({ erro: 'Período obrigatório' }, { status: 400 })

    const periodoGuard = await verificarPeriodoAberto(clienteId, periodo)
    if (!periodoGuard.ok) return periodoGuard.response

    // Decode respeitando a codificação do arquivo
    let content: string
    const buffer = await file.arrayBuffer()
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      content = new TextDecoder('windows-1252').decode(buffer)
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    let lancamentos: ReturnType<typeof parseCSV>

    if (ext === 'ofx') {
      const resultado = parseOFX(content)
      if (resultado.erro) {
        return NextResponse.json({ erro: resultado.erro }, { status: 422 })
      }
      lancamentos = resultado.lancamentos
    } else {
      lancamentos = parseCSV(content)
    }

    const total_lidos = lancamentos.length

    if (total_lidos === 0) {
      return NextResponse.json({
        inseridos: 0, total_lidos: 0,
        aviso: 'Nenhuma transação pôde ser lida do arquivo.',
      })
    }

    // Verifica duplicatas pelo hash data+valor+descricao+conta para este cliente
    // Busca lançamentos existentes nos períodos presentes no arquivo
    const periodosNoArquivo = [...new Set(lancamentos.map(l => l.data.substring(0, 7)))]
    const existentes = await prisma.bancoLancamento.findMany({
      where: {
        cliente_id: clienteId,
        periodo: { in: periodosNoArquivo },
        conta: conta,
      },
      select: { data: true, valor: true, descricao: true },
    })

    // Cria set de chaves existentes para comparação rápida
    const chaveExistente = new Set(
      existentes.map(e => `${e.data.toISOString().substring(0, 10)}|${Number(e.valor)}|${e.descricao}`)
    )

    const novos = lancamentos.filter(l => {
      const chave = `${l.data}|${l.valor}|${l.descricao}`
      return !chaveExistente.has(chave)
    })

    const duplicatas = lancamentos.length - novos.length

    if (novos.length === 0) {
      return NextResponse.json({
        inseridos: 0, total_lidos, duplicados_ignorados: duplicatas,
        aviso: `Todos os ${total_lidos} lançamentos já foram importados anteriormente.`,
      })
    }

    // Cada transação vai para o seu período real (data da transação)
    const criados = await prisma.bancoLancamento.createMany({
      data: novos.map(l => ({
        cliente_id: clienteId,
        periodo: l.data.substring(0, 7),
        data: new Date(l.data),
        descricao: l.descricao,
        categoria: l.categoria || null,
        tipo: l.tipo,
        valor: l.valor,
        status: 'pendente',
        conta,
      })),
      skipDuplicates: true,
    })

    // Conta por período para feedback
    const porPeriodo: Record<string, number> = {}
    for (const l of lancamentos) {
      const p = l.data.substring(0, 7)
      porPeriodo[p] = (porPeriodo[p] || 0) + 1
    }

    // ── Cria despesas automáticas para saídas identificadas ────────────────
    let despesasCriadas = 0
    for (const l of novos.filter(l => l.tipo === 'saida')) {
      const categoriaDespesa = categoriaOFXParaDespesa(l.categoria || null)
      if (!categoriaDespesa) continue

      const periodo = l.data.substring(0, 7)
      // Evita duplicata: verifica se já existe despesa com mesma data+valor+descrição
      const existente = await prisma.despesa.findFirst({
        where: { cliente_id: clienteId, periodo, data: new Date(l.data), valor: l.valor, descricao: l.descricao },
        select: { id: true },
      })
      if (existente) continue

      await prisma.despesa.create({
        data: {
          cliente_id: clienteId,
          periodo,
          data: new Date(l.data),
          descricao: l.descricao,
          categoria: categoriaDespesa,
          valor: l.valor,
          pago_banco: true,
          dedutivel: 'sim',
          conta_banco: conta, // conta bancária de origem
        },
      }).catch(() => {})
      despesasCriadas++
    }

    // ── Conciliação automática para cada período importado ──────────────────
    const resultadosConcil: Record<string, number> = {}
    for (const p of Object.keys(porPeriodo)) {
      try {
        const r = await conciliarPeriodo(clienteId, p)
        resultadosConcil[p] = r.conciliados
      } catch { /* não bloqueia se falhar */ }
    }

    // ── Cruzamento automático com contas a pagar de fornecedores ───────────
    let baixasFornecedores = 0
    try {
      const r = await cruzarFornecedores(clienteId, Object.keys(porPeriodo))
      baixasFornecedores = r.baixas
    } catch { /* não bloqueia importação se falhar */ }

    return NextResponse.json({
      inseridos: criados.count,
      total_lidos,
      por_periodo: porPeriodo,
      duplicados_ignorados: duplicatas + (novos.length - criados.count),
      conciliacoes: resultadosConcil,
      despesas_criadas: despesasCriadas,
      baixas_fornecedores: baixasFornecedores,
    })
  } catch (err) {
    console.error('[importar-banco]', err)
    return NextResponse.json({ erro: 'Erro interno ao processar arquivo' }, { status: 500 })
  }
}
