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

    const [resUsuarios, resClientes] = await Promise.all([
      fetch('/api/usuarios'),
      fetch('/api/clientes-lista'),
    ])

    if (resUsuarios.ok) setUsuarios(await resUsuarios.json())

    // Busca clientes diretamente pelo Supabase client
    if (user) {
      const { data: uc } = await supabase.from('usuario_clientes').select('cliente_id').eq('usuario_id', user.id)
      const ids = (uc || []).map(r => r.cliente_id)
      if (ids.length) {
        const { data: cls } = await supabase.from('clientes').select('*').in('id', ids).eq('ativo', true).order('razao_social')
        setClientes((cls || []) as Cliente[])
      }
    }

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
        <Card>
          <Table headers={['E-mail', 'Papel', 'Clientes', 'Criado em', 'Último acesso', '']}>
            {usuarios.map(u => (
              <Tr key={u.id}>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{u.email}</span>
                    {u.id === euId && (
                      <span className="text-[10px] font-bold bg-primary/15 text-primary px-1.5 py-0.5 rounded">você</span>
                    )}
                  </div>
                </Td>
                <Td>
                  <Badge variant={u.vinculos[0]?.papel === 'dono' ? 'ok' : 'pending'}>
                    {u.vinculos[0]?.papel || 'contador'}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {u.vinculos.map(v => {
                      const c = clientes.find(cl => cl.id === v.cliente_id)
                      return c ? (
                        <span key={v.cliente_id} className="text-[11px] bg-secondary border border-border px-1.5 py-0.5 rounded text-muted-foreground">
                          {c.razao_social.split(' ')[0]}
                        </span>
                      ) : null
                    })}
                    {u.vinculos.length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                  </div>
                </Td>
                <Td>{formatData(u.created_at)}</Td>
                <Td>
                  {u.last_sign_in_at
                    ? <span className="text-green-400 text-xs">{formatData(u.last_sign_in_at)}</span>
                    : <span className="text-muted-foreground text-xs">Nunca</span>}
                </Td>
                <Td>
                  <RowActions
                    onEdit={() => abrirEdicao(u)}
                    onDelete={() => u.id !== euId && setExcluindo(u.id)}
                  />
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
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
