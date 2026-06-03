'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardTitle, ConfirmDelete, Toast, fmtData, brl } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { Search, X, Ban, RotateCcw } from 'lucide-react'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

type Resultado = {
  id: string
  tipo: 'compra' | 'nota'
  data: string
  descricao: string    // fornecedor ou cliente_nf
  numero?: string      // nf_entrada ou numero
  valor: number
  cancelada: boolean
  periodo: string
}

export default function BuscaLancamentos({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [toast, setToast] = useState('')
  const [confirmando, setConfirmando] = useState<{ id: string; tipo: 'compra' | 'nota'; acao: 'cancelar' | 'reativar' } | null>(null)

  // Re-executa a busca atual quando os dados mudam (atualizar / após import)
  useEffect(() => { if (busca.trim()) pesquisar(busca) }, [refresh])

  const pesquisar = useCallback(async (termo: string) => {
    if (!termo.trim()) { setResultados([]); return }
    setBuscando(true)

    const t = `%${termo.trim()}%`

    // Busca em compras (por fornecedor ou nf_entrada)
    const { data: compras } = await supabase
      .from('compras')
      .select('id, data, fornecedor, nf_entrada, valor, cancelada, periodo')
      .eq('cliente_id', clienteId)
      .or(`fornecedor.ilike.${t},nf_entrada.ilike.${t}`)
      .order('data', { ascending: false })
      .limit(50)

    // Busca em notas_fiscais (por número ou cliente_nf)
    const { data: notas } = await supabase
      .from('notas_fiscais')
      .select('id, data, numero, cliente_nf, valor, cancelada, periodo')
      .eq('cliente_id', clienteId)
      .or(`numero.ilike.${t},cliente_nf.ilike.${t}`)
      .order('data', { ascending: false })
      .limit(50)

    const lista: Resultado[] = [
      ...(compras || []).map(c => ({
        id: c.id,
        tipo: 'compra' as const,
        data: c.data,
        descricao: c.fornecedor,
        numero: c.nf_entrada || undefined,
        valor: c.valor,
        cancelada: c.cancelada ?? false,
        periodo: c.periodo,
      })),
      ...(notas || []).map(n => ({
        id: n.id,
        tipo: 'nota' as const,
        data: n.data,
        descricao: n.cliente_nf || '—',
        numero: n.numero,
        valor: n.valor,
        cancelada: n.cancelada ?? false,
        periodo: n.periodo,
      })),
    ].sort((a, b) => b.data.localeCompare(a.data))

    setResultados(lista)
    setBuscando(false)
  }, [clienteId])

  async function alterarStatus(id: string, tipo: 'compra' | 'nota', cancelar: boolean) {
    const tabela = tipo === 'compra' ? 'compras' : 'notas_fiscais'
    const { error } = await supabase
      .from(tabela)
      .update({ cancelada: cancelar })
      .eq('id', id)

    if (error) { setToast(`Erro: ${error.message}`); return }

    // Atualiza local imediatamente
    setResultados(prev => prev.map(r =>
      r.id === id ? { ...r, cancelada: cancelar } : r
    ))

    setToast(cancelar ? '✓ Marcado como cancelada' : '✓ Reativado com sucesso')
    setConfirmando(null)
    onRecarregar()
  }

  return (
    <Card>
      <CardTitle>
        <span className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          Buscar Lançamentos — Compras e Notas Fiscais
        </span>
      </CardTitle>

      {/* Campo de busca */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          value={busca}
          onChange={e => { setBusca(e.target.value); pesquisar(e.target.value) }}
          placeholder="Buscar por número da NF ou nome do fornecedor/cliente..."
          className="w-full h-10 rounded-lg border border-border bg-secondary text-foreground text-sm pl-10 pr-10 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {busca && (
          <button onClick={() => { setBusca(''); setResultados([]) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Estado inicial */}
      {!busca && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Digite o número da nota ou nome do fornecedor para buscar
        </p>
      )}

      {/* Carregando */}
      {buscando && (
        <p className="text-sm text-muted-foreground text-center py-4">Buscando...</p>
      )}

      {/* Sem resultados */}
      {busca && !buscando && resultados.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhum lançamento encontrado para <strong>"{busca}"</strong>
        </p>
      )}

      {/* Resultados */}
      {resultados.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            {resultados.length} resultado(s) encontrado(s)
            {resultados.filter(r => r.cancelada).length > 0 && (
              <span className="ml-2 text-red-400">
                · {resultados.filter(r => r.cancelada).length} cancelada(s)
              </span>
            )}
          </p>

          <div className="space-y-2">
            {resultados.map(r => (
              <div key={r.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  r.cancelada
                    ? 'border-red-500/20 bg-red-500/5 opacity-60'
                    : 'border-border bg-secondary/40 hover:bg-secondary'
                }`}
              >
                {/* Tipo badge */}
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${
                  r.tipo === 'compra'
                    ? 'bg-purple-500/15 text-purple-400'
                    : 'bg-blue-500/15 text-blue-400'
                }`}>
                  {r.tipo === 'compra' ? 'Compra' : 'NF'}
                </span>

                {/* Data */}
                <span className="text-xs text-muted-foreground whitespace-nowrap w-20 shrink-0">
                  {fmtData(r.data)}
                </span>

                {/* Número */}
                {r.numero && (
                  <span className="text-xs font-mono bg-card border border-border px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
                    {r.numero}
                  </span>
                )}

                {/* Descrição */}
                <span className={`text-sm flex-1 truncate ${r.cancelada ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {r.descricao}
                </span>

                {/* Período */}
                <span className="text-xs text-muted-foreground shrink-0 hidden md:block">
                  {r.periodo}
                </span>

                {/* Valor */}
                <span className="text-sm font-semibold shrink-0 w-24 text-right">
                  {brl(r.valor)}
                </span>

                {/* Status */}
                {r.cancelada && (
                  <span className="text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                    Cancelada
                  </span>
                )}

                {/* Ação */}
                {r.cancelada ? (
                  <Button variant="outline" size="sm" className="text-xs gap-1.5 shrink-0 h-7"
                    onClick={() => setConfirmando({ id: r.id, tipo: r.tipo, acao: 'reativar' })}>
                    <RotateCcw className="h-3 w-3" /> Reativar
                  </Button>
                ) : (
                  <Button variant="outline" size="sm"
                    className="text-xs gap-1.5 shrink-0 h-7 text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => setConfirmando({ id: r.id, tipo: r.tipo, acao: 'cancelar' })}>
                    <Ban className="h-3 w-3" /> Cancelar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Confirmação */}
      {confirmando && (
        <ConfirmDelete
          msg={
            confirmando.acao === 'cancelar'
              ? `Marcar este ${confirmando.tipo === 'compra' ? 'compra' : 'nota fiscal'} como cancelada? O registro será mantido mas marcado como inativo.`
              : `Reativar este lançamento? Ele voltará a aparecer nos relatórios normalmente.`
          }
          onConfirm={() => alterarStatus(confirmando.id, confirmando.tipo, confirmando.acao === 'cancelar')}
          onCancel={() => setConfirmando(null)}
        />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </Card>
  )
}
