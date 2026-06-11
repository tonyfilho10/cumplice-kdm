// Motor de cruzamento NF × Banco
// Match: entradas banco × NF venda (notas_fiscais OU documentos_sped saída)
//        saídas banco × NF compra SPED (documentos_sped entrada)
// Para vendas B2B (boleto 30-90 dias): match por CNPJ/nome do participante OU valor ±2% janela 90d

import type { BancoLancamento, Compra, Despesa, Divergencia, DocumentoSped, NotaFiscal } from './supabase/types'
import { ehVenda } from './cfop'

export type ResultadoCruzamento = {
  divergencias: Omit<Divergencia, 'id' | 'created_at'>[]
  conciliacoes: { banco_id: string; nf_id: string; diferenca: number }[]
  conciliacoesSped: { banco_id: string; sped_id: string; diferenca: number; via: 'compra' | 'venda' | 'despesa' }[]
  estatisticas: {
    total_lancamentos_banco: number
    conciliados: number
    sem_nf: number
    pct_conciliado: number
    valor_receita_nao_declarada: number
    valor_compras_sem_nf: number
    valor_despesas_sem_doc: number
    // SPED
    saidas_banco_conciliadas_sped: number
    saidas_banco_conciliadas_despesa: number
    valor_pagamentos_sem_nf_sped: number
    // SPED venda
    entradas_banco_conciliadas_sped_venda: number
  }
}

const TOLERANCIA_VALOR    = 0     // match primário exige valor idêntico (sem margem de erro)
const TOLERANCIA_VALOR_B2B = 0.05 // 5% para match B2B (boleto pode ter desconto/juros)
const JANELA_DIAS         = 3
const JANELA_DIAS_B2B     = 90   // boleto 30-60-90 dias

function diffDias(dataA: string, dataB: string): number {
  const a = new Date(dataA).getTime()
  const b = new Date(dataB).getTime()
  return Math.abs((a - b) / (1000 * 60 * 60 * 24))
}

function dentroToleranciaPct(v1: number, v2: number, tolerancia: number): boolean {
  if (v1 === 0 && v2 === 0) return true
  const maior = Math.max(v1, v2)
  return Math.abs(v1 - v2) / maior <= tolerancia
}

// Normaliza string para comparação: remove pontuação, acentos, lowercase
function normalizar(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.\-\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Remove dígitos verificadores e pontuação de CNPJ para comparação
function normalizarCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '').substring(0, 14)
}

// Verifica se o CNPJ do participante aparece na descrição do lançamento
function cnpjNaDescricao(cnpj: string | null | undefined, descricao: string): boolean {
  if (!cnpj) return false
  const cnpjLimpo = normalizarCnpj(cnpj)
  if (cnpjLimpo.length < 8) return false
  const descLimpa = descricao.replace(/\D/g, '')
  // Verifica CNPJ completo (14 dígitos) ou raiz (8 dígitos)
  return descLimpa.includes(cnpjLimpo) || descLimpa.includes(cnpjLimpo.substring(0, 8))
}

// Verifica se a razão social do participante aparece na descrição (≥ primeira palavra com 4+ chars)
function nomeNaDescricao(nome: string | null | undefined, descricao: string): boolean {
  if (!nome) return false
  const descNorm = normalizar(descricao)
  // Tenta cada palavra com 4+ caracteres do nome do participante
  const palavras = normalizar(nome).split(' ').filter(p => p.length >= 4)
  // Exige que pelo menos 2 palavras distintas apareçam, ou 1 palavra longa (8+)
  const matches = palavras.filter(p => descNorm.includes(p))
  return matches.length >= 2 || matches.some(p => p.length >= 8)
}

// CFOPs de compra que geram saída bancária (pagamento ao fornecedor)
const CFOPS_COMPRA_SPED = new Set(['1101','2101','1102','2102','1124','2124'])

export function cruzarDados(
  clienteId: string,
  periodo: string,
  bancosEntrada: BancoLancamento[],
  notas: NotaFiscal[],
  compras: Compra[],
  despesas: Despesa[],
  thresholds = { divergencia_banco_nf: 500, compra_sem_nf: 200, despesa_sem_doc: 300 },
  spedDocs: DocumentoSped[] = [],
): ResultadoCruzamento {
  const divergencias: Omit<Divergencia, 'id' | 'created_at'>[] = []
  const conciliacoes: ResultadoCruzamento['conciliacoes'] = []
  const conciliacoesSped: ResultadoCruzamento['conciliacoesSped'] = []
  const notasUsadas   = new Set<string>()
  const spedUsados    = new Set<string>()
  const bancoUsados   = new Set<string>() // evita usar o mesmo lançamento em 2 matches

  // NFs manuais/XML com CFOP de venda
  const notasConciliaveis = notas.filter(nf => ehVenda(nf.cfop))

  // SPED saídas de venda (emissão própria → são as NFs que a empresa emitiu)
  const spedVendas = spedDocs.filter(d =>
    d.tipo === 'saida' &&
    !d.cancelado &&
    d.classificacao === 'venda'
  )

  // Docs SPED de compra (entradas com classificacao='compra' — abrange todos os CFOPs de insumo)
  const spedCompras = spedDocs.filter(d =>
    d.tipo === 'entrada' && !d.cancelado && d.classificacao === 'compra'
  )

  // ========================================
  // 1. CRUZAMENTO: Entradas Banco × NFs emitidas (vendas)
  //    Prioridade: (a) notas_fiscais, (b) documentos_sped saída venda
  // ========================================
  for (const lanc of bancosEntrada) {
    if (lanc.tipo !== 'entrada' || lanc.valor === 0) continue

    // Já tem NF vinculada manualmente?
    if (lanc.nota_fiscal_id) {
      notasUsadas.add(lanc.nota_fiscal_id)
      bancoUsados.add(lanc.id)
      conciliacoes.push({ banco_id: lanc.id, nf_id: lanc.nota_fiscal_id, diferenca: 0 })
      continue
    }

    // (a) Tenta match contra notas_fiscais (data ±3 dias, valor 100% idêntico)
    const matchNF = notasConciliaveis.find(nf => {
      if (notasUsadas.has(nf.id)) return false
      return dentroToleranciaPct(lanc.valor, nf.valor, TOLERANCIA_VALOR)
          && diffDias(lanc.data, nf.data) <= JANELA_DIAS
    })

    if (matchNF) {
      notasUsadas.add(matchNF.id)
      bancoUsados.add(lanc.id)
      conciliacoes.push({ banco_id: lanc.id, nf_id: matchNF.id, diferenca: 0 })
      continue
    }

    // (b) Tenta match contra documentos_sped saída (venda B2B)
    //     Estratégia 1: CNPJ na descrição bancária (match forte, ignora data)
    //     Estratégia 2: nome do participante na descrição (match médio, ignora data)
    //     Estratégia 3: valor ±5% com janela 90 dias (fallback)
    const matchSped = spedVendas.find(doc => {
      if (spedUsados.has(doc.id)) return false
      const valorOk5 = dentroToleranciaPct(lanc.valor, doc.valor_total, TOLERANCIA_VALOR_B2B)
      if (!valorOk5) return false // valor muito diferente — descarta sempre

      // Estratégia 1 — CNPJ na descrição (data livre)
      if (cnpjNaDescricao(doc.cnpj_participante, lanc.descricao)) return true

      // Estratégia 2 — nome/razão social na descrição (data livre)
      if (nomeNaDescricao(doc.participante_nome, lanc.descricao)) return true

      // Estratégia 3 — valor ±5% + data dentro de 90 dias
      const dataOk = diffDias(lanc.data, doc.data_emissao) <= JANELA_DIAS_B2B
      return dataOk
    })

    if (matchSped) {
      spedUsados.add(matchSped.id)
      bancoUsados.add(lanc.id)
      const diferenca = Math.abs(lanc.valor - matchSped.valor_total)
      conciliacoesSped.push({ banco_id: lanc.id, sped_id: matchSped.id, diferenca, via: 'venda' })
    } else if (lanc.valor >= thresholds.divergencia_banco_nf) {
      divergencias.push({
        cliente_id: clienteId, periodo,
        tipo: 'receita_nao_declarada', severidade: 'alto',
        valor: lanc.valor,
        descricao: `Entrada bancária sem NF emitida: ${lanc.descricao} — R$ ${lanc.valor.toLocaleString('pt-BR')} em ${lanc.data}`,
        banco_lancamento_id: lanc.id, resolvida: false,
      })
    }
  }

  // ========================================
  // 2. CRUZAMENTO: Saídas Banco × NFs de compra no SPED
  // ========================================
  const saidas = bancosEntrada.filter(b => b.tipo === 'saida' && b.valor > 0)

  const despesasUsadas = new Set<string>()

  for (const lanc of saidas) {
    // Estratégia A: match contra SPED compras (NF de entrada de mercadoria/insumo)
    // Usa mesma lógica B2B: CNPJ/nome na descrição OU valor ±5% + janela 90 dias
    const matchSped = spedCompras.find(doc => {
      if (spedUsados.has(doc.id)) return false
      const valorOk = dentroToleranciaPct(lanc.valor, doc.valor_total, TOLERANCIA_VALOR_B2B)
      if (!valorOk) return false

      if (cnpjNaDescricao(doc.cnpj_participante, lanc.descricao)) return true
      if (nomeNaDescricao(doc.participante_nome, lanc.descricao)) return true

      return diffDias(lanc.data, doc.data_emissao) <= JANELA_DIAS_B2B
    })

    if (matchSped) {
      spedUsados.add(matchSped.id)
      bancoUsados.add(lanc.id)
      const diferenca = Math.abs(lanc.valor - matchSped.valor_total)
      conciliacoesSped.push({ banco_id: lanc.id, sped_id: matchSped.id, diferenca, via: 'compra' })
      continue
    }

    // Estratégia B: match contra tabela despesas (serviços, aluguel, contas)
    // Valor ±2% + janela 5 dias (despesas costumam ser pagas na data exata)
    const matchDespesa = despesas.find(desp => {
      if (despesasUsadas.has(desp.id)) return false
      return dentroToleranciaPct(lanc.valor, desp.valor, TOLERANCIA_VALOR)
          && diffDias(lanc.data, desp.data) <= 5
    })

    if (matchDespesa) {
      despesasUsadas.add(matchDespesa.id)
      bancoUsados.add(lanc.id)
      conciliacoesSped.push({ banco_id: lanc.id, sped_id: matchDespesa.id, diferenca: Math.abs(lanc.valor - matchDespesa.valor), via: 'despesa' })
      continue
    }

    if (lanc.valor >= thresholds.divergencia_banco_nf) {
      divergencias.push({
        cliente_id: clienteId, periodo,
        tipo: 'pagamento_sem_nf_sped', severidade: lanc.valor >= 2000 ? 'alto' : 'medio',
        valor: lanc.valor,
        descricao: `Pagamento bancário sem NF de compra no SPED: ${lanc.descricao} — R$ ${lanc.valor.toLocaleString('pt-BR')} em ${lanc.data}`,
        banco_lancamento_id: lanc.id, resolvida: false,
      })
    }
  }

  // ========================================
  // 3. COMPRAS SEM NF DE ENTRADA
  // ========================================
  for (const compra of compras) {
    if (compra.status === 'sem_nf' && compra.valor >= thresholds.compra_sem_nf) {
      divergencias.push({
        cliente_id: clienteId, periodo,
        tipo: 'compra_sem_nf', severidade: compra.valor >= 1000 ? 'alto' : 'medio',
        valor: compra.valor,
        descricao: `Compra sem NF de entrada: ${compra.fornecedor} — R$ ${compra.valor.toLocaleString('pt-BR')} em ${compra.data}`,
        compra_id: compra.id, resolvida: false,
      })
    }
  }

  // ========================================
  // 4. DESPESAS SEM COMPROVANTE
  // ========================================
  for (const desp of despesas) {
    if (desp.status === 'sem_doc' && desp.valor >= thresholds.despesa_sem_doc) {
      divergencias.push({
        cliente_id: clienteId, periodo,
        tipo: 'despesa_sem_comprovante', severidade: 'medio',
        valor: desp.valor,
        descricao: `Despesa sem comprovante fiscal: ${desp.descricao} — R$ ${desp.valor.toLocaleString('pt-BR')} em ${desp.data}`,
        despesa_id: desp.id, resolvida: false,
      })
    }
  }

  // ========================================
  // ESTATÍSTICAS
  // ========================================
  const entradas = bancosEntrada.filter(b => b.tipo === 'entrada' && b.valor > 0)
  // Conciliados = notas_fiscais + sped_venda + sped_compra + despesa
  const conciliadosSpedVenda = conciliacoesSped.filter(c => c.via === 'venda').length
  const conciliadosSpedCompra = conciliacoesSped.filter(c => c.via === 'compra').length
  const conciliadosDespesa    = conciliacoesSped.filter(c => c.via === 'despesa').length
  const conciliadosCount = conciliacoes.length + conciliadosSpedVenda
  const semNF = entradas.length - conciliadosCount

  const valorReceitaNaoDeclarada = divergencias
    .filter(d => d.tipo === 'receita_nao_declarada' && d.severidade === 'alto')
    .reduce((s, d) => s + (d.valor || 0), 0)

  const valorComprasSemNF = compras
    .filter(c => c.status === 'sem_nf')
    .reduce((s, c) => s + c.valor, 0)

  const valorDespSemDoc = despesas
    .filter(d => d.status === 'sem_doc')
    .reduce((s, d) => s + d.valor, 0)

  const valorPagSemNfSped = divergencias
    .filter(d => d.tipo === 'pagamento_sem_nf_sped')
    .reduce((s, d) => s + (d.valor || 0), 0)

  return {
    divergencias,
    conciliacoes,
    conciliacoesSped,
    estatisticas: {
      total_lancamentos_banco: entradas.length,
      conciliados: conciliadosCount,
      sem_nf: semNF,
      pct_conciliado: entradas.length ? Math.round((conciliadosCount / entradas.length) * 1000) / 10 : 100,
      valor_receita_nao_declarada: valorReceitaNaoDeclarada,
      valor_compras_sem_nf: valorComprasSemNF,
      valor_despesas_sem_doc: valorDespSemDoc,
      saidas_banco_conciliadas_sped: conciliadosSpedCompra,
      saidas_banco_conciliadas_despesa: conciliadosDespesa,
      valor_pagamentos_sem_nf_sped: valorPagSemNfSped,
      entradas_banco_conciliadas_sped_venda: conciliadosSpedVenda,
    },
  }
}

// Cálculo Simples Nacional (tabela 2024 Anexo I — Comércio)
const SIMPLES_TABELA = [
  { limite: 180000, aliquota: 0.04, deducao: 0 },
  { limite: 360000, aliquota: 0.073, deducao: 5940 },
  { limite: 720000, aliquota: 0.095, deducao: 13860 },
  { limite: 1800000, aliquota: 0.107, deducao: 22500 },
  { limite: 3600000, aliquota: 0.143, deducao: 87300 },
  { limite: 4800000, aliquota: 0.19, deducao: 378000 },
]

export function calcularSimples(fat12meses: number, fatMes: number) {
  // Sem faturamento acumulado não é possível calcular alíquota efetiva
  if (!fat12meses || fat12meses <= 0) {
    return { imposto: 0, aliquota_efetiva: 0, faixa_aliquota: 0.04, faixa_deducao: 0 }
  }
  if (!fatMes || fatMes <= 0) {
    return { imposto: 0, aliquota_efetiva: 0, faixa_aliquota: 0.04, faixa_deducao: 0 }
  }
  const faixa = SIMPLES_TABELA.find(f => fat12meses <= f.limite) || SIMPLES_TABELA[SIMPLES_TABELA.length - 1]
  const aliqEfetiva = Math.max(0, (fat12meses * faixa.aliquota - faixa.deducao) / fat12meses)
  return {
    imposto: fatMes * aliqEfetiva,
    aliquota_efetiva: aliqEfetiva,
    faixa_aliquota: faixa.aliquota,
    faixa_deducao: faixa.deducao,
  }
}

export function calcularLucroPresumido(fatMes: number) {
  const bcIRPJ = fatMes * 0.08
  const bcCSLL = fatMes * 0.12
  const pis = fatMes * 0.0065
  const cofins = fatMes * 0.03
  const irpj = bcIRPJ * 0.15
  const csll = bcCSLL * 0.09
  return { total: pis + cofins + irpj + csll, pis, cofins, irpj, csll }
}
