'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Cliente } from '@/lib/supabase/types'
import { Btn, Card, ConfirmDelete, Input, Modal, Select, Toast } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { Plus, Users, ShieldCheck, UserCircle2, Briefcase, Star } from 'lucide-react'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

type Usuario = {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  vinculos: { cliente_id: string; papel: string }[]
}

const vazio = () => ({ email: '', senha: '', confirmarSenha: '', papel: 'contador' })

const PAPEIS = [
  { value: 'contador', label: 'Financeiro', desc: 'Visualiza e lança dados',                          icon: UserCircle2, cor: 'text-blue-400',   bg: 'bg-blue-500/15   border-blue-500/30'   },
  { value: 'dono',     label: 'Sócio/Dono', desc: 'Visão gerencial — sem acesso a fiscal/contábil',   icon: Briefcase,   cor: 'text-amber-400',  bg: 'bg-amber-500/15  border-amber-500/30'  },
  { value: 'admin',    label: 'Admin',       desc: 'Pode fechar períodos + gerenciar',                 icon: ShieldCheck, cor: 'text-purple-400', bg: 'bg-purple-500/15 border-purple-500/30' },
  { value: 'standard', label: 'Standard',   desc: 'Acesso básico — sem módulos fiscais/contábeis',    icon: Star,        cor: 'text-green-400',  bg: 'bg-green-500/15  border-green-500/30'  },
]

function fmtData(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function Usuarios({ onRecarregar }: Props) {
  const supabase = createClient()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [carregando, setCarregando] = useState(true)
  const [toast, setToast] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [modoEdicao, setModoEdicao] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [form, setForm] = useState(vazio())
  const [salvando, setSalvando] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [euId, setEuId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      setEuId(user?.id || null)
      const [resUsuarios, resClientes] = await Promise.all([
        fetch('/api/usuarios'),
        supabase.from('clientes').select('*').eq('ativo', true).order('razao_social'),
      ])
      if (resUsuarios.ok) setUsuarios(await resUsuarios.json())
      setClientes((resClientes.data || []) as Cliente[])
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo() { setForm(vazio()); setEditandoId(null); setModoEdicao(false); setModalAberto(true) }

  function abrirEdicao(u: Usuario) {
    setForm({ email: u.email, senha: '', confirmarSenha: '', papel: u.vinculos[0]?.papel || 'contador' })
    setEditandoId(u.id); setModoEdicao(true); setModalAberto(true)
  }

  async function salvar() {
    if (!form.email) { setToast('Erro: E-mail é obrigatório'); return }
    if (!modoEdicao && !form.senha) { setToast('Erro: Senha é obrigatória'); return }
    if (!modoEdicao && form.senha !== form.confirmarSenha) { setToast('Erro: Senhas não coincidem'); return }
    setSalvando(true)
    const payload = { email: form.email, senha: form.senha || undefined, papel: form.papel }
    const res = modoEdicao
      ? await fetch(`/api/usuarios/${editandoId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const result = await res.json()
    if (!res.ok || result.erro) { setToast(`Erro: ${result.erro || 'Falha ao salvar'}`); setSalvando(false); return }
    setModalAberto(false); setSalvando(false)
    setToast(modoEdicao ? 'Usuário atualizado!' : 'Usuário criado!')
    await carregar(); onRecarregar()
  }

  async function mudarPapel(userId: string, papel: string) {
    const res = await fetch(`/api/usuarios/${userId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ papel }),
    })
    const result = await res.json()
    if (!res.ok) { setToast(`Erro: ${result.erro}`); return }
    setUsuarios(prev => prev.map(u =>
      u.id === userId ? { ...u, vinculos: u.vinculos.map(v => ({ ...v, papel })) } : u
    ))
    setToast('Papel atualizado!')
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const res = await fetch(`/api/usuarios/${excluindo}`, { method: 'DELETE' })
    const result = await res.json()
    if (!res.ok || result.erro) { setToast(`Erro: ${result.erro}`); setExcluindo(null); return }
    setExcluindo(null); setToast('Usuário removido!'); await carregar(); onRecarregar()
  }

  const usuarioExcluindo = usuarios.find(u => u.id === excluindo)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Usuários do Sistema</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {carregando ? 'Carregando...' : `${usuarios.length} usuário${usuarios.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button onClick={abrirNovo} size="sm" className="gap-2 text-xs">
          <Plus className="h-3.5 w-3.5" /> Novo Usuário
        </Button>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Carregando usuários...</span>
        </div>
      ) : usuarios.length === 0 ? (
        <Card className="py-16">
          <div className="text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhum usuário cadastrado</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {usuarios.map(u => {
            const papel = u.vinculos[0]?.papel || 'contador'
            const papelInfo = PAPEIS.find(p => p.value === papel) || PAPEIS[0]
            const PapelIcon = papelInfo.icon
            const isVoce = u.id === euId

            return (
              <div key={u.id} className={`rounded-xl border p-4 transition-colors ${
                isVoce ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'
              }`}>
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                    isVoce ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                  }`}>
                    {u.email[0].toUpperCase()}
                  </div>

                  {/* Info principal */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{u.email}</span>
                      {isVoce && (
                        <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">você</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-[11px] text-muted-foreground">Desde {fmtData(u.created_at)}</span>
                      {u.last_sign_in_at
                        ? <span className="text-[11px] text-green-500">Acessou {fmtData(u.last_sign_in_at)}</span>
                        : <span className="text-[11px] text-muted-foreground/50">Nunca acessou</span>}
                    </div>

                    {/* Seletor de papel — linha separada, bem visível */}
                    <div className="mt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Papel / Permissão</p>
                      <div className="flex gap-2 flex-wrap">
                        {PAPEIS.map(p => {
                          const Icon = p.icon
                          const ativo = papel === p.value
                          return (
                            <button
                              key={p.value}
                              onClick={() => !isVoce && mudarPapel(u.id, p.value)}
                              disabled={isVoce}
                              title={p.desc}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                                isVoce ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-90'
                              } ${ativo
                                ? `${p.bg} ${p.cor} ring-1 ring-offset-1 ring-offset-card ${p.bg.replace('bg-', 'ring-').replace('/15', '/50')}`
                                : 'border-border bg-secondary text-muted-foreground hover:border-primary/30'
                              }`}
                            >
                              <Icon className="h-3 w-3 shrink-0" />
                              {p.label}
                              {ativo && <span className="ml-0.5">✓</span>}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{papelInfo.desc}</p>
                    </div>
                  </div>

                  {/* Ações */}
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => abrirEdicao(u)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Editar email/senha">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                      </svg>
                    </button>
                    {!isVoce && (
                      <button onClick={() => setExcluindo(u.id)}
                        className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Excluir usuário">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal criar/editar (só email + senha) */}
      {modalAberto && (
        <Modal title={modoEdicao ? 'Editar Usuário' : 'Novo Usuário'} onClose={() => setModalAberto(false)}>
          <div className="space-y-3 mt-1">
            <Input label="E-mail *" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="usuario@email.com" />
            <div className="grid grid-cols-2 gap-3">
              <Input label={modoEdicao ? 'Nova Senha (opcional)' : 'Senha *'} type="password" value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} placeholder="••••••••" />
              <Input label="Confirmar Senha" type="password" value={form.confirmarSenha} onChange={e => setForm({ ...form, confirmarSenha: e.target.value })} placeholder="••••••••" />
            </div>
            {!modoEdicao && (
              <Select label="Papel inicial" value={form.papel} onChange={e => setForm({ ...form, papel: e.target.value })}>
                {PAPEIS.map(p => <option key={p.value} value={p.value}>{p.label} — {p.desc}</option>)}
              </Select>
            )}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <span className="text-sm">🏢</span>
              <p className="text-xs text-muted-foreground">Acesso a <strong className="text-foreground">todas as empresas</strong> automaticamente.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Btn variant="ghost" onClick={() => setModalAberto(false)}>Cancelar</Btn>
            <Btn onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : modoEdicao ? 'Salvar' : 'Criar Usuário'}</Btn>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ConfirmDelete
          msg={`Excluir "${usuarioExcluindo?.email}"? O usuário perderá o acesso permanentemente.`}
          onConfirm={confirmarExclusao}
          onCancel={() => setExcluindo(null)}
        />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}
