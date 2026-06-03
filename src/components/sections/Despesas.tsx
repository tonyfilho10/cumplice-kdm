'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Despesa } from '@/lib/supabase/types'
import { checkPeriodoAberto } from '@/lib/periodo-check-client'
import {
  Badge, Btn, Card, CardTitle, ConfirmDelete, Input, Modal,
  RowActions, Select, Table, Td, Toast, Tr, brl, fmtData,
} from '@/components/ui'
import UploadComprovante from '@/components/UploadComprovante'

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
    // status é coluna gerada que não existe após prisma db push — deriva do documento
    const comStatus = (rows || []).map(r => ({
      ...r,
      status: (r.documento ? 'ok' : 'sem_doc') as 'ok' | 'sem_doc',
    }))
    setDespesas(comStatus as Despesa[])
  }, [clienteId, periodo])

  useEffect(() => { carregar() }, [carregar, refresh])

  // ── Conferência banco × despesas ──────────────────────────────────────
  const [saidasBanco, setSaidasBanco] = useState<{ descricao: string; valor: number; categoria: string | null; data: string }[]>([])
  const [mostrarConferencia, setMostrarConferencia] = useState(false)

  async function carregarConferencia() {
    const { data: rows } = await supabase
      .from('banco_lancamentos')
      .select('descricao, valor, categoria, data')
      .eq('cliente_id', clienteId)
      .eq('periodo', periodo)
      .eq('tipo', 'saida')
      .gt('valor', 0)
    setSaidasBanco((rows || []) as typeof saidasBanco)
    setMostrarConferencia(true)
  }

  async function adicionar() {
    if (!desc || !valor) return
    const erroP = await checkPeriodoAberto(clienteId, data)
    if (erroP) { setToast(`Erro: ${erroP}`); return }
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

      {/* Conferência banco × despesas */}
      <div className="mb-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Conferência: Saídas Banco × Despesas</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Despesas: <strong className="text-foreground">{despesas.length}</strong> registros · {brl(total)}
              {saidasBanco.length > 0 && (
                <span className="ml-2">
                  Saídas banco: <strong className="text-foreground">{saidasBanco.length}</strong> · {brl(saidasBanco.reduce((s,l)=>s+l.valor,0))}
                </span>
              )}
            </p>
          </div>
          <button onClick={carregarConferencia}
            className="text-xs text-primary border border-primary/30 bg-primary/5 px-3 py-1.5 rounded-lg hover:bg-primary/15 transition-colors">
            {mostrarConferencia ? '↻ Atualizar' : '🔍 Conferir'}
          </button>
        </div>

        {mostrarConferencia && saidasBanco.length > 0 && (() => {
          const totalBanco = saidasBanco.reduce((s,l)=>s+l.valor,0)
          const totalDesp  = total
          const diff       = totalBanco - totalDesp
          const despHash   = new Set(despesas.map(d => `${d.data}|${d.valor}|${d.descricao}`))
          const semDespesa = saidasBanco.filter(l => !despHash.has(`${l.data}|${l.valor}|${l.descricao}`))
          const semBanco   = despesas.filter(d => !saidasBanco.some(l => l.data === d.data && l.valor === d.valor && l.descricao === d.descricao))

          return (
            <div className="mt-4 space-y-3">
              {/* Totais */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-secondary p-3 text-center">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Saídas Banco</p>
                  <p className="text-lg font-bold text-foreground">{saidasBanco.length}</p>
                  <p className="text-xs text-red-400">{brl(totalBanco)}</p>
                </div>
                <div className="rounded-lg bg-secondary p-3 text-center">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Despesas</p>
                  <p className="text-lg font-bold text-foreground">{despesas.length}</p>
                  <p className="text-xs text-orange-400">{brl(totalDesp)}</p>
                </div>
                <div className={`rounded-lg p-3 text-center ${Math.abs(diff) < 1 ? 'bg-green-500/10 border border-green-500/20' : 'bg-orange-500/10 border border-orange-500/20'}`}>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Diferença</p>
                  <p className={`text-lg font-bold ${Math.abs(diff) < 1 ? 'text-green-400' : 'text-orange-400'}`}>{Math.abs(saidasBanco.length - despesas.length)}</p>
                  <p className={`text-xs ${Math.abs(diff) < 1 ? 'text-green-400' : 'text-orange-400'}`}>{diff > 0 ? '+' : ''}{brl(diff)}</p>
                </div>
              </div>

              {/* Saídas sem despesa */}
              {semDespesa.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-orange-400 mb-2">⚠️ {semDespesa.length} saída(s) do banco sem despesa correspondente:</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {semDespesa.map((l, i) => (
                      <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-secondary">
                        <span className="text-muted-foreground">{l.data}</span>
                        <span className="flex-1 mx-2 truncate text-foreground">{l.descricao}</span>
                        <span className="text-xs bg-secondary border border-border px-1.5 py-0.5 rounded text-muted-foreground shrink-0">{l.categoria || '—'}</span>
                        <span className="text-red-400 font-semibold ml-2 shrink-0">{brl(l.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Despesas sem lançamento banco */}
              {semBanco.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-blue-400 mb-2">ℹ️ {semBanco.length} despesa(s) sem lançamento bancário (entrada manual ou caixa):</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {semBanco.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-secondary">
                        <span className="text-muted-foreground">{d.data}</span>
                        <span className="flex-1 mx-2 truncate text-foreground">{d.descricao}</span>
                        <span className="text-primary font-semibold ml-2 shrink-0">{brl(d.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {semDespesa.length === 0 && semBanco.length === 0 && (
                <p className="text-center text-sm text-green-400 py-2">✅ Saídas bancárias e despesas estão alinhadas!</p>
              )}
            </div>
          )
        })()}
      </div>

      <Card>
        <CardTitle sub={`Total: ${brl(total)}${semDoc > 0 ? ` · ${brl(semDoc)} sem comprovante ⚠` : ''}`}>
          Despesas do Mês
        </CardTitle>
        <Table headers={['Data', 'Descrição', 'Categoria', 'Banco', 'Valor', 'Documento', 'Comprovante', 'Status', '']}>
          {despesas.map(d => (
            <Tr key={d.id}>
              <Td>{fmtData(d.data)}</Td>
              <Td>{d.descricao}</Td>
              <Td>{d.categoria}</Td>
              <Td>
                {(d as any).conta_banco
                  ? <span className="text-xs bg-secondary border border-border px-2 py-0.5 rounded-full text-muted-foreground whitespace-nowrap">{(d as any).conta_banco}</span>
                  : d.pago_banco ? <span className="text-xs text-muted-foreground">Banco</span> : <span className="text-muted-foreground text-xs">—</span>}
              </Td>
              <Td>{brl(d.valor)}</Td>
              <Td mono>{d.documento || <span className="text-muted-foreground text-xs">—</span>}</Td>
              <Td>
                <UploadComprovante
                  tabela="despesas"
                  registroId={d.id}
                  clienteId={clienteId}
                  urlAtual={(d as any).comprovante_url}
                  onAtualizado={url => setDespesas(prev => prev.map(x => x.id === d.id ? { ...x, comprovante_url: url } as any : x))}
                />
              </Td>
              <Td><Badge variant={d.status === 'ok' || (d as any).comprovante_url ? 'ok' : 'err'}>{(d as any).comprovante_url ? '📎 Anexado' : d.status === 'ok' ? '✓ OK' : '⚠ Sem doc'}</Badge></Td>
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
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Categoria</label>
              <input
                list="categorias-despesa"
                value={editando.categoria || ''}
                onChange={e => setEditando({ ...editando, categoria: e.target.value })}
                placeholder="Selecione ou digite..."
                className="h-9 rounded-md border border-border bg-secondary text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <datalist id="categorias-despesa">
                <option>Aluguel</option><option>Energia Elétrica</option><option>Folha de Pagamento</option>
                <option>Pró-Labore</option><option>Telefone/Internet</option><option>Contabilidade</option>
                <option>Marketing</option><option>Manutenção</option><option>Tecnologia/Software</option>
                <option>Serviços Gerais</option><option>Imposto/Tributo</option><option>Outro</option>
              </datalist>
            </div>
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
