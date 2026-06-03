import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseNFeXML, parseEventoNFe } from '@/lib/parsers/nfe'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { verificarPeriodoAberto } from '@/lib/supabase/periodo-guard'
import { conciliarPeriodo } from '@/lib/conciliar'

// Aumenta limite de body para importação em lote
export const maxDuration = 60 // 60s no Netlify/Vercel

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    let body: { files: { nome: string; conteudo: string }[]; periodo: string }
    try {
      body = await request.json() as typeof body
    } catch (jsonErr) {
      console.error('[importar-nfe] falha ao parsear JSON do body:', jsonErr)
      return NextResponse.json({ erro: 'Corpo da requisição inválido — verifique o tamanho dos arquivos' }, { status: 400 })
    }

    const { files, periodo } = body!

    if (!periodo) return NextResponse.json({ erro: 'Período obrigatório' }, { status: 400 })
    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ erro: 'Nenhum arquivo recebido' }, { status: 400 })
    }

    const periodoGuard = await verificarPeriodoAberto(clienteId, periodo)
    if (!periodoGuard.ok) return periodoGuard.response

    console.log(`[importar-nfe] ${files.length} arquivo(s) recebido(s) — período: ${periodo}`)

    const importados: string[] = []
    const erros: { arquivo: string; erro: string; detalhe?: string }[] = []
    const duplicados: { arquivo: string; numero: string; motivo: string; detalhe: string }[] = []
    const cancelamentos: string[] = []

    // ── Processa em lotes de 10 em paralelo ───────────────────────────────
    const LOTE = 10
    for (let i = 0; i < files.length; i += LOTE) {
      const lote = files.slice(i, i + LOTE)

      await Promise.all(lote.map(async (file) => {
        try {
        const content = file.conteudo
        const nfe = await parseNFeXML(content)

        if (nfe.erro) {
          // Arquivos ignorados (consultas, inutilizações) — registra como info, não erro
          if (nfe.erro.startsWith('Arquivo ignorado:')) {
            console.log(`[importar-nfe] ignorado: ${file.nome} — ${nfe.erro}`)
            return
          }

          // Evento de cancelamento ou CCe — processa separadamente
          if (nfe.erro === '__evento__') {
            const evento = parseEventoNFe(content)
            if (!evento) {
              erros.push({ arquivo: file.nome, erro: 'Evento NF-e não reconhecido', detalhe: 'O arquivo parece ser um evento mas não foi possível extrair os dados' })
              return
            }
            if (evento.tipo === 'cancelamento' && evento.chave_nfe) {
              const nfExistente = await prisma.notaFiscal.findFirst({
                where: { chave_acesso: evento.chave_nfe, cliente_id: clienteId },
                select: { id: true, numero: true },
              })
              if (nfExistente) {
                await prisma.notaFiscal.update({ where: { id: nfExistente.id }, data: { cancelada: true } })
                cancelamentos.push(`NF ${nfExistente.numero} cancelada — ${evento.descricao}`)
              } else {
                cancelamentos.push(`Cancelamento para chave ${evento.chave_nfe.substring(0, 10)}... (NF não encontrada — importe a NF primeiro)`)
              }
            } else if (evento.tipo === 'carta_correcao') {
              cancelamentos.push(`Carta de Correção para chave ${evento.chave_nfe.substring(0, 10)}... — ${evento.descricao} (sem impacto nos valores)`)
            } else {
              cancelamentos.push(`Evento ${evento.descricao} recebido para ${file.nome} (sem ação necessária)`)
            }
            return
          }

          erros.push({
            arquivo: file.nome,
            erro: nfe.erro,
            detalhe: `Arquivo: ${file.nome} — verifique se o XML está correto e não está corrompido`,
          })
          return
        }

        const periodoNF = nfe.data_emissao?.substring(0, 7) || periodo
        if (!periodoNF) {
          erros.push({ arquivo: file.nome, erro: 'Data de emissão inválida', detalhe: 'O XML não contém data de emissão legível' })
          return
        }

        const dadosNF = {
          cliente_id: clienteId,
          periodo: periodoNF,
          data: new Date(nfe.data_emissao),
          numero: nfe.numero,
          chave_acesso: nfe.chave_acesso || null,
          cliente_nf: nfe.razao_destinatario || 'Consumidor Final',
          cfop: nfe.cfop,
          valor: nfe.valor_total,
          conciliada: false,
        }

        if (nfe.chave_acesso) {
          // NF-e: upsert por chave de acesso — escopo restrito ao cliente para não sobrescrever dados de outro cliente
          const existente = await prisma.notaFiscal.findFirst({
            where: { chave_acesso: nfe.chave_acesso, cliente_id: clienteId },
            select: { id: true },
          })
          if (existente) {
            await prisma.notaFiscal.update({ where: { id: existente.id }, data: dadosNF })
            duplicados.push({
              arquivo: file.nome,
              numero: nfe.numero ?? '?',
              motivo: 'Atualizada (já existia)',
              detalhe: `NF ${nfe.numero} | Período: ${periodoNF} | Valor: R$ ${nfe.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            })
            return
          }
        } else if (nfe.numero) {
          // NFS-e sem chave: dedup por número + período + destinatário
          const existente = await prisma.notaFiscal.findFirst({
            where: {
              cliente_id: clienteId, numero: nfe.numero, periodo: periodoNF, chave_acesso: null,
              ...(nfe.razao_destinatario ? { cliente_nf: nfe.razao_destinatario } : {}),
            },
            select: { id: true, valor: true },
          })
          if (existente) {
            await prisma.notaFiscal.update({ where: { id: existente.id }, data: dadosNF })
            duplicados.push({
              arquivo: file.nome,
              numero: nfe.numero,
              motivo: 'Atualizada (já existia)',
              detalhe: `NF ${nfe.numero} | Período: ${periodoNF} | Valor anterior: R$ ${Number(existente.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            })
            return
          }
        }

        await prisma.notaFiscal.create({ data: dadosNF })
        const label = nfe.formato === 'nfse' ? 'NFS-e' : 'NF-e'
        const aviso = periodoNF !== periodo ? ` → alocado em ${periodoNF}` : ''
        importados.push(`${label} ${nfe.numero}${aviso} — R$ ${nfe.valor_total.toLocaleString('pt-BR')}`)
        } catch (fileErr) {
          console.error(`[importar-nfe] erro inesperado em "${file.nome}":`, fileErr)
          erros.push({ arquivo: file.nome, erro: fileErr instanceof Error ? fileErr.message : 'Erro inesperado', detalhe: 'Erro interno ao processar este arquivo' })
        }
      }))
    }

    // Concilia todos os períodos afetados — inclui sempre o período corrente e os períodos reais das NFs
    const periodosImportados = [...new Set([
      periodo,
      ...importados.flatMap(s => {
        const m = s.match(/→ alocado em (\d{4}-\d{2})/)
        return m ? [m[1]] : []
      }),
    ])]
    for (const p of periodosImportados) {
      try { await conciliarPeriodo(clienteId, p) } catch { }
    }

    return NextResponse.json({ importados, erros, duplicados, cancelamentos })
  } catch (err) {
    console.error('[importar-nfe]', err)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}
