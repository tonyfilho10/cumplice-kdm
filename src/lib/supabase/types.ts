// Tipos compartilhados — compatíveis com Prisma (null) e Supabase client (undefined)
type Maybe<T> = T | null | undefined

export type Cliente = {
  id: string
  razao_social: string
  cnpj: string
  regime: string
  setor?: Maybe<string>
  responsavel?: Maybe<string>
  email?: Maybe<string>
  telefone?: Maybe<string>
  banco_principal?: Maybe<string>
  limite_alerta_imposto: number
  ativo: boolean
  created_at: string
}

export type Compra = {
  id: string
  cliente_id: string
  periodo: string
  data: string
  fornecedor: string
  cnpj_fornecedor?: Maybe<string>
  categoria?: Maybe<string>
  valor: number
  nf_entrada?: Maybe<string>
  cfop?: Maybe<string>
  devolucao?: boolean
  pagamento?: Maybe<string>
  status: 'ok' | 'sem_nf'
  created_at: string
}

export type NotaFiscal = {
  id: string
  cliente_id: string
  periodo: string
  data: string
  numero: string
  chave_acesso?: Maybe<string>
  cliente_nf?: Maybe<string>
  cfop?: Maybe<string>
  valor: number
  recebimento?: Maybe<string>
  data_recebimento?: Maybe<string>
  conciliada: boolean
  banco_lancamento_id?: Maybe<string>
  created_at: string
}

export type DocumentoSped = {
  id: string
  cliente_id: string
  periodo: string
  tipo: 'entrada' | 'saida'
  emissao: 'propria' | 'terceiros'
  cod_participante?: Maybe<string>
  participante_nome?: Maybe<string>
  cnpj_participante?: Maybe<string>
  modelo?: Maybe<string>
  serie?: Maybe<string>
  numero: string
  chave_nfe?: Maybe<string>
  data_emissao: string
  data_entrada_saida?: Maybe<string>
  valor_total: number
  cfop: string
  classificacao: string
  cancelado: boolean
  created_at: string
}

export type BancoLancamento = {
  id: string
  cliente_id: string
  periodo: string
  data: string
  descricao: string
  categoria?: Maybe<string>
  tipo: 'entrada' | 'saida'
  valor: number
  nf_vinculada?: Maybe<string>
  nota_fiscal_id?: Maybe<string>
  status: 'ok' | 'pendente' | 'sem_nf' | 'parcial'
  conta?: Maybe<string>
  observacao_parcial?: Maybe<string>
  comprovante_url?: Maybe<string>
  created_at: string
}

export type Despesa = {
  id: string
  cliente_id: string
  periodo: string
  data: string
  descricao: string
  categoria?: Maybe<string>
  valor: number
  documento?: Maybe<string>
  pago_banco: boolean
  dedutivel: 'sim' | 'parcial' | 'nao'
  status: 'ok' | 'sem_doc'
  created_at: string
}

export type Divergencia = {
  id: string
  cliente_id: string
  periodo: string
  tipo: 'receita_nao_declarada' | 'compra_sem_nf' | 'despesa_sem_comprovante' | 'pagamento_sem_nf_sped'
  severidade: 'alto' | 'medio' | 'baixo'
  valor?: Maybe<number>
  descricao?: Maybe<string>
  banco_lancamento_id?: Maybe<string>
  nota_fiscal_id?: Maybe<string>
  compra_id?: Maybe<string>
  despesa_id?: Maybe<string>
  resolvida: boolean
  observacao?: Maybe<string>
  resolucao_tipo?: Maybe<string>
  resolucao_nf_id?: Maybe<string>
  created_at: string
}

export type FornecedorCadastro = {
  id: string
  cliente_id: string
  cnpj: string
  codigo_erp?: Maybe<string>
  nome: string
  created_at: string
}

export type ContaPagar = {
  id: string
  cliente_id: string
  fornecedor_codigo: string
  fornecedor_nome: string
  documento: string
  emissao?: Maybe<string>
  entrada?: Maybe<string>
  vencimento?: Maybe<string>
  valor_parcela: number
  valor_pago: number
  saldo: number
  situacao: 'Aberta' | 'Pago' | 'Parcial'
  banco_lancamento_id?: Maybe<string>
  observacao?: Maybe<string>
  created_at: string
}

export type KPIs = {
  faturamento_nf: number
  entradas_banco: number
  compras: number
  imposto_estimado: number
  divergencia_banco_nf: number
  compras_sem_nf: number
  despesas_sem_doc: number
  conciliacao_pct: number
}
