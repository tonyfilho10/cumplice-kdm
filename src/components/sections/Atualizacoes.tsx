'use client'

import { useEffect, useState, useCallback } from 'react'
import { CheckCircle2, MessageSquarePlus, Bell, Plus, Send, ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardTitle, Toast } from '@/components/ui'
import { Button } from '@/components/ui/button'

type Feedback = { tipo: string; usuario_id: string; mensagem?: string | null; created_at: string }
type Atualizacao = {
  id: string; titulo: string; descricao: string; versao: string | null
  publicada: boolean; publicado_em: string | null; created_at: string
  feedbacks: Feedback[]
}

type Props = { isAdmin: boolean; usuarioId: string }

const HISTORICO_INICIAL: Omit<Atualizacao, 'id' | 'feedbacks'>[] = [
  {
    titulo: 'Importação de PDF de Fornecedores e Contas a Pagar',
    descricao: '• Aba "Importar PDF" na seção Fornecedores com upload de cadastro e contas a pagar\n• Extração de texto via pdf-parse (sem timeout) + Claude Haiku por chunks de 12k chars\n• Orquestração client-side elimina erros 504 — cada requisição termina em menos de 30s\n• Progresso em tempo real: "Extraindo dados 2/5..."\n• Importação de 384 fornecedores e 81 contas a pagar validada em produção',
    versao: '1.8.0', publicada: true, publicado_em: '2026-06-17T00:00:00Z', created_at: '2026-06-17T00:00:00Z',
  },
  {
    titulo: 'Fornecedores: baixa em massa e navegação cruzada com o Banco',
    descricao: '• Botão "Dar baixa nos matches (N)" confirma todos os cruzamentos automáticos de uma vez\n• Clicar numa conta a pagar navega direto para o lançamento bancário correspondente\n• Troca de período automática caso o lançamento seja de outro mês\n• Banner âmbar "Mostrando apenas o lançamento vinculado" com botão para voltar à lista completa\n• Janela de match ampliada de 60 → 180 dias (captura pagamentos com atraso)',
    versao: '1.7.0', publicada: true, publicado_em: '2026-06-16T00:00:00Z', created_at: '2026-06-16T00:00:00Z',
  },
  {
    titulo: 'NFS-e: importação de PDF via IA e cruzamento bancário',
    descricao: '• Nova aba "Notas de Serviço" com importação de NFS-e em PDF usando Claude\n• Cruzamento automático com lançamentos bancários\n• Controle de acesso por papel (contador/dono/standard)',
    versao: '1.6.0', publicada: true, publicado_em: '2026-05-20T00:00:00Z', created_at: '2026-05-20T00:00:00Z',
  },
  {
    titulo: 'Cruzamento de Dados: seleção em massa, novos tipos e accordion de resolvidos',
    descricao: '• Identificação de imposto/tributo, depósito/cheque e aplicação/resgate\n• Seleção em lote para baixa simultânea\n• Divergências resolvidas agrupadas em accordion retrátil',
    versao: '1.5.0', publicada: true, publicado_em: '2026-05-10T00:00:00Z', created_at: '2026-05-10T00:00:00Z',
  },
  {
    titulo: 'Análise de Tendências com cards accordion e lightbox',
    descricao: '• Cards accordion por categoria com indicadores de risco (bolinhas coloridas)\n• Lightbox para visualização detalhada de gráficos\n• Modal horizontal para comparação de períodos',
    versao: '1.4.0', publicada: true, publicado_em: '2026-04-28T00:00:00Z', created_at: '2026-04-28T00:00:00Z',
  },
  {
    titulo: 'Simulador de Imposto: Lucro Real + permissões por papel',
    descricao: '• Lucro Real adicionado como opção no simulador de regime tributário\n• Perfil Standard: oculta abas fiscais/contábeis para usuários não-contadores\n• Conversor XML → PDF para NF-e com classificação por IA',
    versao: '1.3.0', publicada: true, publicado_em: '2026-04-10T00:00:00Z', created_at: '2026-04-10T00:00:00Z',
  },
  {
    titulo: 'Comprovantes bancários via IA e importação SIEG Cofre',
    descricao: '• Vinculação de comprovantes bancários por conteúdo usando Claude Haiku\n• Suporte a múltiplos comprovantes por PDF com análise por página\n• Importação de relatório SIEG Cofre (.xlsx) para NFs e compras',
    versao: '1.2.0', publicada: true, publicado_em: '2026-03-15T00:00:00Z', created_at: '2026-03-15T00:00:00Z',
  },
  {
    titulo: 'SPED EFD e identidade visual CSHub',
    descricao: '• Módulo SPED EFD ICMS/IPI com upload e classificação validada de CFOPs\n• Cruzamento SPED × banco e SPED × NFs emitidas\n• Identidade visual redesenhada: navy marinho + laranja (padrão CSHub)\n• Login com split layout e modo claro/escuro refinado',
    versao: '1.1.0', publicada: true, publicado_em: '2026-02-20T00:00:00Z', created_at: '2026-02-20T00:00:00Z',
  },
  {
    titulo: 'Lançamento do Sistema Cúmplice',
    descricao: '• Dashboard contábil completo com Visão Geral, KPIs e alertas\n• Importação de NF-e (XML) e OFX bancário\n• Cruzamento automático NF × Banco\n• Gestão de empresas e usuários com controle de acesso\n• Simulador Simples Nacional × Lucro Presumido\n• Seção Banco com conciliação, filtros e comprovantes\n• Modo claro/escuro + sidebar retrátil',
    versao: '1.0.0', publicada: true, publicado_em: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
  },
]

export default function Atualizacoes({ isAdmin, usuarioId }: Props) {
  const [atualizacoes, setAtualizacoes] = useState<Atualizacao[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [feedbackAberto, setFeedbackAberto] = useState<string | null>(null)
  const [sugestao, setSugestao] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Novo rascunho
  const [criando, setCriando] = useState(false)
  const [novoTitulo, setNovoTitulo] = useState('')
  const [novaDesc, setNovaDesc] = useState('')
  const [novaVersao, setNovaVersao] = useState('')

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/atualizacoes')
      const data: Atualizacao[] = await res.json()
      setAtualizacoes(data)
    } catch { /* silencioso */ }
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // Mescla histórico fixo + dinâmico (sem duplicar por versão)
  const versoesDinamicas = new Set(atualizacoes.map(a => a.versao).filter(Boolean))
  const historico = HISTORICO_INICIAL.filter(h => !versoesDinamicas.has(h.versao))
  const todos: Atualizacao[] = [
    ...atualizacoes,
    ...historico.map(h => ({ ...h, id: h.versao ?? h.titulo, feedbacks: [] as Feedback[] })),
  ].sort((a, b) => new Date(b.publicado_em ?? b.created_at).getTime() - new Date(a.publicado_em ?? a.created_at).getTime())

  async function criarAtualizacao() {
    if (!novoTitulo.trim() || !novaDesc.trim()) return
    setSalvando(true)
    const res = await fetch('/api/atualizacoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: novoTitulo, descricao: novaDesc, versao: novaVersao }),
    })
    const data = await res.json()
    if (data.erro) { setToast(`Erro: ${data.erro}`); setSalvando(false); return }
    setNovoTitulo(''); setNovaDesc(''); setNovaVersao(''); setCriando(false)
    setSalvando(false)
    await carregar()
    setToast('Rascunho criado. Publique para notificar os usuários.')
  }

  async function publicar(id: string) {
    setSalvando(true)
    const res = await fetch(`/api/atualizacoes/${id}/publicar`, { method: 'POST' })
    const data = await res.json()
    setSalvando(false)
    if (data.erro) { setToast(`Erro: ${data.erro}`); return }
    setToast(`Publicado! ${data.notificados} usuário(s) notificado(s).`)
    await carregar()
  }

  async function enviarFeedback(id: string, tipo: 'aprovado' | 'sugestao') {
    if (tipo === 'sugestao' && !sugestao.trim()) return
    setSalvando(true)
    await fetch(`/api/atualizacoes/${id}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, mensagem: tipo === 'sugestao' ? sugestao : undefined }),
    })
    setSalvando(false)
    setSugestao('')
    setFeedbackAberto(null)
    setToast(tipo === 'aprovado' ? 'Aprovação registrada!' : 'Sugestão enviada, obrigado!')
    await carregar()
  }

  function meuFeedback(item: Atualizacao) {
    return item.feedbacks?.find(f => f.usuario_id === usuarioId)
  }

  if (loading) return <div className="text-muted-foreground text-sm p-6">Carregando...</div>

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {toast && <Toast msg={toast} onHide={() => setToast('')} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Histórico de Atualizações</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Novidades, melhorias e correções do sistema</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setCriando(v => !v)} className="gap-2">
            <Plus className="h-3.5 w-3.5" />
            Nova atualização
          </Button>
        )}
      </div>

      {/* Formulário de criação (admin) */}
      {isAdmin && criando && (
        <Card className="p-4 space-y-3 border-primary/30">
          <p className="text-sm font-semibold text-foreground">Nova atualização</p>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Título *"
              value={novoTitulo}
              onChange={e => setNovoTitulo(e.target.value)}
            />
            <input
              className="w-24 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="v1.9.0"
              value={novaVersao}
              onChange={e => setNovaVersao(e.target.value)}
            />
          </div>
          <textarea
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            rows={5}
            placeholder={"Descreva as novidades desta versão...\n• Use • para listas\n• Seja claro e objetivo"}
            value={novaDesc}
            onChange={e => setNovaDesc(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setCriando(false)}>Cancelar</Button>
            <Button size="sm" onClick={criarAtualizacao} disabled={salvando || !novoTitulo.trim() || !novaDesc.trim()}>
              Salvar rascunho
            </Button>
          </div>
        </Card>
      )}

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-3.5 top-0 bottom-0 w-px bg-border" />
        <div className="space-y-3">
          {todos.map((item, idx) => {
            const isDinamico = 'publicada' in item && atualizacoes.some(a => a.id === item.id)
            const dinamico = isDinamico ? (item as Atualizacao) : null
            const isExpanded = expandido === item.id
            const fb = dinamico ? meuFeedback(dinamico) : null
            const aprovacoes = dinamico?.feedbacks.filter(f => f.tipo === 'aprovado').length ?? 0
            const sugestoes  = dinamico?.feedbacks.filter(f => f.tipo === 'sugestao').length ?? 0
            const isRascunho = dinamico && !dinamico.publicada
            const dataExib = new Date(item.publicado_em ?? item.created_at).toLocaleDateString('pt-BR', {
              day: '2-digit', month: 'short', year: 'numeric',
            })

            return (
              <div key={item.id} className="relative pl-9">
                {/* Bolinha da timeline */}
                <div className={cn(
                  'absolute left-1.5 top-3.5 h-4 w-4 rounded-full border-2 border-background',
                  idx === 0 ? 'bg-primary' : isRascunho ? 'bg-yellow-500' : 'bg-muted-foreground/40'
                )} />

                <Card className={cn('p-4', isRascunho && 'border-yellow-500/40 bg-yellow-500/5')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {item.versao && (
                          <span className="text-xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            {item.versao}
                          </span>
                        )}
                        {isRascunho && (
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
                            Rascunho
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{dataExib}</span>
                      </div>
                      <h3 className="font-semibold text-foreground mt-1 text-sm leading-snug">{item.titulo}</h3>
                    </div>

                    <button
                      onClick={() => setExpandido(isExpanded ? null : item.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Conteúdo expandido */}
                  {isExpanded && (
                    <div className="mt-3 space-y-3">
                      <div className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed border-t border-border pt-3">
                        {item.descricao}
                      </div>

                      {/* Ações admin */}
                      {isAdmin && dinamico && isRascunho && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => publicar(item.id)}
                            disabled={salvando}
                            className="gap-2"
                          >
                            <Bell className="h-3.5 w-3.5" />
                            Publicar e notificar todos
                          </Button>
                        </div>
                      )}

                      {/* Stats de feedback */}
                      {dinamico && dinamico.publicada && (
                        <div className="flex items-center gap-4 pt-1 border-t border-border">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            {aprovacoes} aprovação{aprovacoes !== 1 ? 'ões' : ''}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MessageSquarePlus className="h-3.5 w-3.5 text-blue-400" />
                            {sugestoes} sugestão{sugestoes !== 1 ? 'ões' : ''}
                          </span>
                          {isAdmin && sugestoes > 0 && (
                            <button
                              onClick={() => setFeedbackAberto(feedbackAberto === item.id + '_ver' ? null : item.id + '_ver')}
                              className="text-xs text-primary hover:underline ml-auto"
                            >
                              <Pencil className="h-3 w-3 inline mr-1" />
                              Ver sugestões
                            </button>
                          )}
                        </div>
                      )}

                      {/* Ver sugestões (admin) */}
                      {isAdmin && feedbackAberto === item.id + '_ver' && dinamico && (
                        <div className="space-y-2 bg-muted/30 rounded-lg p-3">
                          {dinamico.feedbacks.filter(f => f.tipo === 'sugestao' && f.mensagem).map((f, i) => (
                            <div key={i} className="text-xs text-foreground bg-background rounded p-2 border border-border">
                              <p className="font-medium text-muted-foreground mb-0.5">Usuário {f.usuario_id.slice(0, 8)}...</p>
                              <p>{f.mensagem}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Botões de feedback (usuário) */}
                      {!isAdmin && dinamico && dinamico.publicada && (
                        <div className="pt-1 border-t border-border">
                          {fb ? (
                            <p className="text-xs text-muted-foreground">
                              Você {fb.tipo === 'aprovado' ? 'aprovou esta atualização ✓' : 'enviou uma sugestão ✓'}
                            </p>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-green-500 border-green-500/30 hover:bg-green-500/10"
                                  onClick={() => enviarFeedback(item.id, 'aprovado')}
                                  disabled={salvando}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Aprovar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-blue-400 border-blue-400/30 hover:bg-blue-400/10"
                                  onClick={() => setFeedbackAberto(feedbackAberto === item.id ? null : item.id)}
                                  disabled={salvando}
                                >
                                  <MessageSquarePlus className="h-3.5 w-3.5" />
                                  Sugerir melhoria
                                </Button>
                              </div>
                              {feedbackAberto === item.id && (
                                <div className="flex gap-2">
                                  <input
                                    className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    placeholder="Descreva sua sugestão..."
                                    value={sugestao}
                                    onChange={e => setSugestao(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && enviarFeedback(item.id, 'sugestao')}
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => enviarFeedback(item.id, 'sugestao')}
                                    disabled={salvando || !sugestao.trim()}
                                  >
                                    <Send className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
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
    </div>
  )
}
