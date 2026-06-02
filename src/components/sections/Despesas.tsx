'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Despesa } from '@/lib/supabase/types'
import {
  Badge, Btn, Card, CardTitle, ConfirmDelete, Input, Modal,
  RowActions, Select, Table, Td, Toast, Tr, brl, fmtData,
} from '@/components/ui'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

const hoje = new Date().toISOString().substring(0, 10)

export default function Despesas({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [despesas, setDespesas] = useState<Despesa[]>([])
  const [toast, setToast] = useState('')
  const [editando, setEditando] = useState<Despesa | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const [data, setData] = useState(hoje)
  const [desc, setDesc] = useState('')
  const [valor, setValor] = useState('')
  const [categoria, setCategoria] = useState('Aluguel')
  const [doc, setDoc] = useState('')
  const [pagoBanco, setPagoBanco] = useState(true)
  const [dedutivel, setDedutivel] = useState<'sim' | 'parcial' | 'nao'>('sim')

  const carregar = useCallback(async () => {
    const { data: rows } = await supabase.from('despesas').select('*')
      .eq('cliente_id', clienteId).eq('periodo', periodo).order('data', { ascending: false })
    setDespesas((rows || []) as Despesa[])
  }, [clienteId, periodo])

  useEffect(() => { carregar() }, [carregar, refresh])

  async function adicionar() {
    if (!desc || !valor) return
    setSalvando(true)
    const { error } = await supabase.from('despesas').insert({
      cliente_id: clienteId, periodo: data.substring(0, 7), data, descricao: desc,
      valor: parseFloat(valor), categoria, documento: doc || null,
      pago_banco: pagoBanco, dedutivel,
    })
    if (error) { setToast(`Erro: ${error.message}`); setSalvando(false); return }
    setDesc(''); setValor(''); setDoc('')
    await carregar(); onRecarregar(); setToast('Despesa adicionada!'); setSalvando(false)
  }

  async function salvarEdicao() {
    if (!editando) return
    const { error } = await supabase.from('despesas').update({
      data: editando.data, descricao: editando.descricao,
      valor: editando.valor, categoria: editando.categoria,
      documento: editando.documento || null,
      pago_banco: editando.pago_banco, dedutivel: editando.dedutivel,
    }).eq('id', editando.id)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setEditando(null); await carregar(); onRecarregar(); setToast('Despesa atualizada!')
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const { error } = await supabase.from('despesas').delete().eq('id', excluindo)
    if (error) { setToast(`Erro: ${error.message}`); setExcluindo(null); return }
    setExcluindo(null); await carregar(); onRecarregar(); setToast('Despesa excluída!')
  }

  const total  = despesas.reduce((s, d) => s + d.valor, 0)
  const semDoc = despesas.filter(d => d.status === 'sem_doc').reduce((s, d) => s + d.valor, 0)

  return (
    <div>
      <Card className="mb-4">
        <CardTitle>Registrar Despesa</CardTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label="Data" type="date" value={data} onChange={e => setData(e.target.value)} />
          <Input label="Descrição" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Aluguel, Energia..." />
          <Input label="Valor (R$)" type="number" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" />
          <Select label="Categoria" value={categoria} onChange={e => setCategoria(e.target.value)}>
            <option>Aluguel</option><option>Energia Elétrica</option><option>Folha de Pagamento</option>
            <option>Pró-Labore</option><option>Telefone/Internet</option><option>Contabilidade</option>
            <option>Marketing</option><option>Manutenção</option><option>Outro</option>
          </Select>
          <Input label="Documento Fiscal" value={doc} onChange={e => setDoc(e.target.value)} placeholder="NF, Recibo (vazio = sem doc)" />
          <Select label="Pago pelo Banco?" value={pagoBanco ? 'sim' : 'nao'} onChange={e => setPagoBanco(e.target.value === 'sim')}>
            <option value="sim">Sim — Saiu da Conta</option>
            <option value="nao">Não — Caixa / Outro</option>
          </Select>
          <Select label="Dedutível?" value={dedutivel} onChange={e => setDedutivel(e.target.value as typeof dedutivel)}>
            <option value="sim">Sim</option>
            <option value="parcial">Parcialmente</option>
            <option value="nao">Não</option>
          </Select>
          <div className="flex items-end">
            <Btn onClick={adicionar} disabled={salvando || !desc || !valor} className="w-full justify-center">
              + Adicionar
            </Btn>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle sub={`Total: ${brl(total)}${semDoc > 0 ? ` · ${brl(semDoc)} sem comprovante ⚠` : ''}`}>
          Despesas do Mês
        </CardTitle>
        <Table headers={['Data', 'Descrição', 'Categoria', 'Valor', 'Documento', 'No Banco', 'Status', '']}>
          {despesas.map(d => (
            <Tr key={d.id}>
              <Td>{fmtData(d.data)}</Td>
              <Td>{d.descricao}</Td>
              <Td>{d.categoria}</Td>
              <Td>{brl(d.valor)}</Td>
              <Td mono>{d.documento || <span className="text-red-400">Sem doc ⚠</span>}</Td>
              <Td>{d.pago_banco ? '✓ Sim' : 'Não'}</Td>
              <Td><Badge variant={d.status === 'ok' ? 'ok' : 'err'}>{d.status === 'ok' ? '✓ OK' : '⚠ Sem doc'}</Badge></Td>
              <Td><RowActions onEdit={() => setEditando({ ...d })} onDelete={() => setExcluindo(d.id)} /></Td>
            </Tr>
          ))}
        </Table>
        {despesas.length === 0 && <p className="text-center py-8 text-muted-foreground text-sm">Nenhuma despesa registrada</p>}
      </Card>

      {editando && (
        <Modal title="Editar Despesa" onClose={() => setEditando(null)}>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <Input label="Data" type="date" value={editando.data} onChange={e => setEditando({ ...editando, data: e.target.value })} />
            <Input label="Descrição" value={editando.descricao} onChange={e => setEditando({ ...editando, descricao: e.target.value })} />
            <Input label="Valor (R$)" type="number" value={String(editando.valor)} onChange={e => setEditando({ ...editando, valor: parseFloat(e.target.value) || 0 })} />
            <Select label="Categoria" value={editando.categoria || ''} onChange={e => setEditando({ ...editando, categoria: e.target.value })}>
              <option>Aluguel</option><option>Energia Elétrica</option><option>Folha de Pagamento</option>
              <option>Pró-Labore</option><option>Telefone/Internet</option><option>Contabilidade</option>
              <option>Marketing</option><option>Manutenção</option><option>Outro</option>
            </Select>
            <Input label="Documento Fiscal" value={editando.documento || ''} onChange={e => setEditando({ ...editando, documento: e.target.value || null })} placeholder="NF, Recibo..." />
            <Select label="Pago pelo Banco?" value={editando.pago_banco ? 'sim' : 'nao'} onChange={e => setEditando({ ...editando, pago_banco: e.target.value === 'sim' })}>
              <option value="sim">Sim</option><option value="nao">Não</option>
            </Select>
            <Select label="Dedutível?" value={editando.dedutivel} onChange={e => setEditando({ ...editando, dedutivel: e.target.value as Despesa['dedutivel'] })}>
              <option value="sim">Sim</option><option value="parcial">Parcialmente</option><option value="nao">Não</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Btn variant="ghost" onClick={() => setEditando(null)}>Cancelar</Btn>
            <Btn onClick={salvarEdicao}>Salvar</Btn>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ConfirmDelete onConfirm={confirmarExclusao} onCancel={() => setExcluindo(null)} />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}
