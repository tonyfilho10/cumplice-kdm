'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Cliente } from '@/lib/supabase/types'
import { Btn, Card, CardTitle, ConfirmDelete, Input, Modal, RowActions, Select, Table, Td, Toast, Tr, Badge } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { Plus, Users } from 'lucide-react'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

type Usuario = {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  vinculos: { cliente_id: string; papel: string }[]
}

const vazio = () => ({
  email: '',
  senha: '',
  confirmarSenha: '',
  papel: 'contador',
  cliente_ids: [] as string[],
})

export default function Usuarios({ onRecarregar }: Props) {
  const supabase = createClient()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [toast, setToast] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [modalAberto, setModalAberto] = useState(false)
  const [modoEdicao, setModoEdicao] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [form, setForm] = useState(vazio())
  const [salvando, setSalvando] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [euId, setEuId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: { user } } = await supabase.auth.getUser()
    setEuId(user?.id || null)

    // Busca todos os usuários + todos os clientes em paralelo
    const [resUsuarios, resClientes] = await Promise.all([
      fetch('/api/usuarios'),
      supabase.from('clientes').select('*').eq('ativo', true).order('razao_social'),
    ])

    if (resUsuarios.ok) setUsuarios(await resUsuarios.json())
    setClientes((resClientes.data || []) as Cliente[])

    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo() {
    setForm(vazio())
    setEditandoId(null)
    setModoEdicao(false)
    setModalAberto(true)
  }

  function abrirEdicao(u: Usuario) {
    setForm({
      email: u.email,
      senha: '',
      confirmarSenha: '',
      papel: u.vinculos[0]?.papel || 'contador',
      cliente_ids: u.vinculos.map(v => v.cliente_id),
    })
    setEditandoId(u.id)
    setModoEdicao(true)
    setModalAberto(true)
  }

  function toggleCliente(id: string) {
    setForm(f => ({
      ...f,
      cliente_ids: f.cliente_ids.includes(id)
        ? f.cliente_ids.filter(c => c !== id)
        : [...f.cliente_ids, id],
    }))
  }

  async function salvar() {
    if (!form.email) { setToast('Erro: E-mail é obrigatório'); return }
    if (!modoEdicao && !form.senha) { setToast('Erro: Senha é obrigatória'); return }
    if (!modoEdicao && form.senha !== form.confirmarSenha) { setToast('Erro: Senhas não coincidem'); return }

    setSalvando(true)

    const payload = {
      email: form.email,
      senha: form.senha || undefined,
      papel: form.papel,
      // cliente_ids removido: todos os usuários têm acesso a todas as empresas
    }

    const res = modoEdicao
      ? await fetch(`/api/usuarios/${editandoId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

    const result = await res.json()
    if (!res.ok || result.erro) {
      setToast(`Erro: ${result.erro || 'Falha ao salvar'}`)
      setSalvando(false)
      return
    }

    setModalAberto(false)
    setSalvando(false)
    setToast(modoEdicao ? 'Usuário atualizado!' : 'Usuário criado!')
    await carregar()
    onRecarregar()
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const res = await fetch(`/api/usuarios/${excluindo}`, { method: 'DELETE' })
    const result = await res.json()
    if (!res.ok || result.erro) { setToast(`Erro: ${result.erro}`); setExcluindo(null); return }
    setExcluindo(null)
    setToast('Usuário removido!')
    await carregar()
    onRecarregar()
  }

  function formatData(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  }

  const usuarioExcluindo = usuarios.find(u => u.id === excluindo)

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Usuários do Sistema</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{usuarios.length} usuário{usuarios.length !== 1 ? 's' : ''} cadastrado{usuarios.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={abrirNovo} size="sm" className="gap-2 text-xs">
          <Plus className="h-3.5 w-3.5" />
          Novo Usuário
        </Button>
      </div>

      {carregando ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Carregando...</div>
      ) : usuarios.length === 0 ? (
        <Card className="py-16">
          <div className="text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhum usuário cadastrado</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {usuarios.map(u => {
            const papel = u.vinculos[0]?.papel || 'contador'
            const isVoce = u.id === euId
            const acessou = u.last_sign_in_at

            return (
              <div key={u.id}
                className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-colors
                  ${isVoce ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:bg-secondary/40'}`}
              >
                {/* Avatar inicial */}
                <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0
                  ${isVoce ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                  {u.email[0].toUpperCase()}
                </div>

                {/* Email + você */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">{u.email}</span>
                    {isVoce && (
                      <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                        você
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[11px] text-muted-foreground">
                      Criado em {formatData(u.created_at)}
                    </span>
                    {acessou ? (
                      <span className="text-[11px] text-green-500">
                        Último acesso {formatData(u.last_sign_in_at)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/60">Nunca acessou</span>
                    )}
                  </div>
                </div>

                {/* Papel */}
                <PapelBadge papel={papel} />

                {/* Acesso */}
                <span className="text-[11px] text-muted-foreground bg-secondary border border-border px-2 py-1 rounded-lg whitespace-nowrap hidden md:block">
                  🏢 Todas as empresas
                </span>

                {/* Ações */}
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => abrirEdicao(u)}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                  </button>
                  {!isVoce && (
                    <button onClick={() => setExcluindo(u.id)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal criar / editar */}
      {modalAberto && (
        <Modal
          title={modoEdicao ? 'Editar Usuário' : 'Novo Usuário'}
          onClose={() => setModalAberto(false)}
        >
          <div className="space-y-3 mt-1">
            <Input
              label="E-mail *"
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="usuario@email.com"
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label={modoEdicao ? 'Nova Senha (deixe vazio para manter)' : 'Senha *'}
                type="password"
                value={form.senha}
                onChange={e => setForm({ ...form, senha: e.target.value })}
                placeholder="••••••••"
              />
              <Input
                label="Confirmar Senha"
                type="password"
                value={form.confirmarSenha}
                onChange={e => setForm({ ...form, confirmarSenha: e.target.value })}
                placeholder="••••••••"
              />
            </div>

            <Select
              label="Papel"
              value={form.papel}
              onChange={e => setForm({ ...form, papel: e.target.value })}
            >
              <option value="contador">Contador</option>
              <option value="dono">Dono / Sócio</option>
              <option value="admin">Admin</option>
            </Select>

            {/* Acesso global — sem seleção de clientes */}
            <div className="col-span-2 flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <span className="text-primary text-sm">🏢</span>
              <p className="text-xs text-muted-foreground">
                O usuário terá acesso a <strong className="text-foreground">todas as empresas</strong> automaticamente.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <Btn variant="ghost" onClick={() => setModalAberto(false)}>Cancelar</Btn>
            <Btn onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando...' : modoEdicao ? 'Salvar Alterações' : 'Criar Usuário'}
            </Btn>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ConfirmDelete
          msg={`Excluir "${usuarioExcluindo?.email}"? O usuário perderá o acesso ao sistema permanentemente.`}
          onConfirm={confirmarExclusao}
          onCancel={() => setExcluindo(null)}
        />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}

function PapelBadge({ papel }: { papel: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    admin:    { label: 'Admin',    cls: 'bg-purple-500/15 text-purple-400 border-purple-500/25' },
    dono:     { label: 'Sócio',    cls: 'bg-amber-500/15  text-amber-400  border-amber-500/25'  },
    contador: { label: 'Contador', cls: 'bg-blue-500/15   text-blue-400   border-blue-500/25'   },
  }
  const c = cfg[papel] ?? cfg.contador
  return (
    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${c.cls}`}>
      {c.label}
    </span>
  )
}
