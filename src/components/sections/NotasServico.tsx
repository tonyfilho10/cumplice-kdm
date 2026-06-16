'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { checkPeriodoAberto } from '@/lib/periodo-check-client'
import {
  Badge, Btn, Card, CardTitle, ConfirmDelete, Input, Modal,
  RowActions, Table, Td, Toast, Tr, brl, fmtData,
} from '@/components/ui'
import { Upload, Loader2, X, CheckCircle2 } from 'lucide-react'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

type NotaServico = {
  id: string
  cliente_id: string
  periodo: string
  numero: string
  data: string
  prestador: string
  cnpj_prestador: string | null
  discriminacao: string | null
  codigo_servico: string | null
  valor: number
  status: 'pendente' | 'conciliada'
  banco_lancamento_id: string | null
  created_at: string
}

type BancoMatch = {
  id: string
  data: string
  descricao: string
  valor: number
}

type Rascunho = {
  _key: string
  numero: string
  data: string
  prestador: string
  cnpj_prestador: string
  discriminacao: string
  codigo_servico: string
  valor: string
  arquivo: string // nome do arquivo
  processando: boolean
  erro: boolean
}

const hoje = new Date().toISOString().substring(0, 10)

export default function NotasServico({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [notas, setNotas] = useState<NotaServico[]>([])
  const [toast, setToast] = useState('')
  const [editando, setEditando] = useState<NotaServico | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [rascunhos, setRascunhos] = useState<Rascunho[]>([])

  // Form manual
  const [numero, setNumero] = useState('')
  const [data, setData] = useState(hoje)
  const [prestador, setPrestador] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [discriminacao, setDiscriminacao] = useState('')
  const [codigoServico, setCodigoServico] = useState('')
  const [valor, setValor] = useState('')

  const [matches, setMatches] = useState<{ notaId: string; lancamentos: BancoMatch[] } | null>(null)

  async function processarPdf(arquivo: File): Promise<Partial<Rascunho>> {
    const form = new FormData()
    form.append('arquivo', arquivo)
    const res = await fetch(`/api/clientes/${clienteId}/importar-nfse`, { method: 'POST', body: form })
    if (!res.ok) throw new Error('falha')
    return await res.json()
  }

  async function importarPdfs(arquivos: File[]) {
    const novos: Rascunho[] = arquivos.map(f => ({
      _key: crypto.randomUUID(),
      numero: '', data: hoje, prestador: '', cnpj_prestador: '',
      discriminacao: '', codigo_servico: '', valor: '',
      arquivo: f.name, processando: true, erro: false,
    }))
    setRascunhos(prev => [...prev, ...novos])

    for (let i = 0; i < arquivos.length; i++) {
      const key = novos[i]._key
      try {
        const dados = await processarPdf(arquivos[i])
        setRascunhos(prev => prev.map(r => r._key !== key ? r : {
          ...r,
          numero:        dados.numero        ?? '',
          data:          dados.data          ?? hoje,
          prestador:     dados.prestador     ?? '',
          cnpj_prestador: (dados as any).cnpj_prestador ?? '',
          discriminacao: (dados as any).discriminacao   ?? '',
          codigo_servico: (dados as any).codigo_servico ?? '',
          valor:         dados.valor != null ? String(dados.valor) : '',
          processando: false,
        }))
      } catch {
        setRascunhos(prev => prev.map(r => r._key !== key ? r : { ...r, processando: false, erro: true }))
      }
    }
  }

  function atualizarRascunho(key: string, campo: Partial<Rascunho>) {
    setRascunhos(prev => prev.map(r => r._key === key ? { ...r, ...campo } : r))
  }

  function removerRascunho(key: string) {
    setRascunhos(prev => prev.filter(r => r._key !== key))
  }

  async function salvarTodos() {
    const prontos = rascunhos.filter(r => !r.processando && r.prestador && r.valor && r.numero)
    if (!prontos.length) return
    const erroP = await checkPeriodoAberto(clienteId, periodo)
    if (erroP) { setToast(`Erro: ${erroP}`); return }
    setSalvando(true)
    await supabase.from('notas_servico').insert(
      prontos.map(r => ({
        id: crypto.randomUUID(),
        cliente_id: clienteId,
        periodo,
        numero: r.numero,
        data: r.data,
        prestador: r.prestador,
        cnpj_prestador: r.cnpj_prestador || null,
        discriminacao: r.discriminacao || null,
        codigo_servico: r.codigo_servico || null,
        valor: parseFloat(r.valor.replace(',', '.')),
        status: 'pendente',
      }))
    )
    setRascunhos(prev => prev.filter(r => !prontos.find(p => p._key === r._key)))
    setSalvando(false)
    setToast(`${prontos.length} nota${prontos.length !== 1 ? 's' : ''} salva${prontos.length !== 1 ? 's' : ''}!`)
    onRecarregar()
    await carregar()
  }

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from('notas_servico')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('periodo', periodo)
      .order('data', { ascending: false })
    if (data) setNotas(data as NotaServico[])
  }, [clienteId, periodo])

  useEffect(() => { carregar() }, [carregar, refresh])

  function limparForm() {
    setNumero(''); setData(hoje); setPrestador(''); setCnpj('')
    setDiscriminacao(''); setCodigoServico(''); setValor('')
  }

  function preencherForm(n: NotaServico) {
    setNumero(n.numero); setData(n.data.substring(0, 10))
    setPrestador(n.prestador); setCnpj(n.cnpj_prestador ?? '')
    setDiscriminacao(n.discriminacao ?? ''); setCodigoServico(n.codigo_servico ?? '')
    setValor(String(n.valor))
  }

  async function adicionar() {
    if (!prestador || !valor || !numero) return
    const erroP = await checkPeriodoAberto(clienteId, periodo)
    if (erroP) { setToast(`Erro: ${erroP}`); return }
    setSalvando(true)
    await supabase.from('notas_servico').insert({
      id: crypto.randomUUID(), cliente_id: clienteId, periodo,
      numero, data, prestador,
      cnpj_prestador: cnpj || null, discriminacao: discriminacao || null,
      codigo_servico: codigoServico || null,
      valor: parseFloat(valor.replace(',', '.')), status: 'pendente',
    })
    limparForm(); setSalvando(false)
    setToast('Nota de serviço adicionada!'); onRecarregar(); await carregar()
  }

  async function salvarEdicao() {
    if (!editando || !prestador || !valor || !numero) return
    setSalvando(true)
    await supabase.from('notas_servico').update({
      numero, data, prestador,
      cnpj_prestador: cnpj || null, discriminacao: discriminacao || null,
      codigo_servico: codigoServico || null,
      valor: parseFloat(valor.replace(',', '.')),
    }).eq('id', editando.id)
    setEditando(null); limparForm(); setSalvando(false)
    setToast('Nota atualizada!'); await carregar()
  }

  async function excluir(id: string) {
    await supabase.from('notas_servico').delete().eq('id', id)
    setExcluindo(null); setToast('Nota removida.'); await carregar()
  }

  async function buscarMatches(nota: NotaServico) {
    const v = Number(nota.valor)
    const { data } = await supabase
      .from('banco_lancamentos').select('id, data, descricao, valor')
      .eq('cliente_id', clienteId).eq('periodo', periodo)
      .eq('tipo', 'saida').eq('valor', v).order('data', { ascending: false })
    setMatches({ notaId: nota.id, lancamentos: (data ?? []) as BancoMatch[] })
  }

  async function vincular(notaId: string, lancamentoId: string) {
    await supabase.from('notas_servico').update({ banco_lancamento_id: lancamentoId, status: 'conciliada' }).eq('id', notaId)
    setMatches(null); setToast('Nota vinculada ao lançamento bancário!'); await carregar()
  }

  async function desvincular(nota: NotaServico) {
    await supabase.from('notas_servico').update({ banco_lancamento_id: null, status: 'pendente' }).eq('id', nota.id)
    setToast('Vínculo removido.'); await carregar()
  }

  const total = notas.reduce((s, n) => s + Number(n.valor), 0)
  const pendentes = notas.filter(n => n.status === 'pendente').length
  const processando = rascunhos.filter(r => r.processando).length
  const prontos = rascunhos.filter(r => !r.processando && !r.erro && r.prestador && r.valor && r.numero).length

  return (
    <div className="space-y-5">
      {toast && <Toast msg={toast} onHide={() => setToast('')} />}

      {/* Upload + rascunhos */}
      <Card>
        <CardTitle>Importar NFS-e</CardTitle>

        <label className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 mb-4 cursor-pointer transition-colors ${processando > 0 ? 'border-primary bg-primary/5 pointer-events-none' : 'border-border hover:border-primary hover:bg-primary/5'}`}>
          <input type="file" accept="application/pdf" multiple className="hidden"
            onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) importarPdfs(fs); e.target.value = '' }} />
          {processando > 0 ? (
            <>
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
              <span className="text-sm text-primary font-medium">Lendo {processando} nota{processando !== 1 ? 's' : ''}...</span>
            </>
          ) : (
            <>
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-semibold text-muted-foreground">Selecionar PDFs de NFS-e</span>
              <span className="text-xs text-muted-foreground">Múltiplos arquivos permitidos — campos preenchidos automaticamente</span>
            </>
          )}
        </label>

        {/* Fila de rascunhos */}
        {rascunhos.length > 0 && (
          <div className="space-y-3 mb-4">
            {rascunhos.map(r => (
              <div key={r._key} className={`rounded-lg border p-4 ${r.erro ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-secondary/30'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {r.processando
                      ? <Loader2 className="h-4 w-4 text-primary animate-spin" />
                      : r.erro
                        ? <span className="text-xs text-destructive font-medium">Erro ao ler</span>
                        : <CheckCircle2 className="h-4 w-4 text-green-500" />
                    }
                    <span className="text-xs text-muted-foreground truncate max-w-[300px]">{r.arquivo}</span>
                  </div>
                  <button onClick={() => removerRascunho(r._key)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {!r.processando && !r.erro && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Nº NFS-e" value={r.numero} onChange={e => atualizarRascunho(r._key, { numero: e.target.value })} />
                    <Input label="Data" type="date" value={r.data} onChange={e => atualizarRascunho(r._key, { data: e.target.value })} />
                    <Input label="Prestador" value={r.prestador} onChange={e => atualizarRascunho(r._key, { prestador: e.target.value })} />
                    <Input label="CNPJ" value={r.cnpj_prestador} onChange={e => atualizarRascunho(r._key, { cnpj_prestador: e.target.value })} />
                    <Input label="Cód. Serviço" value={r.codigo_servico} onChange={e => atualizarRascunho(r._key, { codigo_servico: e.target.value })} />
                    <Input label="Valor (R$)" type="number" step="0.01" value={r.valor} onChange={e => atualizarRascunho(r._key, { valor: e.target.value })} />
                    <div className="col-span-2">
                      <Input label="Discriminação" value={r.discriminacao} onChange={e => atualizarRascunho(r._key, { discriminacao: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                {prontos} nota{prontos !== 1 ? 's' : ''} pronta{prontos !== 1 ? 's' : ''} para salvar
              </span>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => setRascunhos([])}>Limpar tudo</Btn>
                <Btn onClick={salvarTodos} disabled={salvando || prontos === 0}>
                  Salvar {prontos > 0 ? prontos : ''} nota{prontos !== 1 ? 's' : ''}
                </Btn>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Formulário manual */}
      <Card>
        <CardTitle>Registrar Manualmente</CardTitle>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Input label="Número da NFS-e" value={numero} onChange={e => setNumero(e.target.value)} placeholder="00018599" />
          <Input label="Data" type="date" value={data} onChange={e => setData(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Input label="Prestador (Razão Social)" value={prestador} onChange={e => setPrestador(e.target.value)} placeholder="VESTI LOCACAO E PRESTACAO..." />
          <Input label="CNPJ do Prestador" value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="24.480.018/0001-04" />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Input label="Código do Serviço" value={codigoServico} onChange={e => setCodigoServico(e.target.value)} placeholder="01899" />
          <Input label="Valor (R$)" value={valor} onChange={e => setValor(e.target.value)} placeholder="2073.25" type="number" step="0.01" />
        </div>
        <div className="mb-4">
          <Input label="Discriminação dos Serviços" value={discriminacao} onChange={e => setDiscriminacao(e.target.value)} placeholder="Assistente - R$ 1.600,00 / plano_avançado - R$ 473,25" />
        </div>
        <Btn onClick={adicionar} disabled={salvando || !prestador || !valor || !numero}>
          + Adicionar
        </Btn>
      </Card>

      {/* Tabela */}
      <Card>
        <CardTitle sub={`${notas.length} nota${notas.length !== 1 ? 's' : ''} · Total: ${brl(total)}${pendentes > 0 ? ` · ${pendentes} pendente${pendentes !== 1 ? 's' : ''}` : ''}`}>
          Notas de Serviço do Mês
        </CardTitle>
        {notas.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma nota de serviço registrada</p>
        ) : (
          <Table headers={['Nº', 'Data', 'Prestador', 'Discriminação', 'Valor', 'Status', '']}>
            {notas.map(n => (
              <Tr key={n.id}>
                <Td mono>{n.numero}</Td>
                <Td>{fmtData(n.data)}</Td>
                <Td>
                  <div className="font-medium text-sm">{n.prestador}</div>
                  {n.cnpj_prestador && <div className="text-xs text-muted-foreground">{n.cnpj_prestador}</div>}
                </Td>
                <Td>
                  <div className="max-w-[200px] truncate text-xs text-muted-foreground" title={n.discriminacao ?? ''}>
                    {n.discriminacao ?? '—'}
                  </div>
                </Td>
                <Td mono>{brl(Number(n.valor))}</Td>
                <Td>
                  {n.status === 'conciliada'
                    ? <Badge variant="ok">Conciliada</Badge>
                    : <Badge variant="pending">Pendente</Badge>
                  }
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    {n.status === 'pendente' ? (
                      <Btn variant="ghost" className="h-7 text-xs px-2" onClick={() => buscarMatches(n)}>
                        Cruzar banco
                      </Btn>
                    ) : (
                      <Btn variant="ghost" className="h-7 text-xs px-2 text-muted-foreground" onClick={() => desvincular(n)}>
                        Desvincular
                      </Btn>
                    )}
                    <RowActions
                      onEdit={() => { setEditando(n); preencherForm(n) }}
                      onDelete={() => setExcluindo(n.id)}
                    />
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Modal edição */}
      {editando && (
        <Modal title="Editar Nota de Serviço" onClose={() => { setEditando(null); limparForm() }}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Input label="Número da NFS-e" value={numero} onChange={e => setNumero(e.target.value)} />
            <Input label="Data" type="date" value={data} onChange={e => setData(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Input label="Prestador" value={prestador} onChange={e => setPrestador(e.target.value)} />
            <Input label="CNPJ" value={cnpj} onChange={e => setCnpj(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Input label="Código do Serviço" value={codigoServico} onChange={e => setCodigoServico(e.target.value)} />
            <Input label="Valor (R$)" value={valor} onChange={e => setValor(e.target.value)} type="number" step="0.01" />
          </div>
          <div className="mb-4">
            <Input label="Discriminação" value={discriminacao} onChange={e => setDiscriminacao(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => { setEditando(null); limparForm() }}>Cancelar</Btn>
            <Btn onClick={salvarEdicao} disabled={salvando}>Salvar</Btn>
          </div>
        </Modal>
      )}

      {/* Modal cruzamento banco */}
      {matches && (
        <Modal title="Cruzar com Lançamento Bancário" onClose={() => setMatches(null)} className="!max-w-2xl">
          {matches.lancamentos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhum lançamento bancário de saída com valor igual encontrado neste período.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Lançamentos de saída com valor exato — selecione para vincular:
              </p>
              <Table headers={['Data', 'Descrição', 'Valor', '']}>
                {matches.lancamentos.map(l => (
                  <Tr key={l.id}>
                    <Td>{fmtData(l.data)}</Td>
                    <Td>{l.descricao}</Td>
                    <Td mono>{brl(l.valor)}</Td>
                    <Td>
                      <Btn className="h-7 text-xs px-2" onClick={() => vincular(matches.notaId, l.id)}>
                        Vincular
                      </Btn>
                    </Td>
                  </Tr>
                ))}
              </Table>
            </>
          )}
          <div className="flex justify-end mt-4">
            <Btn variant="ghost" onClick={() => setMatches(null)}>Fechar</Btn>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ConfirmDelete
          msg="Excluir esta nota de serviço?"
          onConfirm={() => excluir(excluindo)}
          onCancel={() => setExcluindo(null)}
        />
      )}
    </div>
  )
}
