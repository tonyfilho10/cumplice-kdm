'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Btn, Card, CardTitle, ConfirmDelete, Input, Modal, RowActions, Select, Toast, brl } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { Plus, Star, Landmark, Wallet } from 'lucide-react'

type ContaBancaria = {
  id: string
  cliente_id: string
  nome: string
  banco: string
  tipo: string
  agencia?: string | null
  numero?: string | null
  principal: boolean
  ativo: boolean
  saldo_inicial?: number | null
  saldo_inicial_data?: string | null
}

type Lancamento = { conta?: string | null; tipo: string; valor: number; data: string }

type Props = {
  clienteId: string
  onContasChange?: (contas: ContaBancaria[]) => void
  lancamentos?: Lancamento[]
}

const BANCOS_BR = [
  'Itaú', 'Bradesco', 'Banco do Brasil', 'Caixa Econômica Federal',
  'Santander', 'Nubank', 'Inter', 'C6 Bank', 'BTG Pactual',
  'Sicoob', 'Sicredi', 'Banrisul', 'Mercado Pago', 'PagBank', 'Outro',
]

const vazio = (clienteId: string): Partial<ContaBancaria> => ({
  cliente_id: clienteId, nome: '', banco: 'Itaú',
  tipo: 'corrente', agencia: '', numero: '', principal: false, ativo: true,
  saldo_inicial: null, saldo_inicial_data: null,
})

export default function ContasBancarias({ clienteId, onContasChange, lancamentos = [] }: Props) {
  const supabase = createClient()
  const [contas, setContas] = useState<ContaBancaria[]>([])
  const [toast, setToast] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Partial<ContaBancaria>>(vazio(clienteId))
  const [modoEdicao, setModoEdicao] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from('contas_bancarias')
      .select('*')
      .eq('cliente_id', clienteId)
      .eq('ativo', true)
      .order('principal', { ascending: false })
      .order('banco')
    let lista = (data || []) as ContaBancaria[]

    // Se tabela vazia, migra automaticamente as contas dos lançamentos existentes
    if (lista.length === 0) {
      const { data: lancamentos } = await supabase
        .from('banco_lancamentos')
        .select('conta')
        .eq('cliente_id', clienteId)
        .not('conta', 'is', null)

      const contasDistintas = [...new Set((lancamentos || []).map(l => l.conta).filter(Boolean))] as string[]

      for (const nome of contasDistintas) {
        // Tenta inferir o banco a partir do nome
        const bancoDetectado = BANCOS_BR.find(b =>
          nome.toUpperCase().includes(b.toUpperCase())
        ) || 'Outro'

        const { data: nova } = await supabase
          .from('contas_bancarias')
          .insert({
            id: crypto.randomUUID(),
            cliente_id: clienteId,
            nome,
            banco: bancoDetectado,
            tipo: nome.toLowerCase().includes('poup') ? 'poupança' : 'corrente',
            principal: contasDistintas.indexOf(nome) === 0,
            ativo: true,
          })
          .select()
          .single()

        if (nova) lista.push(nova as ContaBancaria)
      }

      if (lista.length > 0) {
        setToast(`${lista.length} conta(s) migrada(s) dos lançamentos existentes`)
      }
    }

    setContas(lista)
    onContasChange?.(lista)
  }, [clienteId])

  useEffect(() => { carregar() }, [carregar])

  function abrirNova() {
    setEditando(vazio(clienteId))
    setModoEdicao(false)
    setModalAberto(true)
  }

  function abrirEdicao(c: ContaBancaria) {
    setEditando({ ...c })
    setModoEdicao(true)
    setModalAberto(true)
  }

  // Gera nome automático se não preenchido
  function nomeAuto(e: Partial<ContaBancaria>): string {
    if (e.nome?.trim()) return e.nome.trim()
    const tipo = e.tipo === 'corrente' ? 'CC' : e.tipo === 'poupança' ? 'Poup.' : 'PG'
    const num = e.numero?.trim() ? ` ${e.numero.trim()}` : ''
    return `${e.banco || 'Banco'} ${tipo}${num}`
  }

  async function salvar() {
    const nome = nomeAuto(editando)
    if (!editando.banco) { setToast('Erro: Informe o banco'); return }
    setSalvando(true)

    // Se marcado como principal, desmarca os outros
    if (editando.principal) {
      await supabase.from('contas_bancarias')
        .update({ principal: false })
        .eq('cliente_id', clienteId)
    }

    if (modoEdicao && editando.id) {
      const { error } = await supabase.from('contas_bancarias').update({
        nome, banco: editando.banco, tipo: editando.tipo,
        agencia: editando.agencia || null, numero: editando.numero || null,
        principal: editando.principal ?? false,
        saldo_inicial: editando.saldo_inicial != null ? Number(editando.saldo_inicial) : null,
        saldo_inicial_data: editando.saldo_inicial_data || null,
      }).eq('id', editando.id)
      if (error) { setToast(`Erro: ${error.message}`); setSalvando(false); return }

      // Update otimista
      setContas(prev => prev.map(c =>
        c.id === editando.id ? { ...c, ...editando, nome } as ContaBancaria : c
      ).sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)))
      setToast('Conta atualizada!')
    } else {
      const { data: nova, error } = await supabase.from('contas_bancarias').insert({
        id: crypto.randomUUID(),
        cliente_id: clienteId, nome, banco: editando.banco, tipo: editando.tipo,
        agencia: editando.agencia || null, numero: editando.numero || null,
        principal: editando.principal ?? false, ativo: true,
        saldo_inicial: editando.saldo_inicial != null ? Number(editando.saldo_inicial) : null,
        saldo_inicial_data: editando.saldo_inicial_data || null,
      }).select().single()
      if (error || !nova) { setToast(`Erro: ${error?.message}`); setSalvando(false); return }

      setContas(prev => [...prev, nova as ContaBancaria]
        .sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)))
      setToast('Conta adicionada!')
    }

    setModalAberto(false)
    setSalvando(false)
    await carregar()
  }

  async function tornarPrincipal(id: string) {
    await supabase.from('contas_bancarias').update({ principal: false }).eq('cliente_id', clienteId)
    await supabase.from('contas_bancarias').update({ principal: true }).eq('id', id)
    setToast('Conta principal atualizada!')
    await carregar()
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    // Soft delete
    const { error } = await supabase.from('contas_bancarias').update({ ativo: false }).eq('id', excluindo)
    if (error) { setToast(`Erro: ${error.message}`); setExcluindo(null); return }
    setContas(prev => prev.filter(c => c.id !== excluindo))
    setExcluindo(null)
    setToast('Conta removida!')
    await carregar()
  }

  return (
    <Card className="mb-4">
      <CardTitle>
        <span className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-primary" />
          Contas Bancárias Cadastradas
        </span>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={abrirNova}>
          <Plus className="h-3.5 w-3.5" /> Nova Conta
        </Button>
      </CardTitle>

      {contas.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Landmark className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhuma conta cadastrada</p>
          <p className="text-xs mt-1">Adicione as contas bancárias da empresa</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contas.map(c => (
            <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/50 hover:bg-secondary transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Landmark className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{c.nome}</p>
                    {c.principal && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-amber-500/15 text-amber-500 px-1.5 py-0.5 rounded-full">
                        <Star className="h-2.5 w-2.5" /> Principal
                      </span>
                    )}
                    <span className="text-[10px] bg-secondary border border-border px-1.5 py-0.5 rounded-full text-muted-foreground capitalize">
                      {c.tipo}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c.banco}
                    {c.agencia && ` · Ag. ${c.agencia}`}
                    {c.numero && ` · C/C ${c.numero}`}
                  </p>
                  {c.saldo_inicial != null && (() => {
                    // Saldo atual = saldo_inicial + movimentos após saldo_inicial_data para esta conta
                    const dataRef = c.saldo_inicial_data || '1900-01-01'
                    const movs = lancamentos.filter(l =>
                      l.conta === c.nome && l.data >= dataRef
                    )
                    const movEntradas = movs.filter(l => l.tipo === 'entrada').reduce((s, l) => s + l.valor, 0)
                    const movSaidas   = movs.filter(l => l.tipo === 'saida').reduce((s, l)   => s + l.valor, 0)
                    const saldoAtual  = Number(c.saldo_inicial) + movEntradas - movSaidas
                    return (
                      <div className="mt-1.5 flex flex-wrap gap-3">
                        <span className="text-xs flex items-center gap-1 text-muted-foreground">
                          <Wallet className="h-3 w-3 text-primary/60" />
                          Inicial: <strong className="text-foreground">{brl(c.saldo_inicial)}</strong>
                          {c.saldo_inicial_data && (
                            <span className="text-muted-foreground/70">
                              em {new Date(c.saldo_inicial_data + 'T12:00:00').toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </span>
                        {lancamentos.length > 0 && (
                          <span className={`text-xs font-bold flex items-center gap-1 ${saldoAtual >= 0 ? 'text-green-500' : 'text-red-400'}`}>
                            Saldo atual: {brl(saldoAtual)}
                          </span>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!c.principal && (
                  <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground hover:text-amber-500"
                    onClick={() => tornarPrincipal(c.id)}>
                    <Star className="h-3 w-3 mr-1" /> Principal
                  </Button>
                )}
                <RowActions onEdit={() => abrirEdicao(c)} onDelete={() => setExcluindo(c.id)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalAberto && (
        <Modal title={modoEdicao ? 'Editar Conta' : 'Nova Conta Bancária'} onClose={() => setModalAberto(false)}>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <Select label="Banco *" value={editando.banco || ''} onChange={e => setEditando({ ...editando, banco: e.target.value })}>
              {BANCOS_BR.map(b => <option key={b}>{b}</option>)}
            </Select>
            <Select label="Tipo" value={editando.tipo || 'corrente'} onChange={e => setEditando({ ...editando, tipo: e.target.value })}>
              <option value="corrente">Conta Corrente</option>
              <option value="poupança">Poupança</option>
              <option value="pagamento">Conta Pagamento</option>
              <option value="investimento">Investimento</option>
            </Select>
            <Input label="Agência" value={editando.agencia || ''} onChange={e => setEditando({ ...editando, agencia: e.target.value })} placeholder="0001" />
            <Input label="Número da Conta" value={editando.numero || ''} onChange={e => setEditando({ ...editando, numero: e.target.value })} placeholder="12345-6" />
            <div className="col-span-2">
              <Input
                label="Nome / Apelido (opcional)"
                value={editando.nome || ''}
                onChange={e => setEditando({ ...editando, nome: e.target.value })}
                placeholder={`Deixe vazio para gerar automático: ${nomeAuto(editando)}`}
              />
            </div>
            {/* Saldo inicial */}
            <div className="col-span-2">
              <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-3">
                <div className="flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Saldo Inicial</span>
                  <span className="text-[10px] text-muted-foreground">(opcional)</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Valor (R$)"
                    type="number"
                    step="0.01"
                    value={editando.saldo_inicial != null ? String(editando.saldo_inicial) : ''}
                    onChange={e => setEditando({ ...editando, saldo_inicial: e.target.value !== '' ? parseFloat(e.target.value) : null })}
                    placeholder="0,00"
                  />
                  <Input
                    label="Data de referência"
                    type="date"
                    value={editando.saldo_inicial_data || ''}
                    onChange={e => setEditando({ ...editando, saldo_inicial_data: e.target.value || null })}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Informe o saldo existente nessa conta na data acima. Será usado para calcular o saldo atual.
                </p>
              </div>
            </div>

            <div className="col-span-2 flex items-center gap-2 p-3 rounded-lg border border-border bg-secondary/50">
              <input
                type="checkbox"
                id="principal-check"
                checked={editando.principal ?? false}
                onChange={e => setEditando({ ...editando, principal: e.target.checked })}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="principal-check" className="text-sm text-foreground cursor-pointer">
                Definir como conta <strong>principal</strong>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Btn variant="ghost" onClick={() => setModalAberto(false)}>Cancelar</Btn>
            <Btn onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando...' : modoEdicao ? 'Salvar' : 'Adicionar Conta'}
            </Btn>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ConfirmDelete
          msg={`Remover "${contas.find(c => c.id === excluindo)?.nome}"?`}
          onConfirm={confirmarExclusao}
          onCancel={() => setExcluindo(null)}
        />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </Card>
  )
}
