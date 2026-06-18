'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { CheckCircle2, MessageSquarePlus, Bell, Plus, Send, ChevronDown, ChevronUp, Pencil, X, Clock, Check, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, Toast } from '@/components/ui'
import { Button } from '@/components/ui/button'

type Categoria = 'nova-feature' | 'ui' | 'banco-de-dados' | 'correcao'
type StatusSugestao = 'nao_lida' | 'em_andamento' | 'resolvida'

type Feedback = {
  id: string; tipo: string; usuario_id: string
  mensagem?: string | null; status_sugestao: StatusSugestao; created_at: string
}
type Edicao = {
  id: string; titulo_antes: string; descricao_antes: string
  editado_por: string; created_at: string
}
type Atualizacao = {
  id: string; titulo: string; descricao: string; versao: string | null
  categoria: Categoria; publicada: boolean; publicado_em: string | null
  editado_em: string | null; created_at: string
  feedbacks: Feedback[]; edicoes: Edicao[]
}

type Props = { isAdmin: boolean; isDesenvolvedor: boolean; usuarioId: string }

const CATS: { id: Categoria | 'todas'; label: string; cor: string }[] = [
  { id: 'todas',          label: 'Todas',           cor: 'bg-muted text-muted-foreground' },
  { id: 'nova-feature',   label: 'Nova feature',    cor: 'bg-primary/10 text-primary' },
  { id: 'ui',             label: 'Interface (UI)',   cor: 'bg-violet-500/10 text-violet-400' },
  { id: 'banco-de-dados', label: 'Banco de dados',  cor: 'bg-amber-500/10 text-amber-400' },
  { id: 'correcao',       label: 'Correção',         cor: 'bg-rose-500/10 text-rose-400' },
]
const CAT_BADGE: Record<Categoria, string> = {
  'nova-feature':   'bg-primary/10 text-primary',
  'ui':             'bg-violet-500/10 text-violet-400',
  'banco-de-dados': 'bg-amber-500/10 text-amber-400',
  'correcao':       'bg-rose-500/10 text-rose-400',
}
const CAT_LABEL: Record<Categoria, string> = {
  'nova-feature': 'Nova feature', 'ui': 'UI',
  'banco-de-dados': 'Banco de dados', 'correcao': 'Correção',
}
const STATUS_CONFIG: Record<StatusSugestao, { label: string; icon: React.ElementType; cls: string }> = {
  nao_lida:    { label: 'Não lida',    icon: Eye,          cls: 'text-muted-foreground border-border' },
  em_andamento:{ label: 'Em andamento',icon: Clock,        cls: 'text-amber-400 border-amber-400/30' },
  resolvida:   { label: 'Resolvida',   icon: Check,        cls: 'text-green-500 border-green-500/30' },
}

const HISTORICO_INICIAL: Atualizacao[] = [
  {
    id: 'v1.8.0', versao: '1.8.0', categoria: 'nova-feature',
    titulo: 'Importação de PDF de Fornecedores e Contas a Pagar',
    descricao: '• Aba "Importar PDF" na seção Fornecedores com upload de cadastro e contas a pagar\n• Extração de texto via pdf-parse (local, sem IA) + Claude Haiku por chunks de 12k chars\n• Orquestração client-side elimina erros 504 — cada requisição termina em menos de 30s\n• Progresso em tempo real: "Extraindo dados 2/5..."\n• Importação de 384 fornecedores e 81 contas a pagar validada em produção',
    publicada: true, publicado_em: '2026-06-17T00:00:00Z', editado_em: null, created_at: '2026-06-17T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.7.0', versao: '1.7.0', categoria: 'nova-feature',
    titulo: 'Fornecedores: baixa em massa e navegação cruzada com o Banco',
    descricao: '• Botão "Dar baixa nos matches (N)" confirma todos os cruzamentos automáticos de uma vez\n• Clicar numa conta a pagar navega direto para o lançamento bancário correspondente\n• Troca de período automática quando o lançamento é de outro mês\n• Banner âmbar "Mostrando apenas o lançamento vinculado" com botão para voltar\n• Janela de match ampliada de 60 → 180 dias',
    publicada: true, publicado_em: '2026-06-16T00:00:00Z', editado_em: null, created_at: '2026-06-16T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.6.0', versao: '1.6.0', categoria: 'nova-feature',
    titulo: 'NFS-e: importação de PDF via IA e cruzamento bancário',
    descricao: '• Nova aba "Notas de Serviço" com importação de NFS-e em PDF usando Claude\n• Cruzamento automático com lançamentos bancários\n• Controle de acesso por papel (contador/dono/standard)',
    publicada: true, publicado_em: '2026-05-20T00:00:00Z', editado_em: null, created_at: '2026-05-20T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.5.0', versao: '1.5.0', categoria: 'nova-feature',
    titulo: 'Cruzamento de Dados: seleção em massa, novos tipos e accordion',
    descricao: '• Identificação de imposto/tributo, depósito/cheque e aplicação/resgate\n• Seleção em lote para baixa simultânea\n• Divergências resolvidas agrupadas em accordion retrátil',
    publicada: true, publicado_em: '2026-05-10T00:00:00Z', editado_em: null, created_at: '2026-05-10T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.4.0', versao: '1.4.0', categoria: 'ui',
    titulo: 'Análise de Tendências: cards accordion, lightbox e modal horizontal',
    descricao: '• Cards accordion por categoria com indicadores de risco (bolinhas coloridas)\n• Lightbox para visualização detalhada de gráficos\n• Modal horizontal para comparação de períodos\n• Identidade visual CSHub consolidada: navy marinho + laranja',
    publicada: true, publicado_em: '2026-04-28T00:00:00Z', editado_em: null, created_at: '2026-04-28T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.3.0', versao: '1.3.0', categoria: 'nova-feature',
    titulo: 'Simulador: Lucro Real + permissões por papel + XML → PDF',
    descricao: '• Lucro Real adicionado como opção no simulador de regime tributário\n• Perfil Standard: oculta abas fiscais/contábeis para não-contadores\n• Conversor XML → PDF para NF-e com classificação por IA',
    publicada: true, publicado_em: '2026-04-10T00:00:00Z', editado_em: null, created_at: '2026-04-10T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.2.1', versao: '1.2.1', categoria: 'correcao',
    titulo: 'Correções de conciliação bancária e badges de status',
    descricao: '• Badges de conciliação corrigidos no Banco\n• Exige match exato de valor entre NF e lançamento bancário\n• Remove campo de observação desnecessário para conciliação parcial\n• Lançamentos de ajuste ocultos nos cards do Cruzamento',
    publicada: true, publicado_em: '2026-04-05T00:00:00Z', editado_em: null, created_at: '2026-04-05T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.2.0', versao: '1.2.0', categoria: 'nova-feature',
    titulo: 'Comprovantes bancários via IA e importação SIEG Cofre',
    descricao: '• Vinculação de comprovantes bancários por conteúdo usando Claude Haiku\n• Suporte a múltiplos comprovantes por PDF com análise por página\n• Importação de relatório SIEG Cofre (.xlsx) para NFs e compras\n• Filtro de lançamentos com/sem comprovante',
    publicada: true, publicado_em: '2026-03-15T00:00:00Z', editado_em: null, created_at: '2026-03-15T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.1.1', versao: '1.1.1', categoria: 'banco-de-dados',
    titulo: 'Saldo inicial por conta bancária e cruzamento SPED × NFs',
    descricao: '• Saldo inicial configurável por conta bancária com cálculo automático do saldo atual\n• Cruzamento banco × SPED venda (NFs emitidas) com matching B2B\n• Resolução contextual de divergências com fallback SPED na Visão Geral',
    publicada: true, publicado_em: '2026-03-01T00:00:00Z', editado_em: null, created_at: '2026-03-01T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.1.0', versao: '1.1.0', categoria: 'nova-feature',
    titulo: 'SPED EFD ICMS/IPI e identidade visual CSHub',
    descricao: '• Módulo SPED EFD ICMS/IPI com upload e classificação validada de CFOPs\n• Identidade visual redesenhada: navy marinho + laranja (padrão CSHub)\n• Login com split layout e modo claro redesenhado',
    publicada: true, publicado_em: '2026-02-20T00:00:00Z', editado_em: null, created_at: '2026-02-20T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.0.2', versao: '1.0.2', categoria: 'ui',
    titulo: 'Redesign da interface: shadcn/ui + sidebar retrátil + modo claro/escuro',
    descricao: '• Migração completa para shadcn/ui com design system consistente\n• Sidebar retrátil com tooltips no modo colapsado\n• Modo claro/escuro com ThemeToggle e MonthPicker',
    publicada: true, publicado_em: '2026-02-01T00:00:00Z', editado_em: null, created_at: '2026-02-01T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.0.1', versao: '1.0.1', categoria: 'banco-de-dados',
    titulo: 'Correções de banco de dados e importações',
    descricao: '• Corrige inserts não gravando no banco (DEFAULT gen_random_uuid restaurado)\n• Parser OFX robusto para bancos brasileiros\n• Período derivado da data real do documento',
    publicada: true, publicado_em: '2026-01-20T00:00:00Z', editado_em: null, created_at: '2026-01-20T00:00:00Z', feedbacks: [], edicoes: [],
  },
  {
    id: 'v1.0.0', versao: '1.0.0', categoria: 'nova-feature',
    titulo: 'Lançamento do Sistema Cúmplice',
    descricao: '• Dashboard contábil completo com Visão Geral, KPIs e alertas\n• Importação de NF-e (XML) e OFX bancário\n• Cruzamento automático NF × Banco\n• Gestão de empresas e usuários com controle de acesso por papel\n• Simulador Simples Nacional × Lucro Presumido',
    publicada: true, publicado_em: '2026-01-01T00:00:00Z', editado_em: null, created_at: '2026-01-01T00:00:00Z', feedbacks: [], edicoes: [],
  },
]

function fmtData(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDataHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Atualizacoes({ isAdmin, isDesenvolvedor, usuarioId }: Props) {
  const [dinamicas, setDinamicas]           = useState<Atualizacao[]>([])
  const [loading, setLoading]               = useState(true)
  const [toast, setToast]                   = useState('')
  const [expandido, setExpandido]           = useState<string | null>(null)
  const [feedbackAberto, setFeedbackAberto] = useState<string | null>(null)
  const [logAberto, setLogAberto]           = useState<string | null>(null)
  const [sugestao, setSugestao]             = useState('')
  const [salvando, setSalvando]             = useState(false)

  // Filtros
  const [catFiltro, setCatFiltro]   = useState<Categoria | 'todas'>('todas')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim]       = useState('')

  // Novo rascunho
  const [criando, setCriando]       = useState(false)
  const [novoTitulo, setNovoTitulo] = useState('')
  const [novaDesc, setNovaDesc]     = useState('')
  const [novaVersao, setNovaVersao] = useState('')
  const [novaCat, setNovaCat]       = useState<Categoria>('nova-feature')

  // Edição
  const [editando, setEditando]       = useState<string | null>(null)
  const [editTitulo, setEditTitulo]   = useState('')
  const [editDesc, setEditDesc]       = useState('')

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/atualizacoes')
      const data: Atualizacao[] = await res.json()
      setDinamicas(Array.isArray(data) ? data : [])
    } catch { /* silencioso */ }
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const todos = useMemo<Atualizacao[]>(() => {
    const versoesDin = new Set(dinamicas.map(a => a.versao).filter(Boolean))
    const historico  = HISTORICO_INICIAL.filter(h => !versoesDin.has(h.versao))
    return [...dinamicas, ...historico]
      .sort((a, b) => new Date(b.publicado_em ?? b.created_at).getTime() - new Date(a.publicado_em ?? a.created_at).getTime())
  }, [dinamicas])

  const filtrados = useMemo(() => todos.filter(item => {
    if (catFiltro !== 'todas' && item.categoria !== catFiltro) return false
    const dataRef = new Date(item.publicado_em ?? item.created_at)
    if (dataInicio && dataRef < new Date(dataInicio)) return false
    if (dataFim    && dataRef > new Date(dataFim + 'T23:59:59')) return false
    return true
  }), [todos, catFiltro, dataInicio, dataFim])

  const temFiltro = catFiltro !== 'todas' || dataInicio || dataFim

  async function criarAtualizacao() {
    if (!novoTitulo.trim() || !novaDesc.trim()) return
    setSalvando(true)
    const res  = await fetch('/api/atualizacoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: novoTitulo, descricao: novaDesc, versao: novaVersao, categoria: novaCat }),
    })
    const data = await res.json()
    if (data.erro) { setToast(`Erro: ${data.erro}`); setSalvando(false); return }
    setNovoTitulo(''); setNovaDesc(''); setNovaVersao(''); setCriando(false); setSalvando(false)
    await carregar()
    setToast('Rascunho criado. Publique para notificar os usuários.')
  }

  async function publicar(id: string) {
    setSalvando(true)
    const res  = await fetch(`/api/atualizacoes/${id}/publicar`, { method: 'POST' })
    const data = await res.json()
    setSalvando(false)
    if (data.erro) { setToast(`Erro: ${data.erro}`); return }
    setToast(`Publicado! ${data.notificados} usuário(s) notificado(s).`)
    await carregar()
  }

  async function salvarEdicao(id: string) {
    if (!editTitulo.trim() || !editDesc.trim()) return
    setSalvando(true)
    const res  = await fetch(`/api/atualizacoes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: editTitulo, descricao: editDesc }),
    })
    const data = await res.json()
    setSalvando(false)
    if (data.erro) { setToast(`Erro: ${data.erro}`); return }
    setEditando(null)
    await carregar()
    setToast('Atualização editada com sucesso.')
  }

  async function enviarFeedback(id: string, tipo: 'aprovado' | 'sugestao') {
    if (tipo === 'sugestao' && !sugestao.trim()) return
    setSalvando(true)
    await fetch(`/api/atualizacoes/${id}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, mensagem: tipo === 'sugestao' ? sugestao : undefined }),
    })
    setSalvando(false); setSugestao(''); setFeedbackAberto(null)
    setToast(tipo === 'aprovado' ? 'Aprovação registrada!' : 'Sugestão enviada!')
    await carregar()
  }

  async function atualizarStatusSugestao(atualizacaoId: string, feedbackId: string, status: StatusSugestao) {
    setSalvando(true)
    await fetch(`/api/atualizacoes/${atualizacaoId}/feedback`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback_id: feedbackId, status_sugestao: status }),
    })
    setSalvando(false)
    await carregar()
  }

  if (loading) return <div className="text-muted-foreground text-sm p-6">Carregando...</div>

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {toast && <Toast msg={toast} onHide={() => setToast('')} />}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Histórico de Atualizações</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{todos.length} versões · {filtrados.length} exibidas</p>
        </div>
        {isDesenvolvedor && (
          <Button size="sm" onClick={() => setCriando(v => !v)} className="gap-2">
            <Plus className="h-3.5 w-3.5" />Nova atualização
          </Button>
        )}
      </div>

      {/* Filtros */}
      <div className="space-y-3 p-4 rounded-xl border border-border bg-card">
        <div className="flex flex-wrap gap-2">
          {CATS.map(c => (
            <button
              key={c.id}
              onClick={() => setCatFiltro(c.id as Categoria | 'todas')}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-all border',
                catFiltro === c.id
                  ? c.cor + ' border-current ring-1 ring-current'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 opacity-70'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Período:</span>
          <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
          <span className="text-xs text-muted-foreground">até</span>
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary" />
          {temFiltro && (
            <button onClick={() => { setCatFiltro('todas'); setDataInicio(''); setDataFim('') }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-1">
              <X className="h-3 w-3" />Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Formulário de criação (desenvolvedor) */}
      {isDesenvolvedor && criando && (
        <Card className="p-4 space-y-3 border-primary/30">
          <p className="text-sm font-semibold text-foreground">Nova atualização</p>
          <div className="flex gap-2 flex-wrap">
            <input className="flex-1 min-w-40 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Título *" value={novoTitulo} onChange={e => setNovoTitulo(e.target.value)} />
            <input className="w-24 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="v1.9.0" value={novaVersao} onChange={e => setNovaVersao(e.target.value)} />
            <select value={novaCat} onChange={e => setNovaCat(e.target.value as Categoria)}
              className="bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="nova-feature">Nova feature</option>
              <option value="ui">Interface (UI)</option>
              <option value="banco-de-dados">Banco de dados</option>
              <option value="correcao">Correção</option>
            </select>
          </div>
          <textarea className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            rows={5} placeholder={"Descreva as novidades...\n• Use • para listas"}
            value={novaDesc} onChange={e => setNovaDesc(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setCriando(false)}>Cancelar</Button>
            <Button size="sm" onClick={criarAtualizacao} disabled={salvando || !novoTitulo.trim() || !novaDesc.trim()}>Salvar rascunho</Button>
          </div>
        </Card>
      )}

      {filtrados.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nenhuma atualização encontrada para os filtros selecionados.
        </div>
      )}

      {/* Timeline */}
      {filtrados.length > 0 && (
        <div className="relative">
          <div className="absolute left-3.5 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-3">
            {filtrados.map((item, idx) => {
              const isDin      = dinamicas.some(a => a.id === item.id)
              const isExpanded = expandido === item.id
              const isRascunho = isDin && !item.publicada
              const fb         = item.feedbacks?.find(f => f.usuario_id === usuarioId)
              const aprovacoes = item.feedbacks?.filter(f => f.tipo === 'aprovado').length ?? 0
              const sugestoes  = item.feedbacks?.filter(f => f.tipo === 'sugestao') ?? []
              const podeFeedback = !isDesenvolvedor && isDin && item.publicada
              const estaEditando = editando === item.id

              return (
                <div key={item.id} className="relative pl-9">
                  <div className={cn(
                    'absolute left-1.5 top-3.5 h-4 w-4 rounded-full border-2 border-background',
                    idx === 0 && !temFiltro ? 'bg-primary' : isRascunho ? 'bg-yellow-500' : 'bg-muted-foreground/40'
                  )} />

                  <Card className={cn('p-4', isRascunho && 'border-yellow-500/40 bg-yellow-500/5')}>

                    {/* Cabeçalho */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.versao && (
                            <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">v{item.versao}</span>
                          )}
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', CAT_BADGE[item.categoria])}>
                            {CAT_LABEL[item.categoria]}
                          </span>
                          {isRascunho && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Rascunho</span>}
                          <span className="text-xs text-muted-foreground">{fmtData(item.publicado_em ?? item.created_at)}</span>
                          {item.editado_em && (
                            <span className="text-xs text-muted-foreground/60 italic">
                              · editado {fmtData(item.editado_em)}
                            </span>
                          )}
                        </div>
                        <h3 className="font-semibold text-foreground mt-1.5 text-sm leading-snug">{item.titulo}</h3>

                        {/* Badge aprovações acumuladas */}
                        {isDin && item.publicada && aprovacoes > 0 && (
                          <div className="flex items-center gap-3 mt-2">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="h-3 w-3" />{aprovacoes} aprovação{aprovacoes !== 1 ? 'ões' : ''}
                            </span>
                            {sugestoes.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">
                                <MessageSquarePlus className="h-3 w-3" />{sugestoes.length} sugestão{sugestoes.length !== 1 ? 'ões' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Botão editar (desenvolvedor, publicada) */}
                        {isDesenvolvedor && isDin && item.publicada && !estaEditando && (
                          <button
                            onClick={() => { setEditando(item.id); setEditTitulo(item.titulo); setEditDesc(item.descricao) }}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button onClick={() => setExpandido(isExpanded ? null : item.id)}
                          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Botões de feedback — visíveis sem expandir (não-desenvolvedor) */}
                    {podeFeedback && (
                      <div className="mt-3 pt-3 border-t border-border">
                        {fb ? (
                          <p className="text-xs text-muted-foreground">
                            Você {fb.tipo === 'aprovado' ? 'aprovou esta atualização ✓' : 'enviou uma sugestão ✓'}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline"
                                className="gap-1.5 text-green-500 border-green-500/30 hover:bg-green-500/10"
                                onClick={() => enviarFeedback(item.id, 'aprovado')} disabled={salvando}>
                                <CheckCircle2 className="h-3.5 w-3.5" />Aprovar
                              </Button>
                              <Button size="sm" variant="outline"
                                className="gap-1.5 text-blue-400 border-blue-400/30 hover:bg-blue-400/10"
                                onClick={() => setFeedbackAberto(feedbackAberto === item.id ? null : item.id)} disabled={salvando}>
                                <MessageSquarePlus className="h-3.5 w-3.5" />Sugerir melhoria
                              </Button>
                            </div>
                            {feedbackAberto === item.id && (
                              <div className="flex gap-2">
                                <input
                                  className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                  placeholder="Descreva sua sugestão..."
                                  value={sugestao} onChange={e => setSugestao(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && enviarFeedback(item.id, 'sugestao')}
                                />
                                <Button size="sm" onClick={() => enviarFeedback(item.id, 'sugestao')}
                                  disabled={salvando || !sugestao.trim()}>
                                  <Send className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Conteúdo expandido */}
                    {isExpanded && (
                      <div className="mt-3 space-y-3 border-t border-border pt-3">

                        {/* Modo edição */}
                        {estaEditando ? (
                          <div className="space-y-2">
                            <input className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                              value={editTitulo} onChange={e => setEditTitulo(e.target.value)} />
                            <textarea className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                              rows={6} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
                            <div className="flex gap-2 justify-end">
                              <Button variant="outline" size="sm" onClick={() => setEditando(null)}>Cancelar</Button>
                              <Button size="sm" onClick={() => salvarEdicao(item.id)}
                                disabled={salvando || !editTitulo.trim() || !editDesc.trim()}>Salvar edição</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                            {item.descricao}
                          </div>
                        )}

                        {/* Log de edições (publicadas com histórico) */}
                        {isDin && item.publicada && item.edicoes?.length > 0 && (
                          <div>
                            <button
                              onClick={() => setLogAberto(logAberto === item.id ? null : item.id)}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Clock className="h-3 w-3" />
                              {item.edicoes.length} edição{item.edicoes.length !== 1 ? 'ões' : ''} anteriores
                              {logAberto === item.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                            {logAberto === item.id && (
                              <div className="mt-2 space-y-2">
                                {item.edicoes.map(e => (
                                  <div key={e.id} className="text-xs bg-muted/30 rounded-lg p-3 border border-border space-y-1">
                                    <p className="text-muted-foreground/60">{fmtDataHora(e.created_at)}</p>
                                    <p className="font-medium text-foreground/70">{e.titulo_antes}</p>
                                    <p className="text-muted-foreground whitespace-pre-line line-clamp-3">{e.descricao_antes}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Publicar (desenvolvedor, rascunho) */}
                        {isDesenvolvedor && isDin && isRascunho && (
                          <Button size="sm" onClick={() => publicar(item.id)} disabled={salvando} className="gap-2">
                            <Bell className="h-3.5 w-3.5" />Publicar e notificar todos
                          </Button>
                        )}

                        {/* Sugestões (desenvolvedor) */}
                        {isDesenvolvedor && isDin && item.publicada && sugestoes.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-foreground">Sugestões de usuários</p>
                            {sugestoes.map(f => {
                              const st = STATUS_CONFIG[f.status_sugestao]
                              const Icon = st.icon
                              return (
                                <div key={f.id} className="bg-muted/30 rounded-lg p-3 border border-border space-y-2">
                                  <p className="text-xs text-foreground">{f.mensagem}</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-muted-foreground/60">
                                      {fmtData(f.created_at)}
                                    </span>
                                    <span className={cn('inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5', st.cls)}>
                                      <Icon className="h-3 w-3" />{st.label}
                                    </span>
                                    {/* Botões de status */}
                                    {(['nao_lida', 'em_andamento', 'resolvida'] as StatusSugestao[])
                                      .filter(s => s !== f.status_sugestao)
                                      .map(s => {
                                        const sc = STATUS_CONFIG[s]
                                        const Ic = sc.icon
                                        return (
                                          <button key={s}
                                            onClick={() => atualizarStatusSugestao(item.id, f.id, s)}
                                            disabled={salvando}
                                            className={cn('inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 transition-colors hover:opacity-80', sc.cls)}
                                          >
                                            <Ic className="h-3 w-3" />{sc.label}
                                          </button>
                                        )
                                      })
                                    }
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
