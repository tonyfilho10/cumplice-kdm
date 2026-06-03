import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cruzarDados } from '@/lib/crossref'
import { guardCliente } from '@/lib/supabase/auth-guard'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params

  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  const periodo = request.nextUrl.searchParams.get('periodo') || ''

  try {
    const [notas, compras, despesas, banco, thresh] = await Promise.all([
      prisma.notaFiscal.findMany({ where: { cliente_id: clienteId, periodo, cancelada: false } }),
      prisma.compra.findMany({ where: { cliente_id: clienteId, periodo, cancelada: false } }),
      prisma.despesa.findMany({ where: { cliente_id: clienteId, periodo } }),
      prisma.bancoLancamento.findMany({ where: { cliente_id: clienteId, periodo } }),
      prisma.threshold.findUnique({ where: { cliente_id: clienteId } }),
    ])

    const fmt = (d: Date) => d.toISOString().substring(0, 10)
    const n = (v: unknown) => Number(v)

    const adaptNotas = notas.map(r => ({
      ...r, valor: n(r.valor), data: fmt(r.data), created_at: r.created_at.toISOString(),
      data_recebimento: r.data_recebimento ? fmt(r.data_recebimento) : undefined,
    }))
    const adaptCompras = compras.map(r => ({
      ...r, valor: n(r.valor), data: fmt(r.data), created_at: r.created_at.toISOString(),
      status: r.nf_entrada ? 'ok' as const : 'sem_nf' as const,
    }))
    const adaptDespesas = despesas.map(r => ({
      ...r, valor: n(r.valor), data: fmt(r.data), created_at: r.created_at.toISOString(),
      status: r.documento ? 'ok' as const : 'sem_doc' as const,
      pago_banco: r.pago_banco ?? true,
      dedutivel: (r.dedutivel ?? 'sim') as 'sim' | 'parcial' | 'nao',
    }))
    const adaptBanco = banco.map(r => ({
      ...r, valor: n(r.valor), data: fmt(r.data), created_at: r.created_at.toISOString(),
      tipo: r.tipo as 'entrada' | 'saida',
      status: r.status as 'ok' | 'pendente' | 'sem_nf' | 'parcial',
      categoria: r.categoria ?? undefined,
      nf_vinculada: r.nf_vinculada ?? undefined,
      nota_fiscal_id: r.nota_fiscal_id ?? undefined,
      conta: r.conta ?? undefined,
    }))

    const threshAdapt = thresh ? {
      divergencia_banco_nf: n(thresh.divergencia_banco_nf),
      compra_sem_nf: n(thresh.compra_sem_nf),
      despesa_sem_doc: n(thresh.despesa_sem_doc),
    } : undefined

    const resultado = cruzarDados(clienteId, periodo, adaptBanco, adaptNotas, adaptCompras, adaptDespesas, threshAdapt)

    // Persiste vínculos NF ↔ Lançamento bancário calculados pelo cruzamento
    if (resultado.conciliacoes.length > 0) {
      await Promise.all(resultado.conciliacoes.map(async ({ banco_id, nf_id, diferenca }) => {
        await Promise.all([
          prisma.bancoLancamento.update({
            where: { id: banco_id },
            data: {
              nota_fiscal_id: nf_id,
              status: diferenca === 0 ? 'ok' : 'parcial',
            },
          }).catch(() => {}), // ignora se já foi atualizado
          prisma.notaFiscal.update({
            where: { id: nf_id },
            data: {
              conciliada: true,
              banco_lancamento_id: banco_id,
            },
          }).catch(() => {}),
        ])
      }))
    }

    return NextResponse.json({
      faturamento_nf: adaptNotas.reduce((s, r) => s + r.valor, 0),
      entradas_banco: adaptBanco.filter(b => b.tipo === 'entrada').reduce((s, b) => s + b.valor, 0),
      compras: adaptCompras.reduce((s, c) => s + c.valor, 0),
      ...resultado.estatisticas,
      divergencias: resultado.divergencias,
      conciliacoes: resultado.conciliacoes,
    })
  } catch (err) {
    console.error('[kpis]', err)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}
