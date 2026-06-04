// Classificação de CFOPs para o Sistema Cúmplice
// Usado para separar vendas reais de remessas/retornos nos cálculos financeiros

export type TipoOperacao =
  | 'venda'               // receita real
  | 'devolucao'           // deduz faturamento (saída de devolução)
  | 'devolucao_entrada'   // devolução de venda recebida — DEDUZ total de compras
  | 'remessa'             // movimentação de estoque, não é receita
  | 'retorno_remessa'     // retorno de estoque enviado
  | 'industrializacao'    // serviço de industrialização (custo)
  | 'compra'              // entrada de mercadoria (custo)
  | 'entrada_remessa'     // recebimento de remessa de terceiros
  | 'outros'              // outros / verificar

export interface CFOPInfo {
  tipo: TipoOperacao
  descricao: string
  badge: string            // texto curto para exibir na tabela
  cor: string              // classe Tailwind de cor
  impacto: 'positivo' | 'negativo' | 'neutro'
}

// CFOPs que contam como VENDA (produtos + serviços + substituição tributária)
export const CFOPS_VENDA = new Set([
  // Vendas de produto/mercadoria
  '5101','5102','5103','5104','5105','5106',
  '6101','6102','6103','6104','6105','6106',
  '6107','6108',
  // Vendas com substituição tributária (ST)
  '5401','5403','5405','6401','6403',
  // Serviços (NFS-e — ISSQN)
  '5933','6933',
  // Industrialização por encomenda (já em CFOP_MAP como venda)
  '5124','6124',
])

const CFOP_MAP: Record<string, CFOPInfo> = {
  // ── Vendas — apenas os CFOPs confirmados ──────────────────────────────────
  '5101': { tipo: 'venda', descricao: 'Venda de produto industrializado',              badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '5102': { tipo: 'venda', descricao: 'Venda de mercadoria adquirida',                 badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '6101': { tipo: 'venda', descricao: 'Venda interestadual de produto industrializado', badge: 'Venda',    cor: 'text-green-400', impacto: 'positivo' },
  '6102': { tipo: 'venda', descricao: 'Venda interestadual de mercadoria',             badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '6107': { tipo: 'venda', descricao: 'Venda p/ Zona Franca de Manaus',               badge: 'Venda ZFM', cor: 'text-green-400', impacto: 'positivo' },
  '6108': { tipo: 'venda', descricao: 'Venda interestadual c/ retenção ST',            badge: 'Venda ST',  cor: 'text-green-400', impacto: 'positivo' },

  // ── Vendas com ST e outras modalidades de venda ──────────────────────────
  '5103': { tipo: 'venda', descricao: 'Venda de produção fora do estabelecimento',    badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '5104': { tipo: 'venda', descricao: 'Venda de mercadoria fora do estabelecimento',  badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '5105': { tipo: 'venda', descricao: 'Venda de produção ao Governo',                 badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '5106': { tipo: 'venda', descricao: 'Venda de mercadoria a não contribuinte',       badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '6103': { tipo: 'venda', descricao: 'Venda interestadual de produção fora estab.',  badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '6104': { tipo: 'venda', descricao: 'Venda interestadual de mercadoria fora estab.',badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '6105': { tipo: 'venda', descricao: 'Venda interestadual de produção ao Governo',   badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '6106': { tipo: 'venda', descricao: 'Venda interestadual a não contribuinte',       badge: 'Venda',     cor: 'text-green-400', impacto: 'positivo' },
  '5401': { tipo: 'venda', descricao: 'Venda de produção c/ ICMS-ST',                 badge: 'Venda ST',  cor: 'text-green-400', impacto: 'positivo' },
  '5403': { tipo: 'venda', descricao: 'Venda de mercadoria adquirida c/ ICMS-ST',     badge: 'Venda ST',  cor: 'text-green-400', impacto: 'positivo' },
  '5405': { tipo: 'venda', descricao: 'Venda de mercadoria c/ substituição tributária', badge: 'Venda ST', cor: 'text-green-400', impacto: 'positivo' },
  '6401': { tipo: 'venda', descricao: 'Venda interestadual de produção c/ ST',        badge: 'Venda ST',  cor: 'text-green-400', impacto: 'positivo' },
  '6403': { tipo: 'venda', descricao: 'Venda interestadual de mercadoria c/ ST',      badge: 'Venda ST',  cor: 'text-green-400', impacto: 'positivo' },
  '5107': { tipo: 'outros', descricao: 'Venda p/ Zona Franca',                        badge: 'Não venda', cor: 'text-muted-foreground', impacto: 'neutro' },
  '5108': { tipo: 'outros', descricao: 'Venda com ST',                                badge: 'Não venda', cor: 'text-muted-foreground', impacto: 'neutro' },
  // ── Serviços (NFS-e — tributados pelo ISSQN) ─────────────────────────────
  '5933': { tipo: 'venda', descricao: 'Prestação de serviço no município (ISSQN)',    badge: 'Serviço',   cor: 'text-green-400', impacto: 'positivo' },
  '6933': { tipo: 'venda', descricao: 'Prestação de serviço interestadual (ISSQN)',   badge: 'Serviço',   cor: 'text-green-400', impacto: 'positivo' },

  // ── Devoluções de saída (deduzem faturamento — NFs emitidas) ────────────
  '5201': { tipo: 'devolucao', descricao: 'Devolução de compra p/ industrialização', badge: 'Dev.Saída',   cor: 'text-orange-400', impacto: 'negativo' },
  '6201': { tipo: 'devolucao', descricao: 'Devolução interestadual de compra',       badge: 'Dev.Saída',   cor: 'text-orange-400', impacto: 'negativo' },
  '5202': { tipo: 'devolucao', descricao: 'Devolução de compra de mercadoria',       badge: 'Dev.Saída',   cor: 'text-orange-400', impacto: 'negativo' },
  '6202': { tipo: 'devolucao', descricao: 'Devolução interestadual de mercadoria',   badge: 'Dev.Saída',   cor: 'text-orange-400', impacto: 'negativo' },

  // ── Devoluções de entrada (cliente devolveu mercadoria — DEDUZ compras) ──
  '1201': { tipo: 'devolucao_entrada', descricao: 'Devolução de venda de produção própria',          badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' },
  '1202': { tipo: 'devolucao_entrada', descricao: 'Devolução de venda de mercadoria adquirida',      badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' },
  '1203': { tipo: 'devolucao_entrada', descricao: 'Devolução de venda p/ ZFM/ALC (produção)',        badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' },
  '1204': { tipo: 'devolucao_entrada', descricao: 'Devolução de venda p/ ZFM/ALC (mercadoria)',      badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' },
  '1410': { tipo: 'devolucao_entrada', descricao: 'Devolução de venda de mercadoria p/ uso e cons.', badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' },
  '2201': { tipo: 'devolucao_entrada', descricao: 'Devolução interestadual de venda de produção',    badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' },
  '2202': { tipo: 'devolucao_entrada', descricao: 'Devolução interestadual de venda de mercadoria',  badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' },
  '2203': { tipo: 'devolucao_entrada', descricao: 'Dev. interestadual de venda p/ ZFM/ALC',          badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' },
  '2410': { tipo: 'devolucao_entrada', descricao: 'Dev. interestadual de venda p/ uso e cons.',      badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' },

  // ── Remessas (NÃO são receita — movimentação de estoque) ─────────────────
  '5901': { tipo: 'remessa', descricao: 'Remessa p/ industrialização por encomenda', badge: 'Remessa',     cor: 'text-yellow-400', impacto: 'neutro' },
  '6901': { tipo: 'remessa', descricao: 'Remessa interestadual p/ industrialização', badge: 'Remessa',     cor: 'text-yellow-400', impacto: 'neutro' },
  '5903': { tipo: 'remessa', descricao: 'Remessa p/ venda fora do estabelecimento',  badge: 'Remessa',     cor: 'text-yellow-400', impacto: 'neutro' },
  '6903': { tipo: 'remessa', descricao: 'Remessa interestadual p/ venda',            badge: 'Remessa',     cor: 'text-yellow-400', impacto: 'neutro' },
  '5910': { tipo: 'remessa', descricao: 'Remessa em bonificação',                    badge: 'Remessa',     cor: 'text-yellow-400', impacto: 'neutro' },
  '5949': { tipo: 'remessa', descricao: 'Outra saída de mercadoria',                 badge: 'Remessa',     cor: 'text-yellow-400', impacto: 'neutro' },
  '6949': { tipo: 'remessa', descricao: 'Outra saída interestadual',                 badge: 'Remessa',     cor: 'text-yellow-400', impacto: 'neutro' },

  // ── Retornos — DEDUZEM o faturamento (saídas sem receita correspondente) ──
  '5902': { tipo: 'retorno_remessa', descricao: 'Retorno de industrialização',              badge: 'Retorno', cor: 'text-blue-400', impacto: 'negativo' },
  '6902': { tipo: 'retorno_remessa', descricao: 'Retorno interestadual de industrialização', badge: 'Retorno', cor: 'text-blue-400', impacto: 'negativo' },
  '5904': { tipo: 'retorno_remessa', descricao: 'Retorno de remessa p/ venda',              badge: 'Retorno', cor: 'text-blue-400', impacto: 'negativo' },
  '5929': { tipo: 'venda', descricao: 'Venda — Cupons Fiscais (NFC-e)',                    badge: 'Venda CF', cor: 'text-green-400', impacto: 'positivo' },
  '6908': { tipo: 'remessa',         descricao: 'Retorno de mercadoria depositada',         badge: 'Remessa', cor: 'text-yellow-400', impacto: 'neutro' },
  '6923': { tipo: 'retorno_remessa', descricao: 'Retorno de depósito fechado',              badge: 'Retorno', cor: 'text-blue-400', impacto: 'negativo' },

  // ── Industrialização — é RECEITA de serviço prestado ────────────────────
  // KDM recebe matéria-prima, industrializa e devolve cobrando pelo serviço
  '5124': { tipo: 'venda', descricao: 'Industrialização efetuada p/ terceiros (estadual)', badge: 'Serviço', cor: 'text-green-400', impacto: 'positivo' },
  '6124': { tipo: 'venda', descricao: 'Industrialização efetuada p/ terceiros (interestadual)', badge: 'Serviço', cor: 'text-green-400', impacto: 'positivo' },

  // ── Entradas de remessa (compras de terceiros) ────────────────────────────
  '1901': { tipo: 'entrada_remessa', descricao: 'Entrada p/ industrialização por encomenda', badge: 'Ent.Rem.', cor: 'text-cyan-400', impacto: 'neutro' },
  '2901': { tipo: 'entrada_remessa', descricao: 'Entrada interestadual p/ industrialização', badge: 'Ent.Rem.', cor: 'text-cyan-400', impacto: 'neutro' },
  '1902': { tipo: 'entrada_remessa', descricao: 'Retorno de mercadoria enviada p/ industrialização', badge: 'Ret.Rem.', cor: 'text-cyan-400', impacto: 'neutro' },
  '2216': { tipo: 'entrada_remessa', descricao: 'Entrada de mercadoria p/ industrialização', badge: 'Ent.Rem.', cor: 'text-cyan-400', impacto: 'neutro' },

  // ── Compras normais ───────────────────────────────────────────────────────
  '1101': { tipo: 'compra', descricao: 'Compra p/ industrialização',                 badge: 'Compra',      cor: 'text-muted-foreground', impacto: 'negativo' },
  '2101': { tipo: 'compra', descricao: 'Compra interestadual p/ industrialização',   badge: 'Compra',      cor: 'text-muted-foreground', impacto: 'negativo' },
  '1102': { tipo: 'compra', descricao: 'Compra p/ comercialização',                  badge: 'Compra',      cor: 'text-muted-foreground', impacto: 'negativo' },
  '2102': { tipo: 'compra', descricao: 'Compra interestadual p/ comercialização',    badge: 'Compra',      cor: 'text-muted-foreground', impacto: 'negativo' },
  '6912': { tipo: 'remessa', descricao: 'Remessa p/ demonstração',                    badge: 'Remessa',     cor: 'text-yellow-400', impacto: 'neutro' },
  '6913': { tipo: 'remessa', descricao: 'Retorno de demonstração',                   badge: 'Retorno',     cor: 'text-blue-400',   impacto: 'neutro' },
  '6911': { tipo: 'remessa', descricao: 'Remessa p/ armazenagem',                    badge: 'Remessa',     cor: 'text-yellow-400', impacto: 'neutro' },
}

export function classificarCFOP(cfop: string | null | undefined): CFOPInfo {
  if (!cfop) return { tipo: 'outros', descricao: 'Sem CFOP', badge: '—', cor: 'text-muted-foreground', impacto: 'neutro' }

  const clean = cfop.trim()
  if (CFOP_MAP[clean]) return CFOP_MAP[clean]

  // Inferência por prefixo quando não está no mapa
  const p = clean.substring(0, 1)
  if (p === '5' || p === '6') {
    const seg = clean.substring(0, 2)
    // Só são venda se o CFOP completo estiver na lista confirmada
    if (CFOPS_VENDA.has(clean)) return { tipo: 'venda', descricao: `CFOP ${clean}`, badge: 'Venda', cor: 'text-green-400', impacto: 'positivo' }
    if (seg === '51' || seg === '61') return { tipo: 'outros', descricao: `CFOP ${clean}`, badge: 'Saída', cor: 'text-muted-foreground', impacto: 'neutro' }
    if (seg === '59' || seg === '69') return { tipo: 'remessa', descricao: `CFOP ${clean}`, badge: 'Remessa', cor: 'text-yellow-400', impacto: 'neutro' }
    if (seg === '52' || seg === '62') return { tipo: 'devolucao', descricao: `CFOP ${clean}`, badge: 'Devolução', cor: 'text-orange-400', impacto: 'negativo' }
  }
  if (p === '1' || p === '2') {
    const seg = clean.substring(0, 2)
    // 12xx / 22xx são devoluções de venda recebidas — deduzem compras
    if (seg === '12' || seg === '22') {
      return { tipo: 'devolucao_entrada', descricao: `CFOP ${clean} — Dev. de venda`, badge: 'Dev.Entrada', cor: 'text-red-400', impacto: 'negativo' }
    }
    return { tipo: 'compra', descricao: `CFOP ${clean}`, badge: 'Compra', cor: 'text-muted-foreground', impacto: 'negativo' }
  }

  return { tipo: 'outros', descricao: `CFOP ${clean}`, badge: clean, cor: 'text-muted-foreground', impacto: 'neutro' }
}

/** CFOPs que contam como faturamento real */
export function ehVenda(cfop: string | null | undefined): boolean {
  return classificarCFOP(cfop).tipo === 'venda'
}

/** CFOPs que são remessa (NÃO contam como receita) */
export function ehRemessa(cfop: string | null | undefined): boolean {
  return classificarCFOP(cfop).tipo === 'remessa'
}

/** CFOPs que são retorno de remessa */
export function ehRetorno(cfop: string | null | undefined): boolean {
  return classificarCFOP(cfop).tipo === 'retorno_remessa'
}

/** CFOPs que são devoluções de saída (deduzem faturamento de vendas) */
export function ehDevolucao(cfop: string | null | undefined): boolean {
  return classificarCFOP(cfop).tipo === 'devolucao'
}

/** CFOPs que são devoluções de entrada (cliente devolveu — deduzem total de compras) */
export function ehDevolucaoEntrada(cfop: string | null | undefined): boolean {
  return classificarCFOP(cfop).tipo === 'devolucao_entrada'
}
