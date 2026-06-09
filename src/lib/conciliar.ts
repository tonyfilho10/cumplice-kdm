// Lógica de conciliação NF × Banco — chamável de qualquer server action ou route
import { prisma } from '@/lib/prisma'
import { cruzarDados } from '@/lib/crossref'
import type { BancoLancamento, Compra, Despesa, NotaFiscal } from './supabase/types'

export async function conciliarPeriodo(clienteId: string, periodo: string) {
  const [notas, compras, despesas, banco, thresh, spedDocs] = await Promise.all([
    prisma.notaFiscal.findMany({ where: { cliente_id: clienteId, periodo, cancelada: false } }),
    prisma.compra.findMany({ where: { cliente_id: clienteId, periodo, cancelada: false } }),
    prisma.despesa.findMany({ where: { cliente_id: clienteId, periodo } }),
    prisma.bancoLancamento.findMany({ where: { cliente_id: clienteId, periodo } }),
    prisma.threshold.findUnique({ where: { cliente_id: clienteId } }),
    prisma.documentoSped.findMany({ where: { cliente_id: clienteId, periodo, cancelado: false } }),
  ])

  const fmt = (d: Date) => d.toISOString().substring(0, 10)
  const n = (v: unknown) => Number(v)

  const adaptNotas   = notas.map(r   => ({ ...r, valor: n(r.valor),   data: fmt(r.data),   created_at: r.created_at.toISOString(), data_recebimento: r.data_recebimento ? fmt(r.data_recebimento) : undefined })) as NotaFiscal[]
  const adaptCompras = compras.map(r => ({ ...r, valor: n(r.valor),   data: fmt(r.data),   created_at: r.created_at.toISOString(), status: r.nf_entrada ? 'ok' as const : 'sem_nf' as const })) as Compra[]
  const adaptDespesas = despesas.map(r => ({ ...r, valor: n(r.valor), data: fmt(r.data),   created_at: r.created_at.toISOString(), status: r.documento ? 'ok' as const : 'sem_doc' as const, pago_banco: r.pago_banco ?? true, dedutivel: (r.dedutivel ?? 'sim') as 'sim' | 'parcial' | 'nao' })) as Despesa[]
  const adaptBanco   = banco.map(r   => ({ ...r, valor: n(r.valor),   data: fmt(r.data),   created_at: r.created_at.toISOString(), tipo: r.tipo as 'entrada' | 'saida', status: r.status as 'ok' | 'pendente' | 'sem_nf' | 'parcial', categoria: r.categoria ?? undefined, nf_vinculada: r.nf_vinculada ?? undefined, nota_fiscal_id: r.nota_fiscal_id ?? undefined, conta: r.conta ?? undefined })) as BancoLancamento[]
  const adaptSped    = spedDocs.map(r => ({ ...r, valor_total: n(r.valor_total), data_emissao: fmt(r.data_emissao), data_entrada_saida: r.data_entrada_saida ? fmt(r.data_entrada_saida) : null, created_at: r.created_at.toISOString(), tipo: r.tipo as 'entrada' | 'saida', emissao: r.emissao as 'propria' | 'terceiros' }))

  const threshAdapt = thresh ? { divergencia_banco_nf: n(thresh.divergencia_banco_nf), compra_sem_nf: n(thresh.compra_sem_nf), despesa_sem_doc: n(thresh.despesa_sem_doc) } : undefined

  const resultado = cruzarDados(clienteId, periodo, adaptBanco, adaptNotas, adaptCompras, adaptDespesas, threshAdapt, adaptSped)

  // Persiste conciliações encontradas (notas_fiscais)
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

  // Persiste conciliações via SPED venda (marca lançamento como conciliado)
  for (const { banco_id, diferenca, via } of resultado.conciliacoesSped) {
    if (via !== 'venda') continue
    await prisma.bancoLancamento.update({
      where: { id: banco_id },
      data: { status: diferenca === 0 ? 'ok' : 'parcial' },
    }).catch(() => {})
    conciliados++
  }

  // Marca como "pendente" entradas que não foram conciliadas
  const conciliadosIds = new Set(resultado.conciliacoes.map(c => c.banco_id))
  const pendentes = adaptBanco.filter(b =>
    b.tipo === 'entrada' &&
    b.valor > 0 &&
    !conciliadosIds.has(b.id) &&
    b.status !== 'ok'
  )
  if (pendentes.length > 0) {
    await prisma.bancoLancamento.updateMany({
      where: { id: { in: pendentes.map(b => b.id) } },
      data: { status: 'pendente', nota_fiscal_id: null },
    })
  }

  return {
    conciliados,
    a_conciliar: pendentes.length,
    pct_conciliado: resultado.estatisticas.pct_conciliado,
  }
}

/** Concilia todos os períodos que têm banco E notas para um cliente */
export async function conciliarTodosPeriodos(clienteId: string) {
  // Busca períodos distintos com lançamentos bancários
  const periodosBanco = await prisma.bancoLancamento.findMany({
    where: { cliente_id: clienteId },
    select: { periodo: true },
    distinct: ['periodo'],
  })
  // Busca períodos distintos com notas
  const periodosNotas = await prisma.notaFiscal.findMany({
    where: { cliente_id: clienteId },
    select: { periodo: true },
    distinct: ['periodo'],
  })

  // Períodos que têm AMBOS banco e notas
  const setNotas = new Set(periodosNotas.map(p => p.periodo))
  const periodos = periodosBanco
    .map(p => p.periodo)
    .filter(p => setNotas.has(p))

  const resultados: Record<string, Awaited<ReturnType<typeof conciliarPeriodo>>> = {}
  for (const periodo of periodos) {
    resultados[periodo] = await conciliarPeriodo(clienteId, periodo)
  }
  return resultados
}
