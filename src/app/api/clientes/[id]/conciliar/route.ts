import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cruzarDados } from '@/lib/crossref'
import { guardCliente } from '@/lib/supabase/auth-guard'
import type { BancoLancamento, Compra, Despesa, NotaFiscal } from '@/lib/supabase/types'

// POST /api/clientes/[id]/conciliar?periodo=YYYY-MM
// Roda o cruzamento e persiste os vínculos NF ↔ Banco
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const periodo = request.nextUrl.searchParams.get('periodo') ||
      (await request.json().catch(() => ({}))).periodo || ''

    if (!periodo) return NextResponse.json({ erro: 'Período obrigatório' }, { status: 400 })

    // Busca todos os dados do período
    const [notas, compras, despesas, banco, thresh] = await Promise.all([
      prisma.notaFiscal.findMany({ where: { cliente_id: clienteId, periodo, cancelada: false } }),
      prisma.compra.findMany({ where: { cliente_id: clienteId, periodo, cancelada: false } }),
      prisma.despesa.findMany({ where: { cliente_id: clienteId, periodo } }),
      prisma.bancoLancamento.findMany({ where: { cliente_id: clienteId, periodo } }),
      prisma.threshold.findUnique({ where: { cliente_id: clienteId } }),
    ])

    const fmt = (d: Date) => d.toISOString().substring(0, 10)
    const n = (v: unknown) => Number(v)

    const adaptNotas = notas.map(r => ({ ...r, valor: n(r.valor), data: fmt(r.data), created_at: r.created_at.toISOString(), data_recebimento: r.data_recebimento ? fmt(r.data_recebimento) : undefined })) as NotaFiscal[]
    const adaptCompras = compras.map(r => ({ ...r, valor: n(r.valor), data: fmt(r.data), created_at: r.created_at.toISOString(), status: r.nf_entrada ? 'ok' as const : 'sem_nf' as const })) as Compra[]
    const adaptDespesas = despesas.map(r => ({ ...r, valor: n(r.valor), data: fmt(r.data), created_at: r.created_at.toISOString(), status: r.documento ? 'ok' as const : 'sem_doc' as const, pago_banco: r.pago_banco ?? true, dedutivel: (r.dedutivel ?? 'sim') as 'sim' | 'parcial' | 'nao' })) as Despesa[]
    const adaptBanco = banco.map(r => ({ ...r, valor: n(r.valor), data: fmt(r.data), created_at: r.created_at.toISOString(), tipo: r.tipo as 'entrada' | 'saida', status: r.status as 'ok' | 'pendente' | 'sem_nf' | 'parcial', categoria: r.categoria ?? undefined, nf_vinculada: r.nf_vinculada ?? undefined, nota_fiscal_id: r.nota_fiscal_id ?? undefined, conta: r.conta ?? undefined })) as BancoLancamento[]

    const threshAdapt = thresh ? { divergencia_banco_nf: n(thresh.divergencia_banco_nf), compra_sem_nf: n(thresh.compra_sem_nf), despesa_sem_doc: n(thresh.despesa_sem_doc) } : undefined

    const resultado = cruzarDados(clienteId, periodo, adaptBanco, adaptNotas, adaptCompras, adaptDespesas, threshAdapt)

    // ── Persiste conciliações encontradas ──────────────────────────────────
    let conciliados = 0
    for (const { banco_id, nf_id, diferenca } of resultado.conciliacoes) {
      await Promise.all([
        prisma.bancoLancamento.update({
          where: { id: banco_id },
          data: { nota_fiscal_id: nf_id, status: diferenca === 0 ? 'ok' : 'parcial' },
        }).catch(() => {}),
        prisma.notaFiscal.update({
          where: { id: nf_id },
          data: { conciliada: true, banco_lancamento_id: banco_id },
        }).catch(() => {}),
      ])
      conciliados++
    }

    // ── Marca como "pendente" os que NÃO foram conciliados ─────────────────
    // (entradas bancárias sem NF correspondente)
    const conciliadosIds = new Set(resultado.conciliacoes.map(c => c.banco_id))
    const naoConcilidados = adaptBanco.filter(b =>
      b.tipo === 'entrada' &&
      b.valor > 0 &&
      !conciliadosIds.has(b.id) &&
      b.status !== 'ok' // não altera os que já estão ok
    )
    if (naoConcilidados.length > 0) {
      await prisma.bancoLancamento.updateMany({
        where: { id: { in: naoConcilidados.map(b => b.id) } },
        data: { status: 'pendente', nota_fiscal_id: null },
      })
    }

    return NextResponse.json({
      ok: true,
      periodo,
      conciliados,
      a_conciliar: naoConcilidados.length,
      pct_conciliado: resultado.estatisticas.pct_conciliado,
    })
  } catch (err) {
    console.error('[conciliar]', err)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}
