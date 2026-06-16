'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cruzarDados } from '@/lib/crossref'
import type { BancoLancamento, Compra, Despesa, DocumentoSped, NotaFiscal } from '@/lib/supabase/types'
import { AlertBar, Badge, Btn, Card, CardTitle, KpiCard, Modal, Table, Td, Toast, Tr, brl, fmtData } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { MessageSquare, CheckCircle2, ChevronRight, Copy, X } from 'lucide-react'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

// ── Definição das ações disponíveis por tipo de divergência ──────────────────
type Acao = {
  id: string
  label: string
  icon: string
  descricao: string
  autoResolve: boolean   // se true: marcar resolvida automaticamente ao selecionar
  subform?: 'nf_numero' | 'vincular_nf' | 'msg_template' | 'categoria'
}

const ACOES_POR_TIPO: Record<string, Acao[]> = {
  receita_nao_declarada: [
    { id: 'nf_emitida',   label: 'NF Emitida',      icon: '📄', descricao: 'Nota fiscal já foi ou será emitida retroativamente', autoResolve: true,  subform: 'nf_numero'  },
    { id: 'vincular_nf',  label: 'Vincular NF',      icon: '🔗', descricao: 'Vincular a uma NF já lançada no período',            autoResolve: true,  subform: 'vincular_nf' },
    { id: 'nao_tributavel',label: 'Não Tributável',  icon: '🔕', descricao: 'Devolução, adiantamento ou entrada sem incidência',  autoResolve: false },
    { id: 'aguardando',   label: 'Em Análise',        icon: '⏳', descricao: 'Aguardando esclarecimento do cliente',               autoResolve: false },
  ],
  compra_sem_nf: [
    { id: 'nf_recebida',  label: 'NF Recebida',      icon: '✅', descricao: 'NF já foi recebida e escriturada',                  autoResolve: true  },
    { id: 'nf_a_receber', label: 'NF a Receber',     icon: '📬', descricao: 'Fornecedor vai enviar a NF em breve',               autoResolve: false },
    { id: 'solicitar_nf', label: 'Solicitar NF',     icon: '📧', descricao: 'Gerar mensagem para cobrar o fornecedor',           autoResolve: false, subform: 'msg_template' },
    { id: 'despesa_sem_nf',label:'Sem NF Confirmado',icon: '⚠️', descricao: 'Fornecedor não emite NF (risco fiscal registrado)', autoResolve: false },
  ],
  pagamento_sem_nf_sped: [
    { id: 'classificar_despesa', label: 'É Despesa',    icon: '🏷️', descricao: 'Pagamento de despesa operacional (aluguel, serviços…)', autoResolve: true, subform: 'categoria' },
    { id: 'transferencia',       label: 'Transferência', icon: '↔️', descricao: 'Transferência entre contas próprias — não é despesa',   autoResolve: true  },
    { id: 'nf_a_receber',        label: 'NF a Receber',  icon: '📬', descricao: 'Fornecedor vai enviar a NF de compra',                  autoResolve: false },
    { id: 'solicitar_nf',        label: 'Solicitar NF',  icon: '📧', descricao: 'Gerar mensagem para cobrar o fornecedor',               autoResolve: false, subform: 'msg_template' },
  ],
  despesa_sem_comprovante: [
    { id: 'comprovante_enviado', label: 'Comprovante OK',  icon: '📎', descricao: 'Comprovante fiscal já foi enviado / registrado',       autoResolve: true  },
    { id: 'aguardando',          label: 'Aguardando',      icon: '⏳', descricao: 'Comprovante será enviado em breve',                    autoResolve: false },
    { id: 'nao_dedutivel',       label: 'Não Dedutível',   icon: '❌', descricao: 'Confirmado que a despesa não é dedutível fiscalmente', autoResolve: false },
  ],
}

const CATEGORIAS_DESPESA = [
  'Aluguel', 'Energia elétrica', 'Água/Esgoto', 'Telefone/Internet',
  'Folha de pagamento', 'Pró-labore', 'Contador/Honorários', 'Manutenção',
  'Combustível', 'Frete', 'Publicidade', 'Software/Assinatura',
  'Imposto/Tributo', 'Seguro', 'Outros',
]

// ── Tipos internos ─────────────────────────────────────────────────────────
type DivType = ReturnType<typeof cruzarDados>['divergencias'][0]
type OrientacaoSalva = { observacao: string | null; resolvida: boolean; id: string; resolucao_tipo: string | null }

type ModalState = {
  divergencia: DivType
  acaoId: string | null        // resolucao_tipo selecionado
  texto: string                // observacao
  resolvida: boolean
  // sub-forms
  nfNumero: string             // para nf_emitida
  nfSelecionada: string        // para vincular_nf (id da NF)
  categoriaDespesa: string     // para classificar_despesa
  msgTemplate: string          // para solicitar_nf (read-only, copiável)
  nfsDisponiveis: { id: string; numero: string; valor: number; cliente_nf: string }[]
  carregandoNFs: boolean
}

export default function Cruzamento({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [resultado, setResultado] = useState<ReturnType<typeof cruzarDados> | null>(null)
  const [toast, setToast] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [orientacoesSalvas, setOrientacoesSalvas] = useState<Record<string, OrientacaoSalva>>({})

  // ── Carrega orientações salvas ───────────────────────────────────────────
  async function carregarOrientacoes() {
    const { data } = await supabase
      .from('divergencias')
      .select('id, banco_lancamento_id, compra_id, despesa_id, observacao, resolvida, resolucao_tipo')
      .eq('cliente_id', clienteId)
      .eq('periodo', periodo)
    const mapa: typeof orientacoesSalvas = {}
    for (const d of data || []) {
      const chave = d.banco_lancamento_id || d.compra_id || d.despesa_id
      if (chave) mapa[chave] = { observacao: d.observacao, resolvida: d.resolvida, id: d.id, resolucao_tipo: d.resolucao_tipo }
    }
    setOrientacoesSalvas(mapa)
  }

  // ── Abre o modal de resolução ────────────────────────────────────────────
  function abrirModal(div: DivType) {
    const chave = div.banco_lancamento_id || div.compra_id || div.despesa_id
    const existente = chave ? orientacoesSalvas[chave] : null
    setModal({
      divergencia: div,
      acaoId: existente?.resolucao_tipo || null,
      texto: existente?.observacao || '',
      resolvida: existente?.resolvida || false,
      nfNumero: '',
      nfSelecionada: '',
      categoriaDespesa: '',
      msgTemplate: '',
      nfsDisponiveis: [],
      carregandoNFs: false,
    })
  }

  // ── Ao selecionar uma ação rápida ────────────────────────────────────────
  async function selecionarAcao(acao: Acao) {
    if (!modal) return
    const descDiv = modal.divergencia.descricao || ''
    const valor = modal.divergencia.valor || 0
    const novoModal: ModalState = {
      ...modal,
      acaoId: acao.id,
      resolvida: acao.autoResolve,
      msgTemplate: '',
      nfsDisponiveis: modal.nfsDisponiveis,
      carregandoNFs: false,
    }

    if (acao.subform === 'msg_template') {
      // Monta template de mensagem para cobrar NF
      const fornecedor = descDiv.replace(/^[^:]+:\s*/, '').split('—')[0].trim()
      novoModal.msgTemplate = `Prezado(a) ${fornecedor},\n\nIdentificamos um pagamento no valor de ${brl(valor)} em ${periodo} sem a nota fiscal correspondente em nossos registros.\n\nPoderiam por gentileza providenciar o envio da NF?\n\nObrigado.`
    }

    if (acao.subform === 'vincular_nf') {
      novoModal.carregandoNFs = true
      setModal(novoModal)
      const { data } = await supabase
        .from('notas_fiscais')
        .select('id, numero, valor, cliente_nf')
        .eq('cliente_id', clienteId)
        .eq('periodo', periodo)
        .eq('cancelada', false)
        .order('valor', { ascending: false })
        .limit(100)
      setModal(m => m ? { ...m, nfsDisponiveis: data || [], carregandoNFs: false } : null)
      return
    }

    if (acao.subform === 'categoria') {
      novoModal.categoriaDespesa = CATEGORIAS_DESPESA[0]
    }

    setModal(novoModal)
  }

  // ── Salva a resolução ────────────────────────────────────────────────────
  async function salvar() {
    if (!modal) return
    setSalvando(true)
    const div = modal.divergencia
    const chave = div.banco_lancamento_id || div.compra_id || div.despesa_id
    const existente = chave ? orientacoesSalvas[chave] : null

    // Monta texto de observação automático se vazio + ação selecionada
    let textoFinal = modal.texto.trim()
    if (!textoFinal && modal.acaoId) {
      const acao = ACOES_POR_TIPO[div.tipo]?.find(a => a.id === modal.acaoId)
      if (acao) textoFinal = acao.descricao
      if (modal.nfNumero)        textoFinal += ` · NF ${modal.nfNumero}`
      if (modal.categoriaDespesa) textoFinal += ` · Categoria: ${modal.categoriaDespesa}`
    }

    const payload = {
      observacao: textoFinal || null,
      resolvida: modal.resolvida,
      resolucao_tipo: modal.acaoId || null,
      resolucao_nf_id: modal.nfSelecionada || null,
    }

    if (existente) {
      await supabase.from('divergencias').update(payload).eq('id', existente.id)
    } else {
      await supabase.from('divergencias').insert({
        id: crypto.randomUUID(),
        cliente_id: clienteId,
        periodo,
        tipo: div.tipo,
        severidade: div.severidade,
        valor: div.valor,
        descricao: div.descricao,
        banco_lancamento_id: div.banco_lancamento_id || null,
        nota_fiscal_id: div.nota_fiscal_id || null,
        compra_id: div.compra_id || null,
        despesa_id: div.despesa_id || null,
        ...payload,
      })
    }

    setToast(modal.resolvida ? 'Marcado como resolvido!' : 'Orientação salva!')
    setModal(null)
    setSalvando(false)
    await carregarOrientacoes()
  }

  // ── Limpa resolução ──────────────────────────────────────────────────────
  async function limpar() {
    if (!modal) return
    setSalvando(true)
    const div = modal.divergencia
    const chave = div.banco_lancamento_id || div.compra_id || div.despesa_id
    const existente = chave ? orientacoesSalvas[chave] : null
    if (existente) {
      await supabase.from('divergencias').update({
        observacao: null, resolvida: false, resolucao_tipo: null, resolucao_nf_id: null,
      }).eq('id', existente.id)
    }
    setToast('🗑️ Resolução removida')
    setModal(null)
    setSalvando(false)
    await carregarOrientacoes()
  }

  useEffect(() => { setResultado(null); setCarregando(true) }, [clienteId, periodo])

  const carregar = useCallback(async () => {
    try {
      const [{ data: notas }, { data: compras }, { data: despesas }, { data: banco }, { data: thresh }, { data: sped }] = await Promise.all([
        supabase.from('notas_fiscais').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false).limit(50000),
        supabase.from('compras').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false).limit(50000),
        supabase.from('despesas').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).limit(50000),
        supabase.from('banco_lancamentos').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).limit(50000),
        supabase.from('thresholds').select('*').eq('cliente_id', clienteId).maybeSingle(),
        supabase.from('documentos_sped').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelado', false).limit(50000),
      ])
      const isAjuste = (s?: string | null) => /ajuste/i.test(s || '')
      const notasFiltradas   = (notas  || []).filter(n => !isAjuste(n.numero) && !isAjuste(n.cliente_nf)) as NotaFiscal[]
      const comprasFiltradas = (compras || []).filter(c => !isAjuste(c.fornecedor) && !isAjuste(c.categoria) && c.valor > 0) as Compra[]
      const r = cruzarDados(
        clienteId, periodo,
        (banco || []) as BancoLancamento[],
        notasFiltradas,
        comprasFiltradas.map(c => ({ ...c, status: c.nf_entrada ? 'ok' : 'sem_nf' })),
        (despesas || []).map(d => ({ ...d, status: d.documento ? 'ok' : 'sem_doc' })) as Despesa[],
        thresh || undefined,
        (sped || []) as DocumentoSped[],
      )
      setResultado(r)
    } catch {
      setResultado(cruzarDados(clienteId, periodo, [], [], [], [], undefined))
    } finally {
      setCarregando(false)
    }
  }, [clienteId, periodo])

  useEffect(() => { carregar(); carregarOrientacoes() }, [carregar, refresh])

  if (carregando || !resultado) {
    return <div style={{ color: 'var(--muted-foreground)', padding: 40, textAlign: 'center' }}>Processando cruzamento...</div>
  }

  const { divergencias, estatisticas } = resultado
  const recNaoDeclarada = divergencias.filter(d => d.tipo === 'receita_nao_declarada' && d.severidade === 'alto')
  const comprasSemNF    = divergencias.filter(d => d.tipo === 'compra_sem_nf')
  const despSemDoc      = divergencias.filter(d => d.tipo === 'despesa_sem_comprovante')
  const pagSemNfSped    = divergencias.filter(d => d.tipo === 'pagamento_sem_nf_sped')
  const totalDiverg     = divergencias.filter(d => {
    const chave = d.banco_lancamento_id || d.compra_id || d.despesa_id
    return !orientacoesSalvas[chave || '']?.resolvida
  }).length

  return (
    <div>
      <AlertBar variant="warn">
        <span style={{ fontSize: 18 }}>{totalDiverg === 0 ? '—' : '!'}</span>
        <div>
          Cruzamento identificou <strong>{totalDiverg} divergência{totalDiverg !== 1 ? 's' : ''} pendente{totalDiverg !== 1 ? 's' : ''}</strong>.
          {totalDiverg > 0 ? ' Clique em "Resolver" em cada item para orientar o cliente.' : ' Tudo conciliado!'}
        </div>
      </AlertBar>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        <KpiCard label="Entradas s/ NF"           value={brl(estatisticas.valor_receita_nao_declarada)}  delta="Receita não declarada"          deltaType="down" topColor="var(--red)"    />
        <KpiCard label="Pagamentos s/ NF SPED"    value={brl(estatisticas.valor_pagamentos_sem_nf_sped)} delta="Saída bancária sem NF de compra" deltaType="warn" topColor="var(--orange)" />
        <KpiCard label="Compras s/ NF Entrada"    value={brl(estatisticas.valor_compras_sem_nf)}         delta="Crédito fiscal perdido"          deltaType="warn" topColor="var(--orange)" />
        <KpiCard label="Despesas s/ Comprovante"  value={brl(estatisticas.valor_despesas_sem_doc)}       delta="Não dedutível"                                    topColor="var(--yellow)" />
        <KpiCard label="NF × Banco Conciliado"    value={`${estatisticas.pct_conciliado}%`}              delta={`▲ ${estatisticas.conciliados} lançamentos OK`}  deltaType="up" topColor="var(--green)" />
      </div>

      {/* Cards resumidos — clique para abrir painel central */}
      <GrupoCards
        orientacoesSalvas={orientacoesSalvas}
        onResolver={abrirModal}
        grupos={[
          { id: 'rec',  icon: '',    titulo: 'Entradas sem NF Emitida',        subtitulo: 'Possível omissão de receita',                nivel: 'alto',  cor: 'var(--red)',    total: recNaoDeclarada.reduce((s,d)=>s+(d.valor||0),0), itens: recNaoDeclarada },
          { id: 'pag',  icon: '',    titulo: 'Pagamentos sem NF no SPED',       subtitulo: 'Saída bancária sem NF de compra',            nivel: 'medio', cor: 'var(--orange)', total: pagSemNfSped.reduce((s,d)=>s+(d.valor||0),0),    itens: pagSemNfSped    },
          { id: 'cmp',  icon: '⚠️', titulo: 'Compras sem NF de Entrada',       subtitulo: 'Crédito fiscal perdido e risco de autuação', nivel: 'medio', cor: 'var(--orange)', total: comprasSemNF.reduce((s,d)=>s+(d.valor||0),0),    itens: comprasSemNF    },
          { id: 'desp', icon: '',    titulo: 'Despesas sem Comprovante Fiscal', subtitulo: 'Não dedutível — risco de glosa',             nivel: 'baixo', cor: 'var(--yellow)', total: despSemDoc.reduce((s,d)=>s+(d.valor||0),0),      itens: despSemDoc      },
        ].filter(g => g.itens.length > 0)}
      />

      {totalDiverg === 0 && divergencias.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--green)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>·</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Nenhuma divergência encontrada!</div>
          <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 6 }}>Todos os dados estão conciliados.</div>
        </div>
      )}

      {/* Modal de Resolução */}
      {modal && (
        <ModalResolucao
          modal={modal}
          setModal={setModal}
          salvando={salvando}
          temRegistro={!!((() => {
            const chave = modal.divergencia.banco_lancamento_id || modal.divergencia.compra_id || modal.divergencia.despesa_id
            return chave && orientacoesSalvas[chave]
          })())}
          onSelecionarAcao={selecionarAcao}
          onSalvar={salvar}
          onLimpar={limpar}
        />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}

// ── Cards resumidos + painel central com backdrop blur ────────────────────
type GrupoItem = { id: string; icon: string; titulo: string; subtitulo: string; nivel: string; cor: string; total: number; itens: DivType[] }

function GrupoCards({ grupos, orientacoesSalvas, onResolver }: {
  grupos: GrupoItem[]
  orientacoesSalvas: Record<string, OrientacaoSalva>
  onResolver: (d: DivType) => void
}) {
  const [aberto, setAberto] = useState<string | null>(null)
  const grupo = grupos.find(g => g.id === aberto) || null

  return (
    <>
      {/* Grid de cards resumidos */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${grupos.length}, 1fr)`, gap: 12, marginBottom: 18 }}>
        {grupos.map(g => {
          const pendentes = g.itens.filter(d => {
            const chave = d.banco_lancamento_id || d.compra_id || d.despesa_id
            return !orientacoesSalvas[chave || '']?.resolvida
          }).length
          return (
            <button
              key={g.id}
              onClick={() => setAberto(g.id)}
              style={{
                background: 'var(--surface2)', border: `1px solid var(--border)`,
                borderRadius: 12, padding: '16px 18px', textAlign: 'left', cursor: 'pointer',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                outline: 'none',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = g.cor; (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 1px ${g.cor}40` }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>{g.icon}</span>
                <RiscoDot nivel={g.nivel} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4, lineHeight: 1.3 }}>{g.titulo}</div>
              <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 12 }}>{g.subtitulo}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: g.cor }}>{brl(g.total)}</span>
              </div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{g.itens.length} item{g.itens.length !== 1 ? 's' : ''}</span>
                {pendentes > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, background: `${g.cor}25`, color: g.cor, border: `1px solid ${g.cor}50`, borderRadius: 20, padding: '2px 8px' }}>
                    {pendentes} pendente{pendentes !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Painel central com backdrop blur */}
      {grupo && (
        <div
          onClick={() => setAberto(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 40,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 16, width: '100%', maxWidth: 860,
              maxHeight: '80vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header do painel */}
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>{grupo.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{grupo.titulo}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 1 }}>{grupo.subtitulo}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <RiscoDot nivel={grupo.nivel} />
                <span style={{ fontSize: 16, fontWeight: 800, color: grupo.cor }}>{brl(grupo.total)}</span>
                <button
                  onClick={() => setAberto(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', fontSize: 20, lineHeight: 1, padding: 4 }}
                >✕</button>
              </div>
            </div>

            {/* Tabela scrollável */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <Table headers={['Descrição', 'Valor', 'Risco', 'Resolução']}>
                {grupo.itens.map(d => {
                  const valCor = grupo.nivel === 'alto' ? 'var(--red)' : grupo.nivel === 'medio' ? 'var(--orange)' : 'var(--text)'
                  return (
                    <Tr key={String(d.banco_lancamento_id ?? d.compra_id ?? d.despesa_id ?? d.descricao)}>
                      <Td><DescricaoCell descricao={d.descricao ?? ''} tipo={d.tipo} /></Td>
                      <Td><div style={{ width: 120, whiteSpace: 'nowrap' }}><span style={{ color: valCor, fontWeight: 700 }}>{brl(d.valor || 0)}</span></div></Td>
                      <Td><div style={{ width: 90, whiteSpace: 'nowrap' }}><RiscoDot nivel={d.severidade} /></div></Td>
                      <Td><div style={{ width: 130, whiteSpace: 'nowrap' }}><BtnResolver div={d} orientacoesSalvas={orientacoesSalvas} onResolver={onResolver} /></div></Td>
                    </Tr>
                  )
                })}
              </Table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Bolinha de risco colorida ──────────────────────────────────────────────
const PREFIXOS_DESCRICAO: Record<string, string> = {
  receita_nao_declarada:  'Entrada bancária sem NF emitida: ',
  pagamento_sem_nf_sped:  'Pagamento bancário sem NF de compra no SPED: ',
  compra_sem_nf:          'Compra sem NF de entrada: ',
  despesa_sem_comprovante:'Despesa sem comprovante fiscal: ',
}

const LABEL_TIPO: Record<string, { label: string; cor: string }> = {
  receita_nao_declarada:  { label: 'Entrada s/ NF',    cor: '#ef4444' },
  compra_sem_nf:          { label: 'Compra s/ NF',     cor: '#f97316' },
  pagamento_sem_nf_sped:  { label: 'Pagto s/ NF SPED', cor: '#f97316' },
  despesa_sem_comprovante:{ label: 'Despesa s/ comp.',  cor: '#eab308' },
}

function RiscoDot({ nivel }: { nivel: string }) {
  const cor = nivel === 'alto' ? '#ef4444' : nivel === 'medio' ? '#eab308' : '#eab308'
  const label = nivel === 'alto' ? 'Alto' : nivel === 'medio' ? 'Médio' : 'Baixo'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: cor, flexShrink: 0, boxShadow: `0 0 4px ${cor}88` }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: cor }}>{label}</span>
    </span>
  )
}

function DescricaoCell({ descricao, tipo }: { descricao: string; tipo: string }) {
  const prefixo = PREFIXOS_DESCRICAO[tipo] || ''
  const texto = descricao.startsWith(prefixo) ? descricao.slice(prefixo.length) : descricao
  const meta = LABEL_TIPO[tipo]
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {meta && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
          background: `${meta.cor}18`, color: meta.cor,
          border: `1px solid ${meta.cor}40`,
          borderRadius: 4, padding: '1px 6px',
        }}>
          {meta.label}
        </span>
      )}
      <span style={{ fontSize: 13 }}>{texto}</span>
    </span>
  )
}

// ── Modal de Resolução Contextual ──────────────────────────────────────────
function ModalResolucao({
  modal, setModal, salvando, temRegistro, onSelecionarAcao, onSalvar, onLimpar,
}: {
  modal: ModalState
  setModal: React.Dispatch<React.SetStateAction<ModalState | null>>
  salvando: boolean
  temRegistro: boolean
  onSelecionarAcao: (a: Acao) => void
  onSalvar: () => void
  onLimpar: () => void
}) {
  const div = modal.divergencia
  const acoes = ACOES_POR_TIPO[div.tipo] || []
  const acaoAtual = acoes.find(a => a.id === modal.acaoId)

  const labelTipo: Record<string, string> = {
    receita_nao_declarada: '🔴 Receita não declarada',
    compra_sem_nf: '🟠 Compra sem NF',
    pagamento_sem_nf_sped: '🟠 Pagamento s/ NF SPED',
    despesa_sem_comprovante: '🟡 Despesa sem comprovante',
  }

  const temSubform = !!acaoAtual?.subform

  return (
    <Modal title={temRegistro ? 'Editar Resolução' : 'Resolver Divergência'} onClose={() => setModal(null)} className="!max-w-3xl">
      {/* Layout 2 colunas */}
      <div className="grid grid-cols-2 gap-5">

        {/* ── Coluna esquerda: info + ações ── */}
        <div className="flex flex-col gap-4">
          {/* Info da divergência */}
          <div className="rounded-lg bg-secondary border border-border p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
              {labelTipo[div.tipo] || div.tipo}
            </p>
            <p className="text-sm text-foreground leading-snug">{div.descricao}</p>
            {div.valor && (
              <p className="text-xs text-muted-foreground mt-2">
                Valor: <strong className="text-foreground">{brl(div.valor)}</strong>
              </p>
            )}
          </div>

          {/* Ações rápidas */}
          {acoes.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                Como resolver? <span className="font-normal normal-case opacity-60">(opcional)</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {acoes.map(acao => (
                  <button
                    key={acao.id}
                    onClick={() => onSelecionarAcao(acao)}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border text-left transition-all text-xs
                      ${modal.acaoId === acao.id
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-secondary/50 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                      }`}
                  >
                    <span className="text-base leading-none mt-0.5 shrink-0">{acao.icon}</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-[11px]">{acao.label}</p>
                      <p className="text-[10px] leading-tight mt-0.5 opacity-75">{acao.descricao}</p>
                    </div>
                    {modal.acaoId === acao.id && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary ml-auto mt-0.5 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Coluna direita: sub-forms + obs + checkbox + botões ── */}
        <div className="flex flex-col gap-3">
          {/* Sub-form: número da NF */}
          {acaoAtual?.subform === 'nf_numero' && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground block mb-1.5">
                Número da NF emitida <span className="font-normal normal-case opacity-60">(opcional)</span>
              </label>
              <input
                value={modal.nfNumero}
                onChange={e => setModal(m => m ? { ...m, nfNumero: e.target.value } : null)}
                placeholder="Ex: 000456"
                className="w-full rounded-lg border border-border bg-secondary text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}

          {/* Sub-form: vincular NF */}
          {acaoAtual?.subform === 'vincular_nf' && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground block mb-1.5">
                Selecionar NF do período <span className="font-normal normal-case opacity-60">(opcional)</span>
              </label>
              {modal.carregandoNFs ? (
                <p className="text-xs text-muted-foreground">Carregando NFs...</p>
              ) : modal.nfsDisponiveis.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma NF encontrada no período.</p>
              ) : (
                <select
                  value={modal.nfSelecionada}
                  onChange={e => setModal(m => m ? { ...m, nfSelecionada: e.target.value } : null)}
                  className="w-full rounded-lg border border-border bg-secondary text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">— Selecionar NF —</option>
                  {modal.nfsDisponiveis.map(nf => (
                    <option key={nf.id} value={nf.id}>NF {nf.numero} · {nf.cliente_nf} · {brl(nf.valor)}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Sub-form: categoria */}
          {acaoAtual?.subform === 'categoria' && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground block mb-1.5">
                Categoria da despesa <span className="font-normal normal-case opacity-60">(opcional)</span>
              </label>
              <select
                value={modal.categoriaDespesa}
                onChange={e => setModal(m => m ? { ...m, categoriaDespesa: e.target.value } : null)}
                className="w-full rounded-lg border border-border bg-secondary text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {CATEGORIAS_DESPESA.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {/* Sub-form: mensagem */}
          {acaoAtual?.subform === 'msg_template' && modal.msgTemplate && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Mensagem sugerida</label>
                <button onClick={() => navigator.clipboard.writeText(modal.msgTemplate).then(() => {})}
                  className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                  <Copy className="h-3 w-3" /> Copiar
                </button>
              </div>
              <textarea readOnly value={modal.msgTemplate} rows={4}
                className="w-full rounded-lg border border-border bg-secondary/30 text-foreground text-xs px-3 py-2 resize-none cursor-text" />
            </div>
          )}

          {/* Observação */}
          <div className={temSubform ? '' : 'flex-1'}>
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground block mb-1.5">
              Observação <span className="font-normal normal-case opacity-60">(opcional)</span>
            </label>
            <textarea
              value={modal.texto}
              onChange={e => setModal(m => m ? { ...m, texto: e.target.value } : null)}
              placeholder="Comentário livre para registro interno..."
              rows={temSubform ? 3 : 5}
              className="w-full rounded-lg border border-border bg-secondary text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          {/* Checkbox resolvida */}
          <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-lg border border-border bg-secondary/50 hover:bg-secondary transition-colors">
            <input type="checkbox" checked={modal.resolvida}
              onChange={e => setModal(m => m ? { ...m, resolvida: e.target.checked } : null)}
              className="w-4 h-4 accent-green-500" />
            <div>
              <p className="text-sm font-medium text-foreground">Marcar como resolvida</p>
              <p className="text-xs text-muted-foreground">Remove das pendências ativas</p>
            </div>
            {modal.resolvida && <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />}
          </label>

          {/* Rodapé */}
          <div className="flex items-center justify-between pt-1">
            <div>
              {temRegistro && <Btn variant="danger" onClick={onLimpar} disabled={salvando}>🗑️ Limpar</Btn>}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => setModal(null)}>Cancelar</Btn>
              <Btn onClick={onSalvar} disabled={salvando || (!modal.acaoId && !modal.texto.trim() && !modal.resolvida)}>
                {salvando ? 'Salvando...' : temRegistro ? 'Atualizar' : 'Salvar'}
              </Btn>
            </div>
          </div>
        </div>

      </div>
    </Modal>
  )
}

// ── Botão de status na tabela ──────────────────────────────────────────────
function BtnResolver({
  div, orientacoesSalvas, onResolver,
}: {
  div: DivType
  orientacoesSalvas: Record<string, OrientacaoSalva>
  onResolver: (d: DivType) => void
}) {
  const chave = div.banco_lancamento_id || div.compra_id || div.despesa_id
  const existente = chave ? orientacoesSalvas[chave] : null
  const acoes = ACOES_POR_TIPO[div.tipo] || []
  const acaoLabel = existente?.resolucao_tipo
    ? acoes.find(a => a.id === existente.resolucao_tipo)?.label
    : null

  if (existente?.resolvida) {
    return (
      <button onClick={() => onResolver(div)}
        className="inline-flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded-lg hover:bg-green-500/20 transition-colors">
        <CheckCircle2 className="h-3 w-3" />
        {acaoLabel || 'Resolvida'}
      </button>
    )
  }

  if (existente?.resolucao_tipo || existente?.observacao) {
    return (
      <button onClick={() => onResolver(div)}
        className="inline-flex items-center gap-1 text-xs text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded-lg hover:bg-primary/20 transition-colors"
        title={existente.observacao || ''}>
        <MessageSquare className="h-3 w-3" />
        {acaoLabel || 'Em análise'}
      </button>
    )
  }

  return (
    <button onClick={() => onResolver(div)}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-secondary border border-border px-2 py-1 rounded-lg hover:text-primary hover:border-primary/30 transition-colors">
      <ChevronRight className="h-3 w-3" /> Resolver
    </button>
  )
}
