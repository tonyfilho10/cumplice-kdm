'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Compra } from '@/lib/supabase/types'
import {
  Badge, Btn, Card, CardTitle, ConfirmDelete, Input, Modal,
  RowActions, Select, Table, Td, Toast, Tr, UploadZone, brl, fmtData,
} from '@/components/ui'
import { parseMultiplosXML } from '@/lib/parsers/nfe'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

const hoje = new Date().toISOString().substring(0, 10)

export default function Compras({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [compras, setCompras] = useState<Compra[]>([])
  const [toast, setToast] = useState('')
  const [editando, setEditando] = useState<Compra | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)

  // Form add
  const [data, setData] = useState(hoje)
  const [fornecedor, setFornecedor] = useState('')
  const [valor, setValor] = useState('')
  const [nf, setNF] = useState('')
  const [categoria, setCategoria] = useState('Mercadoria para Revenda')
  const [pagamento, setPagamento] = useState('À Vista (Banco)')
  const [cnpjFornecedor, setCNPJ] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [importando, setImportando] = useState(false)

  const carregar = useCallback(async () => {
    const { data: rows } = await supabase.from('compras').select('*')
      .eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false).order('data', { ascending: false })
    // status é coluna gerada que não existe após prisma db push — deriva do nf_entrada
    const comStatus = (rows || []).map(r => ({
      ...r,
      status: (r.nf_entrada ? 'ok' : 'sem_nf') as 'ok' | 'sem_nf',
    }))
    setCompras(comStatus as Compra[])
  }, [clienteId, periodo])

  useEffect(() => { carregar() }, [carregar, refresh])

  async function adicionar() {
    if (!fornecedor || !valor) return
    setSalvando(true)
    const { error } = await supabase.from('compras').insert({
      cliente_id: clienteId, periodo: data.substring(0, 7), data,
      fornecedor, valor: parseFloat(valor), nf_entrada: nf || null,
      categoria, pagamento, cnpj_fornecedor: cnpjFornecedor || null,
    })
    if (error) { setToast(`Erro ao salvar: ${error.message}`); setSalvando(false); return }
    setFornecedor(''); setValor(''); setNF(''); setCNPJ('')
    await carregar(); onRecarregar(); setToast('Compra adicionada!'); setSalvando(false)
  }

  async function salvarEdicao() {
    if (!editando) return
    const { error } = await supabase.from('compras').update({
      data: editando.data, fornecedor: editando.fornecedor,
      valor: editando.valor, nf_entrada: editando.nf_entrada || null,
      categoria: editando.categoria, pagamento: editando.pagamento,
      cnpj_fornecedor: editando.cnpj_fornecedor || null,
    }).eq('id', editando.id)
    if (error) { setToast(`Erro ao editar: ${error.message}`); return }
    setEditando(null); await carregar(); onRecarregar(); setToast('Compra atualizada!')
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const { error } = await supabase.from('compras').delete().eq('id', excluindo)
    if (error) { setToast(`Erro ao excluir: ${error.message}`); setExcluindo(null); return }
    setExcluindo(null); await carregar(); onRecarregar(); setToast('Compra excluída!')
  }

  async function importarXML(files: File[]) {
    setImportando(true)
    const { sucesso, erros } = await parseMultiplosXML(files)

    let inseridos = 0
    const errosInsert: string[] = []
    const avisos: string[] = []

    for (const nfe of sucesso) {
      // NFS-e são notas de serviço — pertencem a Despesas, não Compras
      if (nfe.formato === 'nfse') {
        avisos.push(`NFS-e ${nfe.numero || 'sem número'} é nota de serviço — registre em Despesas`)
        continue
      }
      // Qualquer NF-e importada aqui é tratada como compra
      // (o usuário decide o que importar — não inferimos pelo CFOP ou tpNF)
      if (!nfe.data_emissao) {
        errosInsert.push(`NF ${nfe.numero}: data de emissão inválida`)
        continue
      }

      const { error } = await supabase.from('compras').insert({
        cliente_id: clienteId,
        periodo: nfe.data_emissao.substring(0, 7), // período real da NF
        data: nfe.data_emissao,
        fornecedor: nfe.razao_emitente || 'Fornecedor XML',
        cnpj_fornecedor: nfe.cnpj_emitente || null,
        valor: nfe.valor_total,
        nf_entrada: nfe.numero,
        categoria: 'Mercadoria para Revenda',
        pagamento: 'Importado XML',
      })

      if (error) {
        errosInsert.push(`NF ${nfe.numero}: ${error.message}`)
      } else {
        inseridos++
      }
    }

    // Recarrega diretamente do banco — sem depender de closure
    const { data: fresco } = await supabase
      .from('compras')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('periodo', periodo)
      .order('data', { ascending: false })

    setCompras((fresco || []) as typeof compras)
    onRecarregar()

    // Feedback detalhado
    if (inseridos > 0) {
      setToast(`${inseridos} compra(s) importada(s)!`)
    }
    const todoErros = [...erros.map(e => e.erro), ...errosInsert]
    if (todoErros.length > 0) setToast(`Erro: ${todoErros[0]}`)
    if (inseridos === 0 && todoErros.length === 0 && avisos.length > 0) {
      setToast(`Erro: ${avisos[0]}`)
    }

    setImportando(false)
  }

  const [busca, setBusca] = useState('')

  const total = compras.reduce((s, c) => s + c.valor, 0)
  const semNF = compras.filter(c => c.status === 'sem_nf').length
  const visiveis = busca.trim()
    ? compras.filter(c =>
        c.fornecedor.toLowerCase().includes(busca.toLowerCase()) ||
        (c.nf_entrada || '').toLowerCase().includes(busca.toLowerCase())
      )
    : compras

  return (
    <div>
      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Registrar Compra de Mercadoria</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <Input label="Data" type="date" value={data} onChange={e => setData(e.target.value)} />
          <Input label="Fornecedor" value={fornecedor} onChange={e => setFornecedor(e.target.value)} placeholder="Nome do fornecedor" />
          <Input label="Valor (R$)" type="number" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" />
          <Input label="Nº NF Entrada" value={nf} onChange={e => setNF(e.target.value)} placeholder="001234 (vazio = sem NF)" />
          <Select label="Categoria" value={categoria} onChange={e => setCategoria(e.target.value)}>
            <option>Mercadoria para Revenda</option><option>Matéria-Prima</option>
            <option>Embalagens</option><option>Higiene/Limpeza</option><option>Outro</option>
          </Select>
          <Select label="Forma de Pagamento" value={pagamento} onChange={e => setPagamento(e.target.value)}>
            <option>À Vista (Banco)</option><option>Boleto 30d</option>
            <option>Boleto 60d</option><option>Cartão Empresarial</option>
          </Select>
          <Input label="CNPJ Fornecedor" value={cnpjFornecedor} onChange={e => setCNPJ(e.target.value)} placeholder="00.000.000/0001-00" />
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Btn onClick={adicionar} disabled={salvando || !fornecedor || !valor} style={{ width: '100%', justifyContent: 'center' }}>
              + Adicionar
            </Btn>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <UploadZone icon="📂" label="Importar XMLs de NF-e de Entrada"
            sub={importando ? 'Importando...' : 'Arraste ou clique — XML'}
            onFiles={importarXML} accept=".xml" />
        </div>
      </Card>

      <Card>
        <CardTitle sub={`Total: ${brl(total)} · ${compras.length} lançamentos${semNF > 0 ? ` · ${semNF} sem NF ⚠` : ''}`}>
          Compras do Mês
        </CardTitle>
        {/* Barra de busca */}
        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por fornecedor ou número da NF..."
            className="w-full h-8 rounded-md border border-border bg-secondary text-foreground text-xs pl-8 pr-3 focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <Table headers={['Data', 'Fornecedor', 'Categoria', 'Valor', 'NF Entrada', 'Pagamento', 'Status', '']}>
          {visiveis.map(c => (
            <Tr key={c.id}>
              <Td>{fmtData(c.data)}</Td>
              <Td>{c.fornecedor}</Td>
              <Td>{c.categoria}</Td>
              <Td>{brl(c.valor)}</Td>
              <Td mono>{c.nf_entrada || <span style={{ color: 'var(--red)' }}>Sem NF ⚠</span>}</Td>
              <Td>{c.pagamento}</Td>
              <Td><Badge variant={c.status === 'ok' ? 'ok' : 'err'}>{c.status === 'ok' ? '✓ OK' : '⚠ Sem NF'}</Badge></Td>
              <Td><RowActions onEdit={() => setEditando({ ...c })} onDelete={() => setExcluindo(c.id)} /></Td>
            </Tr>
          ))}
        </Table>
        {visiveis.length === 0 && (
          <p className="text-center py-8 text-muted-foreground text-sm">
            {busca ? `Nenhuma compra encontrada para "${busca}"` : 'Nenhuma compra registrada'}
          </p>
        )}
      </Card>

      {/* Modal de Edição */}
      {editando && (
        <Modal title="Editar Compra" onClose={() => setEditando(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Input label="Data" type="date" value={editando.data} onChange={e => setEditando({ ...editando, data: e.target.value })} />
            <Input label="Fornecedor" value={editando.fornecedor} onChange={e => setEditando({ ...editando, fornecedor: e.target.value })} />
            <Input label="Valor (R$)" type="number" value={String(editando.valor)} onChange={e => setEditando({ ...editando, valor: parseFloat(e.target.value) || 0 })} />
            <Input label="Nº NF Entrada" value={editando.nf_entrada || ''} onChange={e => setEditando({ ...editando, nf_entrada: e.target.value || null })} placeholder="Vazio = sem NF" />
            <Select label="Categoria" value={editando.categoria || ''} onChange={e => setEditando({ ...editando, categoria: e.target.value })}>
              <option>Mercadoria para Revenda</option><option>Matéria-Prima</option>
              <option>Embalagens</option><option>Higiene/Limpeza</option><option>Outro</option>
            </Select>
            <Select label="Pagamento" value={editando.pagamento || ''} onChange={e => setEditando({ ...editando, pagamento: e.target.value })}>
              <option>À Vista (Banco)</option><option>Boleto 30d</option>
              <option>Boleto 60d</option><option>Cartão Empresarial</option>
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setEditando(null)}>Cancelar</Btn>
            <Btn onClick={salvarEdicao}>Salvar</Btn>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ConfirmDelete
          msg="Excluir esta compra? Esta ação não pode ser desfeita."
          onConfirm={confirmarExclusao}
          onCancel={() => setExcluindo(null)}
        />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}
