'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { BancoLancamento } from '@/lib/supabase/types'
import {
  Badge, Btn, Card, CardTitle, ConfirmDelete, Input, Modal,
  RowActions, Select, Table, Td, Toast, Tr, brl, fmtData,
} from '@/components/ui'
import { Button } from '@/components/ui/button'
import { Upload, Plus, Landmark } from 'lucide-react'
import ContasBancarias from '@/components/ContasBancarias'
import { checkPeriodoAberto } from '@/lib/periodo-check-client'
import UploadComprovante from '@/components/UploadComprovante'
import UploadComprovanteEmLote from '@/components/UploadComprovanteEmLote'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

const hoje = new Date().toISOString().substring(0, 10)

export default function Banco({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [lancamentos, setLancamentos] = useState<BancoLancamento[]>([])
  const [contas, setContas] = useState<string[]>([])
  const [toast, setToast] = useState('')
  const [editando, setEditando] = useState<BancoLancamento | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [importando, setImportando] = useState(false)

  // Form manual
  const [data, setData] = useState(hoje)
  const [desc, setDesc] = useState('')
  const [valor, setValor] = useState('')
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('entrada')
  const [categoria, setCategoria] = useState('Venda de Mercadoria')
  const [nfVinc, setNFVinc] = useState('')
  const [conta, setConta] = useState('')

  // Import OFX
  const [contaImport, setContaImport] = useState('')
  const [novaContaInput, setNovaContaInput] = useState('')
  const [adicionandoConta, setAdicionandoConta] = useState(false)

  const carregar = useCallback(async () => {
    const { data: rows } = await supabase
      .from('banco_lancamentos').select('*')
      .eq('cliente_id', clienteId).eq('periodo', periodo)
      .order('data', { ascending: false }).limit(50000)
    setLancamentos((rows || []) as BancoLancamento[])
  }, [clienteId, periodo])

  // Callback chamado quando ContasBancarias muda
  function onContasChange(novasContas: { nome: string; principal: boolean }[]) {
    const nomes = novasContas.map(c => c.nome)
    setContas(nomes)
    const principal = novasContas.find(c => c.principal)?.nome || nomes[0] || ''
    if (!conta) setConta(principal)
    if (!contaImport) setContaImport(principal)
  }

  useEffect(() => { carregar() }, [carregar, refresh])

  function contaSelecionadaImport(): string {
    if (adicionandoConta) return novaContaInput.trim()
    return contaImport
  }

  function adicionarContaLista(nome: string) {
    if (!nome || contas.includes(nome)) return
    setContas(prev => [...prev, nome])
    setContaImport(nome)
    setConta(nome)
    setAdicionandoConta(false)
    setNovaContaInput('')
  }

  async function adicionar() {
    if (!desc || !valor) return
    const erroP = await checkPeriodoAberto(clienteId, data)
    if (erroP) { setToast(`Erro: ${erroP}`); return }
    setSalvando(true)
    const { error } = await supabase.from('banco_lancamentos').insert({
      id: crypto.randomUUID(),
      cliente_id: clienteId, periodo: data.substring(0, 7), data, descricao: desc,
      categoria, tipo, valor: parseFloat(valor),
      nf_vinculada: nfVinc || null, conta: conta || null,
      status: nfVinc ? 'ok' : (tipo === 'entrada' ? 'pendente' : 'ok'),
    })
    if (error) { setToast(`Erro: ${error.message}`); setSalvando(false); return }
    setDesc(''); setValor(''); setNFVinc('')
    await carregar(); onRecarregar(); setToast('Lançamento adicionado!'); setSalvando(false)
  }

  async function salvarEdicao() {
    if (!editando) return
    const { error } = await supabase.from('banco_lancamentos').update({
      data: editando.data, descricao: editando.descricao,
      categoria: editando.categoria, tipo: editando.tipo,
      valor: editando.valor, nf_vinculada: editando.nf_vinculada || null,
      conta: editando.conta,
      observacao_parcial: editando.observacao_parcial || null,
    }).eq('id', editando.id)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setEditando(null); await carregar(); onRecarregar(); setToast('Lançamento atualizado!')
  }

  async function salvarObservacaoParcial(id: string, obs: string) {
    await supabase.from('banco_lancamentos')
      .update({ observacao_parcial: obs || null })
      .eq('id', id)
    await carregar()
    setToast('Observação salva!')
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const { error } = await supabase.from('banco_lancamentos').delete().eq('id', excluindo)
    if (error) { setToast(`Erro: ${error.message}`); setExcluindo(null); return }
    setExcluindo(null); await carregar(); onRecarregar(); setToast('Lançamento excluído!')
  }

  async function importarOFX(files: File[]) {
    if (!files[0]) return
    const contaFinal = contaSelecionadaImport()
    if (!contaFinal) { setToast('Erro: Selecione ou informe a conta bancária'); return }

    setImportando(true)

    // Salva nova conta na lista se for nova
    if (adicionandoConta && novaContaInput.trim()) {
      adicionarContaLista(novaContaInput.trim())
    }

    const formData = new FormData()
    formData.append('file', files[0])
    formData.append('periodo', periodo)
    formData.append('conta', contaFinal)

    try {
      const res = await fetch(`/api/clientes/${clienteId}/importar-banco`, { method: 'POST', body: formData })
      const result = await res.json()
      if (result.erro) {
        setToast(`Erro: ${result.erro}`)
      } else if (result.inseridos === 0 && result.aviso) {
        setToast(`Erro: ${result.aviso}`)
      } else if (result.inseridos === 0) {
        setToast('Erro: Nenhum lançamento importado — verifique o arquivo')
      } else {
        // Monta mensagem com breakdown por período
        let msg = `${result.inseridos} lançamento(s) importado(s) → ${contaFinal}`
        if (result.por_periodo) {
          const periodos = Object.entries(result.por_periodo as Record<string, number>)
          if (periodos.length > 1) {
            msg += ` (${periodos.map(([p, n]) => `${p}: ${n}`).join(' · ')})`
          }
        }
        if (result.duplicados_ignorados > 0) msg += ` · ${result.duplicados_ignorados} duplicado(s) ignorado(s)`
        if (result.despesas_criadas > 0) msg += ` · ${result.despesas_criadas} despesa(s) criada(s) automaticamente`
        setToast(msg)
        await carregar(); onRecarregar()
      }
    } catch { setToast('Erro: não foi possível processar o arquivo') }
    setImportando(false)
  }

  // ── Filtro e consolidado ──────────────────────────────────────────────────
  const [contaFiltro, setContaFiltro] = useState<string | null>(null)

  const contasPeriodo = [...new Set(lancamentos.map(l => l.conta).filter(Boolean))] as string[]

  const visiveis = contaFiltro
    ? lancamentos.filter(l => l.conta === contaFiltro)
    : lancamentos

  // Consolidado por banco
  const consolidado = contasPeriodo.map(conta => {
    const items = lancamentos.filter(l => l.conta === conta)
    return {
      conta,
      entradas: items.filter(l => l.tipo === 'entrada').reduce((s, l) => s + l.valor, 0),
      saidas:   items.filter(l => l.tipo === 'saida').reduce((s, l) => s + l.valor, 0),
      total:    items.length,
    }
  })

  const entradas = visiveis.filter(b => b.tipo === 'entrada').reduce((s, b) => s + b.valor, 0)
  const saidas   = visiveis.filter(b => b.tipo === 'saida').reduce((s, b) => s + b.valor, 0)
  const saldo    = entradas - saidas

  return (
    <div>
      <Card className="mb-4">
        <CardTitle>Lançamento Bancário Manual</CardTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input label="Data" type="date" value={data} onChange={e => setData(e.target.value)} />
          <Input label="Descrição / Histórico" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Pix recebido..." />
          <Input label="Valor (R$)" type="number" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" />
          <Select label="Tipo" value={tipo} onChange={e => setTipo(e.target.value as 'entrada' | 'saida')}>
            <option value="entrada">Entrada (Crédito)</option>
            <option value="saida">Saída (Débito)</option>
          </Select>
          <Select label="Categoria" value={categoria} onChange={e => setCategoria(e.target.value)}>
            <option>Venda de Mercadoria</option>
            <option>Recebimento de Duplicata</option>
            <option>Empréstimo/Aporte</option>
            <option>Pagamento Fornecedor</option>
            <option>Despesa Operacional</option>
            <option>Imposto/Tributo</option>
            <option>Pró-Labore/Salário</option>
            <option>Outro</option>
          </Select>
          <Input label="NF Vinculada (opcional)" value={nfVinc} onChange={e => setNFVinc(e.target.value)} placeholder="Nº da NF" />
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Conta Bancária
            </label>
            {contas.length > 0 ? (
              <select value={conta} onChange={e => setConta(e.target.value)}
                className="h-9 rounded-md border border-border bg-secondary text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer">
                <option value="">— Selecione —</option>
                {contas.map(c => <option key={c}>{c}</option>)}
              </select>
            ) : (
              <Input label="" value={conta} onChange={e => setConta(e.target.value)} placeholder="Ex: Itaú CC 12345-6" />
            )}
          </div>
          <div className="flex items-end">
            <Btn onClick={adicionar} disabled={salvando || !desc || !valor} className="w-full justify-center">
              + Adicionar
            </Btn>
          </div>
        </div>
      </Card>

      {/* Gestão de contas bancárias */}
      <ContasBancarias clienteId={clienteId} onContasChange={onContasChange} lancamentos={lancamentos} />

      {/* Import OFX — com seleção de conta em destaque */}
      <Card className="mb-4">
        <CardTitle>
          <span className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            Importar Extrato Bancário (OFX / CSV)
          </span>
        </CardTitle>

        {/* Seleção de conta — obrigatório antes do upload */}
        <div className="mb-4 p-3 rounded-lg bg-secondary border border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            1. Selecione a conta bancária do extrato
          </p>

          {!adicionandoConta ? (
            <div className="flex gap-2 items-center">
              <select
                value={contaImport}
                onChange={e => setContaImport(e.target.value)}
                className="flex-1 h-9 rounded-md border border-border bg-card text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
              >
                {contas.length === 0 && <option value="">Nenhuma conta cadastrada</option>}
                {contas.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs shrink-0"
                onClick={() => setAdicionandoConta(true)}>
                <Plus className="h-3.5 w-3.5" /> Nova conta
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <input
                autoFocus
                value={novaContaInput}
                onChange={e => setNovaContaInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && adicionarContaLista(novaContaInput)}
                placeholder="Ex: Itaú CC 12345-6, Bradesco CC 98765-4..."
                className="flex-1 h-9 rounded-md border border-primary bg-card text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button size="sm" className="text-xs shrink-0"
                onClick={() => adicionarContaLista(novaContaInput)}
                disabled={!novaContaInput.trim()}>
                Salvar
              </Button>
              <Button variant="outline" size="sm" className="text-xs shrink-0"
                onClick={() => { setAdicionandoConta(false); setNovaContaInput('') }}>
                Cancelar
              </Button>
            </div>
          )}

          {contaSelecionadaImport() && (
            <p className="text-xs text-primary mt-2 font-medium">
              ✓ Importação vinculada a: <strong>{contaSelecionadaImport()}</strong>
            </p>
          )}
        </div>

        {/* Drop zone */}
        <div className="mb-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            2. Faça upload do arquivo
          </p>
          <label
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-7 cursor-pointer transition-colors
              ${contaSelecionadaImport()
                ? 'border-border hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary'
                : 'border-border/40 text-muted-foreground/40 cursor-not-allowed'}`}
          >
            <Upload className="h-6 w-6" />
            <span className="text-sm font-semibold">
              {importando ? 'Importando...' : 'Arraste ou clique — OFX, CSV'}
            </span>
            <span className="text-xs">Exportado do internet banking</span>
            <input
              type="file" className="hidden" accept=".ofx,.csv"
              disabled={!contaSelecionadaImport() || importando}
              onChange={e => e.target.files && importarOFX(Array.from(e.target.files))}
            />
          </label>
          {!contaSelecionadaImport() && (
            <p className="text-xs text-orange-400 mt-2 text-center">
              ⚠ Selecione ou cadastre uma conta bancária antes de importar
            </p>
          )}
        </div>
      </Card>

      {/* Upload em lote de comprovantes */}
      <div className="mb-4">
        <UploadComprovanteEmLote
          clienteId={clienteId}
          lancamentos={lancamentos}
          onConcluido={carregar}
        />
      </div>

      {/* Filtro + resumo por banco — dropdown */}
      {lancamentos.length > 0 && (
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          {/* Dropdown de banco */}
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground shrink-0" />
            <select
              value={contaFiltro || ''}
              onChange={e => setContaFiltro(e.target.value || null)}
              className="h-9 rounded-lg border border-border bg-secondary text-foreground text-sm px-3 pr-8 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer min-w-[180px]"
            >
              <option value="">Todas as contas ({lancamentos.length})</option>
              {consolidado.map(c => (
                <option key={c.conta} value={c.conta || ''}>
                  {c.conta || 'Sem conta'} ({c.total})
                </option>
              ))}
            </select>
          </div>

          {/* Resumo da conta selecionada */}
          {(() => {
            const dados = contaFiltro
              ? consolidado.find(c => c.conta === contaFiltro)
              : { entradas: lancamentos.filter(l=>l.tipo==='entrada').reduce((s,l)=>s+l.valor,0), saidas: lancamentos.filter(l=>l.tipo==='saida').reduce((s,l)=>s+l.valor,0) }
            if (!dados) return null
            const saldoC = dados.entradas - dados.saidas
            return (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-green-500 font-semibold">↑ {brl(dados.entradas)}</span>
                <span className="text-red-400 font-semibold">↓ {brl(dados.saidas)}</span>
                <span className={`font-bold ${saldoC >= 0 ? 'text-green-500' : 'text-red-400'}`}>= {brl(saldoC)}</span>
              </div>
            )
          })()}

          {contaFiltro && (
            <button onClick={() => setContaFiltro(null)} className="text-xs text-primary hover:underline">
              × limpar
            </button>
          )}

        </div>
      )}

      {/* Tabela */}
      <Card>
        <CardTitle sub={
          <span className="flex items-center gap-3">
            <span className="text-green-500">↑ {brl(entradas)}</span>
            <span className="text-red-400">↓ {brl(saidas)}</span>
            <span className={`font-bold ${saldo >= 0 ? 'text-green-500' : 'text-red-400'}`}>= {brl(saldo)}</span>
            {contaFiltro && (
              <button onClick={() => setContaFiltro(null)} className="text-xs text-primary hover:underline ml-1">
                × limpar filtro
              </button>
            )}
          </span>
        }>
          {contaFiltro ? `Movimentações — ${contaFiltro}` : 'Movimentações Bancárias'}
        </CardTitle>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap w-[100px]">Data</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Descrição</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap w-[120px]">Categoria</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap w-[80px]">Tipo</th>
                <th className="text-right py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap w-[110px]">Valor</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap w-[100px]">Conta</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap w-[110px]">Status</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap w-[90px]">Comprovante</th>
                <th className="w-[60px]" />
              </tr>
            </thead>
            <tbody>
          {visiveis.map(b => (
            <React.Fragment key={b.id}>
            <tr className="border-b border-border hover:bg-secondary/50 transition-colors">
              {/* Data */}
              <td className="py-2.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{fmtData(b.data)}</td>

              {/* Descrição — truncada com tooltip nativo */}
              <td className="py-2.5 px-3 max-w-[280px]">
                <span className="block truncate text-sm text-foreground" title={b.descricao}>
                  {b.descricao}
                </span>
                {b.categoria && (
                  <span className="text-[11px] text-muted-foreground">{b.categoria}</span>
                )}
              </td>

              {/* Categoria — oculta (já no sub do descricao) */}
              <td className="hidden" />

              {/* Tipo */}
              <td className="py-2.5 px-3 whitespace-nowrap">
                <span className={`inline-flex items-center gap-1 text-xs font-bold ${b.tipo === 'entrada' ? 'text-green-500' : 'text-red-400'}`}>
                  {b.tipo === 'entrada' ? '↑' : '↓'}
                  {b.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                </span>
              </td>

              {/* Valor */}
              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                <span className={`font-semibold text-sm ${b.tipo === 'entrada' ? 'text-green-500' : 'text-red-400'}`}>
                  {brl(b.valor)}
                </span>
              </td>

              {/* Conta */}
              <td className="py-2.5 px-3 whitespace-nowrap">
                {b.conta
                  ? <span className="text-xs bg-secondary border border-border px-2 py-0.5 rounded-full text-muted-foreground truncate max-w-[90px] inline-block" title={b.conta}>{b.conta}</span>
                  : <span className="text-muted-foreground text-xs">—</span>}
              </td>

              {/* Status */}
              <td className="py-2.5 px-3 whitespace-nowrap">
                <StatusBancario status={b.status} />
              </td>

              {/* Comprovante */}
              <td className="py-2.5 px-3">
                <UploadComprovante
                  tabela="banco_lancamentos"
                  registroId={b.id}
                  clienteId={clienteId}
                  urlAtual={(b as any).comprovante_url}
                  onAtualizado={url => setLancamentos(prev => prev.map(x => x.id === b.id ? { ...x, comprovante_url: url } as any : x))}
                />
              </td>

              {/* Ações */}
              <td className="py-2.5 px-3">
                <RowActions onEdit={() => setEditando({ ...b })} onDelete={() => setExcluindo(b.id)} />
              </td>
            </tr>
            {/* Linha de observação para parcialmente conciliados */}
            {b.status === 'parcial' && (
              <tr className="border-b border-border">
                <td colSpan={9} className="px-3 pb-2 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-orange-400 font-semibold whitespace-nowrap">Motivo da diferença:</span>
                    <input
                      defaultValue={b.observacao_parcial || ''}
                      onBlur={e => salvarObservacaoParcial(b.id, e.target.value)}
                      placeholder="Ex: adiantamento, desconto, taxa bancária..."
                      className="flex-1 h-6 rounded border border-orange-500/30 bg-orange-500/5 text-foreground text-xs px-2 focus:outline-none focus:border-orange-400"
                    />
                  </div>
                </td>
              </tr>
            )}
            </React.Fragment>
          ))}
            </tbody>
          </table>
        </div>
        {visiveis.length === 0 && (
          <p className="text-center py-8 text-muted-foreground text-sm">
            {contaFiltro ? `Nenhum lançamento para "${contaFiltro}"` : 'Nenhum lançamento registrado'}
          </p>
        )}
      </Card>

      {editando && (
        <Modal title="Editar Lançamento Bancário" onClose={() => setEditando(null)}>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <Input label="Data" type="date" value={editando.data} onChange={e => setEditando({ ...editando, data: e.target.value })} />
            <Input label="Descrição" value={editando.descricao} onChange={e => setEditando({ ...editando, descricao: e.target.value })} />
            <Input label="Valor (R$)" type="number" value={String(editando.valor)} onChange={e => setEditando({ ...editando, valor: parseFloat(e.target.value) || 0 })} />
            <Select label="Tipo" value={editando.tipo} onChange={e => setEditando({ ...editando, tipo: e.target.value as 'entrada' | 'saida' })}>
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
            </Select>
            <Select label="Categoria" value={editando.categoria || ''} onChange={e => setEditando({ ...editando, categoria: e.target.value })}>
              <option>Venda de Mercadoria</option><option>Recebimento de Duplicata</option>
              <option>Empréstimo/Aporte</option><option>Pagamento Fornecedor</option>
              <option>Despesa Operacional</option><option>Imposto/Tributo</option>
              <option>Pró-Labore/Salário</option><option>Outro</option>
            </Select>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Conta Bancária</label>
              <select value={editando.conta || ''} onChange={e => setEditando({ ...editando, conta: e.target.value || null })}
                className="h-9 rounded-md border border-border bg-secondary text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer">
                <option value="">— Nenhuma —</option>
                {contas.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <Input label="NF Vinculada" value={editando.nf_vinculada || ''} onChange={e => setEditando({ ...editando, nf_vinculada: e.target.value || null })} placeholder="Nº da NF" />
            </div>
            {editando.status === 'parcial' && (
              <div className="col-span-2">
                <label className="text-[11px] font-bold uppercase tracking-wide text-orange-400 block mb-1">Motivo da diferença (parcial)</label>
                <input
                  value={editando.observacao_parcial || ''}
                  onChange={e => setEditando({ ...editando, observacao_parcial: e.target.value || null })}
                  placeholder="Ex: adiantamento, desconto, taxa bancária..."
                  className="w-full h-9 rounded-lg border border-orange-500/30 bg-orange-500/5 text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Btn variant="ghost" onClick={() => setEditando(null)}>Cancelar</Btn>
            <Btn onClick={salvarEdicao}>Salvar</Btn>
          </div>
        </Modal>
      )}

      {excluindo && <ConfirmDelete onConfirm={confirmarExclusao} onCancel={() => setExcluindo(null)} />}
      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}

// ── Subcomponente: status legível dos lançamentos ───────────────────────────
function StatusBancario({ status }: { status: string | undefined }) {
  const cfg = {
    ok:       { label: 'Conciliado',   dot: 'bg-green-500',  text: 'text-green-400',  bg: 'bg-green-500/10  border-green-500/20'  },
    parcial:  { label: 'Parcialmente', dot: 'bg-orange-400', text: 'text-orange-300', bg: 'bg-orange-500/10 border-orange-500/20' },
    sem_nf:   { label: 'Sem NF',       dot: 'bg-red-500',    text: 'text-red-400',    bg: 'bg-red-500/10    border-red-500/20'    },
    pendente: { label: 'A conciliar',  dot: 'bg-slate-400',  text: 'text-slate-400',  bg: 'bg-slate-500/10  border-slate-500/20'  },
  }
  const c = cfg[status as keyof typeof cfg] ?? cfg.pendente
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}

// ── Subcomponente: card de banco clicável ────────────────────────────────────
function BancoCard({
  label, entradas, saidas, total, ativo, onClick,
}: {
  label: string | null; entradas: number; saidas: number
  total: number; ativo: boolean; onClick: () => void
}) {
  const saldo = entradas - saidas
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl border p-4 text-left transition-all min-w-[180px] flex-1',
        ativo
          ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-sm'
          : 'border-border bg-card hover:bg-secondary hover:border-primary/40',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5 mb-2.5">
        <Landmark className={`h-3.5 w-3.5 shrink-0 ${ativo ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className={`text-xs font-bold uppercase tracking-wide truncate max-w-[140px] ${ativo ? 'text-primary' : 'text-muted-foreground'}`}>
          {label || 'Sem conta'}
        </span>
      </div>
      <div className="flex gap-3 text-xs mb-1.5">
        <span className="text-green-500 font-semibold">↑ {brl(entradas)}</span>
        <span className="text-red-400 font-semibold">↓ {brl(saidas)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{total} lançamentos</span>
        <span className={`text-xs font-bold ${saldo >= 0 ? 'text-green-500' : 'text-red-400'}`}>
          = {brl(saldo)}
        </span>
      </div>
    </button>
  )
}
