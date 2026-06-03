'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { NotaFiscal } from '@/lib/supabase/types'
import {
  Badge, Btn, Card, CardTitle, ConfirmDelete, Input, Modal,
  RowActions, Select, Table, Td, Toast, Tr, UploadZone, brl, fmtData,
} from '@/components/ui'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

const hoje = new Date().toISOString().substring(0, 10)

export default function NotasFiscais({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [toast, setToast] = useState('')
  const [editando, setEditando] = useState<NotaFiscal | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [importando, setImportando] = useState(false)

  const [data, setData] = useState(hoje)
  const [numero, setNumero] = useState('')
  const [clienteNF, setClienteNF] = useState('')
  const [valor, setValor] = useState('')
  const [cfop, setCFOP] = useState('5102')
  const [recebimento, setRecebimento] = useState('À Vista')
  const [dataRec, setDataRec] = useState(hoje)

  const carregar = useCallback(async () => {
    const { data: rows } = await supabase.from('notas_fiscais').select('*')
      .eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false).order('data', { ascending: false })
    setNotas((rows || []) as NotaFiscal[])
  }, [clienteId, periodo])

  useEffect(() => { carregar() }, [carregar, refresh])

  async function adicionar() {
    if (!numero || !valor) return
    setSalvando(true)
    const { error } = await supabase.from('notas_fiscais').insert({
      cliente_id: clienteId, periodo: data.substring(0, 7), data, numero,
      cliente_nf: clienteNF || 'Consumidor Final',
      valor: parseFloat(valor), cfop, recebimento,
      data_recebimento: dataRec, conciliada: false,
    })
    if (error) { setToast(`Erro ao salvar: ${error.message}`); setSalvando(false); return }
    setNumero(''); setValor(''); setClienteNF('')
    await carregar(); onRecarregar(); setToast('NF adicionada!'); setSalvando(false)
  }

  async function salvarEdicao() {
    if (!editando) return
    const { error } = await supabase.from('notas_fiscais').update({
      data: editando.data, numero: editando.numero,
      cliente_nf: editando.cliente_nf, valor: editando.valor,
      cfop: editando.cfop, recebimento: editando.recebimento,
      data_recebimento: editando.data_recebimento,
    }).eq('id', editando.id)
    if (error) { setToast(`Erro ao editar: ${error.message}`); return }
    setEditando(null); await carregar(); onRecarregar(); setToast('NF atualizada!')
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const { error } = await supabase.from('notas_fiscais').delete().eq('id', excluindo)
    if (error) { setToast(`Erro ao excluir: ${error.message}`); setExcluindo(null); return }
    setExcluindo(null); await carregar(); onRecarregar(); setToast('NF excluída!')
  }

  async function importarXML(files: File[]) {
    setImportando(true)
    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    formData.append('periodo', periodo)
    const res = await fetch(`/api/clientes/${clienteId}/importar-nfe`, { method: 'POST', body: formData })
    const result = await res.json()

    // Recarrega direto do banco — sem depender de closure
    const { data: fresco } = await supabase
      .from('notas_fiscais')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('periodo', periodo)
      .order('data', { ascending: false })
    setNotas((fresco || []) as typeof notas)
    onRecarregar()

    if (result.erro) {
      setToast(`Erro: ${result.erro}`)
    } else {
      const n = result.importados?.length || 0
      const d = result.duplicados?.length || 0
      const e = result.erros?.length || 0
      let msg = `${n} NF(s) importada(s)`
      // Avisa se alguma NF foi alocada em período diferente do atual
      const fora = (result.importados as string[] || []).filter(s => s.includes('→ alocado'))
      if (fora.length > 0) msg += ` · ${fora.length} alocada(s) no período correto`
      if (d > 0) msg += ` · ${d} duplicada(s)`
      if (e > 0) msg += ` · ${e} erro(s)`
      setToast(n > 0 ? msg : `Erro: ${result.erros?.[0]?.erro || 'Nenhuma NF importada'}`)
    }
    setImportando(false)
  }

  const [busca, setBusca] = useState('')
  const total = notas.reduce((s, n) => s + n.valor, 0)
  const visiveis = busca.trim()
    ? notas.filter(n =>
        (n.numero || '').toLowerCase().includes(busca.toLowerCase()) ||
        (n.cliente_nf || '').toLowerCase().includes(busca.toLowerCase())
      )
    : notas

  return (
    <div>
      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Registrar NF Emitida</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <Input label="Data de Emissão" type="date" value={data} onChange={e => setData(e.target.value)} />
          <Input label="Nº da NF" value={numero} onChange={e => setNumero(e.target.value)} placeholder="000001" />
          <Input label="Cliente / Consumidor" value={clienteNF} onChange={e => setClienteNF(e.target.value)} placeholder="Nome ou Consumidor Final" />
          <Input label="Valor Total (R$)" type="number" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" />
          <Select label="CFOP" value={cfop} onChange={e => setCFOP(e.target.value)}>
            <option value="5102">5102 – Venda de mercadoria</option>
            <option value="5405">5405 – Venda substituição tributária</option>
            <option value="5949">5949 – Outra saída</option>
          </Select>
          <Select label="Forma de Recebimento" value={recebimento} onChange={e => setRecebimento(e.target.value)}>
            <option>À Vista</option><option>Cartão Débito</option><option>Cartão Crédito</option>
            <option>Pix</option><option>Boleto</option>
          </Select>
          <Input label="Recebimento Previsto" type="date" value={dataRec} onChange={e => setDataRec(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Btn onClick={adicionar} disabled={salvando || !numero || !valor} style={{ width: '100%', justifyContent: 'center' }}>
              + Adicionar
            </Btn>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <UploadZone icon="🧾" label="Importar XMLs de NF-e Emitidas"
            sub={importando ? 'Importando...' : 'Exportado do SEFAZ ou ERP — XML'}
            onFiles={importarXML} accept=".xml" />
        </div>
      </Card>

      <Card>
        <CardTitle sub={`Total: ${brl(total)} · ${notas.length} notas`}>NFs Emitidas no Mês</CardTitle>
        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número da NF ou cliente..."
            className="w-full h-8 rounded-md border border-border bg-secondary text-foreground text-xs pl-8 pr-3 focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <Table headers={['Data', 'Nº NF', 'Cliente', 'CFOP', 'Valor', 'Recebimento', 'Banco', '']}>
          {visiveis.map(n => (
            <Tr key={n.id}>
              <Td>{fmtData(n.data)}</Td>
              <Td mono>{n.numero}</Td>
              <Td>{n.cliente_nf}</Td>
              <Td mono>{n.cfop}</Td>
              <Td>{brl(n.valor)}</Td>
              <Td>{n.recebimento}</Td>
              <Td><Badge variant={n.conciliada ? 'ok' : 'warn'}>{n.conciliada ? '✓ Conciliado' : 'Pendente'}</Badge></Td>
              <Td><RowActions onEdit={() => setEditando({ ...n })} onDelete={() => setExcluindo(n.id)} /></Td>
            </Tr>
          ))}
        </Table>
        {visiveis.length === 0 && (
          <p className="text-center py-8 text-muted-foreground text-sm">
            {busca ? `Nenhuma NF encontrada para "${busca}"` : 'Nenhuma NF registrada'}
          </p>
        )}
      </Card>

      {editando && (
        <Modal title="Editar Nota Fiscal" onClose={() => setEditando(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Input label="Data" type="date" value={editando.data} onChange={e => setEditando({ ...editando, data: e.target.value })} />
            <Input label="Nº da NF" value={editando.numero} onChange={e => setEditando({ ...editando, numero: e.target.value })} />
            <Input label="Cliente" value={editando.cliente_nf || ''} onChange={e => setEditando({ ...editando, cliente_nf: e.target.value })} />
            <Input label="Valor (R$)" type="number" value={String(editando.valor)} onChange={e => setEditando({ ...editando, valor: parseFloat(e.target.value) || 0 })} />
            <Select label="CFOP" value={editando.cfop || ''} onChange={e => setEditando({ ...editando, cfop: e.target.value })}>
              <option value="5102">5102 – Venda de mercadoria</option>
              <option value="5405">5405 – Venda substituição tributária</option>
              <option value="5949">5949 – Outra saída</option>
            </Select>
            <Select label="Recebimento" value={editando.recebimento || ''} onChange={e => setEditando({ ...editando, recebimento: e.target.value })}>
              <option>À Vista</option><option>Cartão Débito</option><option>Cartão Crédito</option>
              <option>Pix</option><option>Boleto</option>
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setEditando(null)}>Cancelar</Btn>
            <Btn onClick={salvarEdicao}>Salvar</Btn>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ConfirmDelete msg="Excluir esta nota fiscal?" onConfirm={confirmarExclusao} onCancel={() => setExcluindo(null)} />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}
