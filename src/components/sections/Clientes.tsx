'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Cliente } from '@/lib/supabase/types'
import {
  Btn, Card, ConfirmDelete, Input, Modal, RowActions,
  Select, Table, Td, Toast, Tr,
} from '@/components/ui'
import { Plus, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

const REGIMES = [
  'Simples Nacional – Anexo I',
  'Simples Nacional – Anexo II',
  'Simples Nacional – Anexo III',
  'Simples Nacional – Anexo IV',
  'Simples Nacional – Anexo V',
  'Lucro Presumido',
  'Lucro Real',
  'MEI',
]

const SETORES = [
  'Comércio – Mercado/Supermercado',
  'Comércio – Farmácia',
  'Comércio – Vestuário',
  'Comércio – Materiais de Construção',
  'Comércio – Outros',
  'Serviços – Saúde',
  'Serviços – Educação',
  'Serviços – Tecnologia',
  'Serviços – Contabilidade',
  'Serviços – Outros',
  'Indústria',
  'Agropecuária',
]

const vazio = (): Partial<Cliente> => ({
  razao_social: '',
  cnpj: '',
  regime: 'Simples Nacional – Anexo I',
  setor: 'Comércio – Mercado/Supermercado',
  responsavel: '',
  email: '',
  telefone: '',
  banco_principal: '',
  limite_alerta_imposto: 5.5,
})

export default function Clientes({ onRecarregar }: Props) {
  const supabase = createClient()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [toast, setToast] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Partial<Cliente>>(vazio())
  const [modoEdicao, setModoEdicao] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: uc } = await supabase
      .from('usuario_clientes')
      .select('cliente_id')
      .eq('usuario_id', user.id)

    const ids = (uc || []).map(r => r.cliente_id)

    if (ids.length === 0) {
      setClientes([])
      setCarregando(false)
      return
    }

    const { data } = await supabase
      .from('clientes')
      .select('*')
      .in('id', ids)
      .order('razao_social')

    setClientes((data || []) as Cliente[])
    setCarregando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirNovo() {
    setEditando(vazio())
    setModoEdicao(false)
    setModalAberto(true)
  }

  function abrirEdicao(c: Cliente) {
    setEditando({ ...c })
    setModoEdicao(true)
    setModalAberto(true)
  }

  // Recarrega a lista do banco filtrando pelos clientes do usuário
  async function recarregarLista() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: uc } = await supabase.from('usuario_clientes').select('cliente_id').eq('usuario_id', user.id)
    const ids = (uc || []).map(r => r.cliente_id)
    if (!ids.length) { setClientes([]); return }
    const { data } = await supabase.from('clientes').select('*').in('id', ids).order('razao_social')
    setClientes((data || []) as Cliente[])
  }

  async function salvar() {
    if (!editando.razao_social || !editando.cnpj) {
      setToast('Erro: Razão Social e CNPJ são obrigatórios')
      return
    }
    setSalvando(true)

    if (modoEdicao && editando.id) {
      // Atualiza otimistamente antes de fechar o modal
      setClientes(prev => prev.map(c =>
        c.id === editando.id ? { ...c, ...editando } as Cliente : c
      ))
      setModalAberto(false)

      const { error } = await supabase.from('clientes').update({
        razao_social: editando.razao_social,
        cnpj: editando.cnpj,
        regime: editando.regime,
        setor: editando.setor,
        responsavel: editando.responsavel || null,
        email: editando.email || null,
        telefone: editando.telefone || null,
        banco_principal: editando.banco_principal || null,
        limite_alerta_imposto: editando.limite_alerta_imposto ?? 5.5,
      }).eq('id', editando.id)

      if (error) {
        setToast(`Erro: ${error.message}`)
        await recarregarLista() // reverte se falhou
      } else {
        setToast('Empresa atualizada!')
        onRecarregar()
      }
    } else {
      const { data: novo, error } = await supabase
        .from('clientes')
        .insert({
          razao_social: editando.razao_social,
          cnpj: editando.cnpj,
          regime: editando.regime || 'Simples Nacional – Anexo I',
          setor: editando.setor || null,
          responsavel: editando.responsavel || null,
          email: editando.email || null,
          telefone: editando.telefone || null,
          banco_principal: editando.banco_principal || null,
          limite_alerta_imposto: editando.limite_alerta_imposto ?? 5.5,
          ativo: true,
        })
        .select()
        .single()

      if (error || !novo) { setToast(`Erro: ${error?.message}`); setSalvando(false); return }

      // Adiciona otimistamente na lista
      setClientes(prev => [...prev, novo as Cliente].sort((a, b) => a.razao_social.localeCompare(b.razao_social)))
      setModalAberto(false)

      // Vincula ao usuário + thresholds em background
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await Promise.all([
          supabase.from('usuario_clientes').insert({ usuario_id: user.id, cliente_id: novo.id, papel: 'contador' }),
          supabase.from('thresholds').insert({ cliente_id: novo.id, divergencia_banco_nf: 500, compra_sem_nf: 200, despesa_sem_doc: 300, sublimite_simples_pct: 80 }),
        ])
      }

      setToast('Empresa criada com sucesso!')
      onRecarregar()
    }

    setSalvando(false)
  }

  async function confirmarExclusao() {
    if (!excluindo) return

    const nomeEmpresa = clientes.find(c => c.id === excluindo)?.razao_social

    // Remove otimistamente da lista imediatamente
    setClientes(prev => prev.filter(c => c.id !== excluindo))
    setExcluindo(null)

    // Hard delete — exclui o cliente do banco permanentemente
    const { error } = await supabase.from('clientes').delete().eq('id', excluindo)

    if (error) {
      setToast(`Erro: ${error.message}`)
      await recarregarLista() // restaura se falhou
    } else {
      setToast(`"${nomeEmpresa}" excluída!`)
      onRecarregar()
    }
  }

  return (
    <div>
      {/* Header com ação */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Empresas Cadastradas</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {clientes.length} empresa{clientes.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={abrirNovo} size="sm" className="gap-2 text-xs">
          <Plus className="h-3.5 w-3.5" />
          Nova Empresa
        </Button>
      </div>

      {carregando ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Carregando...</div>
      ) : clientes.length === 0 ? (
        <Card className="py-16">
          <div className="text-center text-muted-foreground">
            <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhuma empresa cadastrada</p>
            <p className="text-xs mt-1">Clique em "Nova Empresa" para começar</p>
          </div>
        </Card>
      ) : (
        <Card>
          <Table headers={['Empresa', 'CNPJ', 'Regime', 'Responsável', 'Contato', '']}>
            {clientes.map(c => (
              <Tr key={c.id}>
                <Td>
                  <div>
                    <p className="font-semibold text-foreground text-sm">{c.razao_social}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.setor || '—'}</p>
                  </div>
                </Td>
                <Td mono>{c.cnpj}</Td>
                <Td>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-md">
                    {c.regime.replace('Simples Nacional – ', 'SN ')}
                  </span>
                </Td>
                <Td>{c.responsavel || <span className="text-muted-foreground">—</span>}</Td>
                <Td>
                  <div className="text-xs space-y-0.5">
                    {c.email && <p>{c.email}</p>}
                    {c.telefone && <p className="text-muted-foreground">{c.telefone}</p>}
                    {!c.email && !c.telefone && <span className="text-muted-foreground">—</span>}
                  </div>
                </Td>
                <Td>
                  <RowActions
                    onEdit={() => abrirEdicao(c)}
                    onDelete={() => setExcluindo(c.id)}
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
          title={modoEdicao ? `Editar — ${editando.razao_social}` : 'Nova Empresa'}
          onClose={() => setModalAberto(false)}
        >
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div className="col-span-2">
              <Input
                label="Razão Social *"
                value={editando.razao_social || ''}
                onChange={e => setEditando({ ...editando, razao_social: e.target.value })}
                placeholder="Nome da empresa Ltda"
              />
            </div>
            <Input
              label="CNPJ *"
              value={editando.cnpj || ''}
              onChange={e => setEditando({ ...editando, cnpj: e.target.value })}
              placeholder="00.000.000/0001-00"
            />
            <Select
              label="Regime Tributário"
              value={editando.regime || ''}
              onChange={e => setEditando({ ...editando, regime: e.target.value })}
            >
              {REGIMES.map(r => <option key={r}>{r}</option>)}
            </Select>
            <div className="col-span-2">
              <Select
                label="Setor"
                value={editando.setor || ''}
                onChange={e => setEditando({ ...editando, setor: e.target.value })}
              >
                {SETORES.map(s => <option key={s}>{s}</option>)}
              </Select>
            </div>
            <Input
              label="Responsável / Sócio"
              value={editando.responsavel || ''}
              onChange={e => setEditando({ ...editando, responsavel: e.target.value })}
              placeholder="Nome completo"
            />
            <Input
              label="Telefone"
              value={editando.telefone || ''}
              onChange={e => setEditando({ ...editando, telefone: e.target.value })}
              placeholder="(11) 99999-9999"
            />
            <div className="col-span-2">
              <Input
                label="E-mail"
                type="email"
                value={editando.email || ''}
                onChange={e => setEditando({ ...editando, email: e.target.value })}
                placeholder="contato@empresa.com.br"
              />
            </div>
            <Input
              label="Conta Bancária Principal"
              value={editando.banco_principal || ''}
              onChange={e => setEditando({ ...editando, banco_principal: e.target.value })}
              placeholder="Ex: Itaú CC 12345-6"
            />
            <Input
              label="Alerta Imposto (%)"
              type="number"
              value={String(editando.limite_alerta_imposto ?? 5.5)}
              onChange={e => setEditando({ ...editando, limite_alerta_imposto: parseFloat(e.target.value) })}
            />
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Btn variant="ghost" onClick={() => setModalAberto(false)}>Cancelar</Btn>
            <Btn onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando...' : modoEdicao ? 'Salvar Alterações' : 'Criar Empresa'}
            </Btn>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ConfirmDelete
          msg={`Excluir permanentemente "${clientes.find(c => c.id === excluindo)?.razao_social}"? Todos os dados desta empresa (compras, notas, banco, despesas) serão removidos e não poderão ser recuperados.`}
          onConfirm={confirmarExclusao}
          onCancel={() => setExcluindo(null)}
        />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}
