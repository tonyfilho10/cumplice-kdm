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
  const adaptBanco   = banco.map(r   => ({ ...r, valor: n(r.valor),   data: fmt(r.data),   created_at: r.created_at.toISOString(), tipo: r.tipo as 'entrada' | 'saida', status: r.status as 'ok' | 'pendente' | 'sem_nf' | 'parcial', categoria: r.categoria ?? undefined, nf_vinculada: r.nf_vinculada ?? undefined, nota_fiscal_id: r.nota_fiscal_id ?? undefined, conta: r.conta ?? undefined, comprovante_url: r.comprovante_url ?? undefined })) as BancoLancamento[]
  const adaptSped    = spedDocs.map(r => ({ ...r, valor_total: n(r.valor_total), data_emissao: fmt(r.data_emissao), data_entrada_saida: r.data_entrada_saida ? fmt(r.data_entrada_saida) : null, created_at: r.created_at.toISOString(), tipo: r.tipo as 'entrada' | 'saida', emissao: r.emissao as 'propria' | 'terceiros' }))

  const threshAdapt = thresh ? { divergencia_banco_nf: n(thresh.divergencia_banco_nf), compra_sem_nf: n(thresh.compra_sem_nf), despesa_sem_doc: n(thresh.despesa_sem_doc) } : undefined

  const resultado = cruzarDados(clienteId, periodo, adaptBanco, adaptNotas, adaptCompras, adaptDespesas, threshAdapt, adaptSped)

  // Persiste conciliações encontradas (notas_fiscais)
  // Entradas: só concilia com valor exato. Saídas: apenas vincula NF — status via bloco de reavaliação.
  let conciliados = 0
  const bancoPorId = new Map(adaptBanco.map(b => [b.id, b]))
  // IDs efetivamente conciliados (usados para filtrar pendentes e reavaliação de saídas)
  const entradaConciliadaIds = new Set<string>()
  const saidaComNfIds = new Set<string>()

  // Classificar conciliações por tipo para batch updates
  const entradaOkIds: string[] = []         // banco ids → status: ok
  const saidaNfLinks: { banco_id: string; nf_id: string }[] = []  // saída → vincular NF
  const nfConciliadasIds: string[] = []      // NF ids → conciliada: true
  const nfBancoLinks: { nf_id: string; banco_id: string }[] = []  // NF → banco_lancamento_id

  for (const { banco_id, nf_id, diferenca } of resultado.conciliacoes) {
    const isEntrada = bancoPorId.get(banco_id)?.tipo === 'entrada'
    if (isEntrada && diferenca !== 0) continue
    nfConciliadasIds.push(nf_id)
    nfBancoLinks.push({ nf_id, banco_id })
    if (isEntrada) {
      entradaOkIds.push(banco_id)
      entradaConciliadaIds.add(banco_id)
    } else {
      saidaNfLinks.push({ banco_id, nf_id })
      saidaComNfIds.add(banco_id)
    }
    conciliados++
  }

  for (const { banco_id, diferenca, via } of resultado.conciliacoesSped) {
    if (via !== 'venda' && via !== 'compra' && via !== 'despesa') continue
    const isEntrada = via === 'venda' || bancoPorId.get(banco_id)?.tipo === 'entrada'
    if (isEntrada && diferenca !== 0) continue
    if (isEntrada) {
      entradaOkIds.push(banco_id)
      entradaConciliadaIds.add(banco_id)
    } else {
      saidaComNfIds.add(banco_id)
    }
    conciliados++
  }

  // Batch: entradas ok + NF conciliadas (updateMany = 2 queries)
  await Promise.all([
    entradaOkIds.length > 0
      ? prisma.bancoLancamento.updateMany({ where: { id: { in: entradaOkIds } }, data: { status: 'ok' } })
      : Promise.resolve(),
    nfConciliadasIds.length > 0
      ? prisma.notaFiscal.updateMany({ where: { id: { in: nfConciliadasIds } }, data: { conciliada: true } })
      : Promise.resolve(),
    // Saídas: vincular nota_fiscal_id individualmente (valores diferentes por linha)
    ...saidaNfLinks.map(({ banco_id, nf_id }) =>
      prisma.bancoLancamento.update({ where: { id: banco_id }, data: { nota_fiscal_id: nf_id } }).catch(() => {})
    ),
    // NF: vincular banco_lancamento_id individualmente
    ...nfBancoLinks.map(({ nf_id, banco_id }) =>
      prisma.notaFiscal.update({ where: { id: nf_id }, data: { banco_lancamento_id: banco_id } }).catch(() => {})
    ),
  ])

  // Batch: pendentes (1 query)
  const pendentes = adaptBanco.filter(b =>
    b.tipo === 'entrada' &&
    b.valor > 0 &&
    !entradaConciliadaIds.has(b.id) &&
    b.status !== 'ok'
  )
  if (pendentes.length > 0) {
    await prisma.bancoLancamento.updateMany({
      where: { id: { in: pendentes.map(b => b.id) } },
      data: { status: 'pendente', nota_fiscal_id: null },
    })
  }

  // Batch saídas: agrupar por status-alvo → 1 query por status (máx 4 queries)
  const saidaByStatus: Record<string, string[]> = { ok: [], parcial: [], pendente: [], sem_nf: [] }
  for (const b of adaptBanco) {
    if (b.tipo !== 'saida') continue
    const temComprovante = !!b.comprovante_url
    const isTributo = b.categoria === 'Imposto/Tributo'
    const temNF = !!b.nota_fiscal_id || !!b.nf_vinculada || saidaComNfIds.has(b.id)

    let novoStatus: 'ok' | 'pendente' | 'sem_nf' | 'parcial'
    if (isTributo) {
      novoStatus = temComprovante ? 'ok' : 'pendente'
    } else if (temNF && temComprovante) {
      novoStatus = 'ok'
    } else if (temNF || temComprovante) {
      novoStatus = 'parcial'
    } else {
      novoStatus = 'sem_nf'
    }

    if (novoStatus !== b.status) saidaByStatus[novoStatus].push(b.id)
  }
  await Promise.all(
    Object.entries(saidaByStatus)
      .filter(([, ids]) => ids.length > 0)
      .map(([status, ids]) =>
        prisma.bancoLancamento.updateMany({ where: { id: { in: ids } }, data: { status } })
      )
  )

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
