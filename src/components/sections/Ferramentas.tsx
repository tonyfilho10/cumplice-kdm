'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Btn, Card, CardTitle, ConfirmDelete, Toast, brl } from '@/components/ui'
import { Button } from '@/components/ui/button'
import MonthPicker from '@/components/MonthPicker'
import { Wrench, Trash2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

type Contagem = { notas_fiscais: number; compras: number; banco_lancamentos: number; despesas: number }
type Tabela = keyof Contagem
const TABELAS: { key: Tabela; label: string; cor: string }[] = [
  { key: 'notas_fiscais',     label: 'Notas Fiscais',       cor: 'text-blue-400' },
  { key: 'compras',           label: 'Compras',              cor: 'text-purple-400' },
  { key: 'banco_lancamentos', label: 'Banco (Lançamentos)',  cor: 'text-yellow-400' },
  { key: 'despesas',          label: 'Despesas',             cor: 'text-red-400' },
]

export default function Ferramentas({ clienteId, onRecarregar }: Props) {
  const supabase = createClient()
  const [toast, setToast] = useState('')

  // ── Ferramenta 1: Corrigir períodos ─────────────────────────────────────
  const [corrigindo, setCorrigindo] = useState(false)
  const [resultadoCorrecao, setResultadoCorrecao] = useState<string | null>(null)

  async function corrigirPeriodos() {
    setCorrigindo(true)
    setResultadoCorrecao(null)

    const tabelas = ['notas_fiscais', 'compras', 'banco_lancamentos', 'despesas'] as const
    const resultados: string[] = []
    let totalCorrigido = 0

    for (const tabela of tabelas) {
      // Busca registros onde o período não bate com a data real
      const { data: errados } = await supabase
        .from(tabela)
        .select('id, data, periodo')
        .eq('cliente_id', clienteId)

      const paraCorrigir = (errados || []).filter(r => {
        const periodoCorreto = (r.data as string).substring(0, 7)
        return periodoCorreto !== r.periodo
      })

      if (paraCorrigir.length === 0) continue

      // Corrige em lote
      for (const r of paraCorrigir) {
        const periodoCorreto = (r.data as string).substring(0, 7)
        await supabase.from(tabela).update({ periodo: periodoCorreto }).eq('id', r.id)
      }

      const label = TABELAS.find(t => t.key === tabela)?.label || tabela
      resultados.push(`${label}: ${paraCorrigir.length} corrigidos`)
      totalCorrigido += paraCorrigir.length
    }

    if (totalCorrigido === 0) {
      setResultadoCorrecao('✅ Todos os períodos já estão corretos!')
    } else {
      setResultadoCorrecao(`✅ ${totalCorrigido} registro(s) corrigido(s):\n${resultados.join('\n')}`)
      onRecarregar()
    }
    setCorrigindo(false)
  }

  // ── Ferramenta 2: Excluir por período ────────────────────────────────────
  const [periodoExcluir, setPeriodoExcluir] = useState(() => {
    const hoje = new Date()
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  })
  const [tabelasSelecionadas, setTabelasSelecionadas] = useState<Set<Tabela>>(
    new Set(['notas_fiscais', 'compras', 'banco_lancamentos', 'despesas'])
  )
  const [contagem, setContagem] = useState<Contagem | null>(null)
  const [carregandoContagem, setCarregandoContagem] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  const carregarContagem = useCallback(async () => {
    setCarregandoContagem(true)
    setContagem(null)

    const resultados = await Promise.all(
      TABELAS.map(async ({ key }) => {
        const { count } = await supabase
          .from(key)
          .select('id', { count: 'exact', head: true })
          .eq('cliente_id', clienteId)
          .eq('periodo', periodoExcluir)
        return [key, count ?? 0] as [Tabela, number]
      })
    )

    setContagem(Object.fromEntries(resultados) as Contagem)
    setCarregandoContagem(false)
  }, [clienteId, periodoExcluir])

  function toggleTabela(t: Tabela) {
    setTabelasSelecionadas(prev => {
      const novo = new Set(prev)
      if (novo.has(t)) novo.delete(t); else novo.add(t)
      return novo
    })
  }

  const totalSelecionado = contagem
    ? [...tabelasSelecionadas].reduce((s, t) => s + (contagem[t] || 0), 0)
    : 0

  async function executarExclusao() {
    setExcluindo(true)
    let totalExcluido = 0

    for (const tabela of tabelasSelecionadas) {
      const { error } = await supabase
        .from(tabela)
        .delete()
        .eq('cliente_id', clienteId)
        .eq('periodo', periodoExcluir)

      if (!error) totalExcluido += contagem?.[tabela] || 0
      else setToast(`Erro em ${tabela}: ${error.message}`)
    }

    setConfirmandoExclusao(false)
    setContagem(null)
    setExcluindo(false)
    setToast(`✅ ${totalExcluido} registro(s) excluído(s) de ${periodoExcluir}`)
    onRecarregar()
  }

  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const labelPeriodo = (() => {
    const [ano, mes] = periodoExcluir.split('-')
    return `${meses[parseInt(mes) - 1]}/${ano}`
  })()

  return (
    <div className="space-y-5">

      {/* ── Corrigir períodos ── */}
      <Card>
        <CardTitle>
          <span className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            Corrigir Períodos Automaticamente
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Encontra e corrige registros onde o período cadastrado não corresponde à data do documento.
          Ex: NF de Abril que foi salva em Junho.
        </p>

        {resultadoCorrecao && (
          <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400 whitespace-pre-line">
            {resultadoCorrecao}
          </div>
        )}

        <Button onClick={corrigirPeriodos} disabled={corrigindo} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${corrigindo ? 'animate-spin' : ''}`} />
          {corrigindo ? 'Corrigindo...' : 'Verificar e Corrigir Períodos'}
        </Button>
      </Card>

      {/* ── Excluir por período ── */}
      <Card>
        <CardTitle>
          <span className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Excluir Lançamentos por Período
          </span>
        </CardTitle>

        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 mb-5">
          <AlertTriangle className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
          <p className="text-xs text-orange-300">
            Esta ação exclui <strong>permanentemente</strong> todos os registros do período selecionado.
            Útil para limpar importações incorretas e reimportar do zero.
          </p>
        </div>

        {/* Seleção de período */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
              Período a excluir
            </label>
            <div className="w-64">
              <MonthPicker value={periodoExcluir} onChange={v => { setPeriodoExcluir(v); setContagem(null) }} />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
              Tabelas a incluir
            </label>
            <div className="space-y-2">
              {TABELAS.map(({ key, label, cor }) => (
                <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={tabelasSelecionadas.has(key)}
                    onChange={() => toggleTabela(key)}
                    className="w-3.5 h-3.5 accent-primary"
                  />
                  <span className={`text-sm ${cor} group-hover:opacity-80`}>{label}</span>
                  {contagem && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {contagem[key].toLocaleString('pt-BR')} registros
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" onClick={carregarContagem} disabled={carregandoContagem} className="gap-2 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {carregandoContagem ? 'Verificando...' : `Ver quantos registros em ${labelPeriodo}`}
          </Button>

          {contagem && totalSelecionado > 0 && (
            <Button
              variant="destructive"
              onClick={() => setConfirmandoExclusao(true)}
              disabled={excluindo}
              className="gap-2 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir {totalSelecionado.toLocaleString('pt-BR')} registros de {labelPeriodo}
            </Button>
          )}

          {contagem && totalSelecionado === 0 && (
            <span className="text-sm text-muted-foreground">
              ✓ Nenhum registro no período {labelPeriodo} para as tabelas selecionadas
            </span>
          )}
        </div>

        {/* Resumo da contagem */}
        {contagem && totalSelecionado > 0 && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            {TABELAS.filter(t => tabelasSelecionadas.has(t.key)).map(({ key, label, cor }) => (
              <div key={key} className="rounded-lg bg-secondary border border-border p-3 text-center">
                <p className={`text-xl font-bold ${cor}`}>{contagem[key].toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {confirmandoExclusao && (
        <ConfirmDelete
          msg={`Excluir permanentemente ${totalSelecionado.toLocaleString('pt-BR')} registro(s) de ${labelPeriodo}? Esta ação não pode ser desfeita.`}
          onConfirm={executarExclusao}
          onCancel={() => setConfirmandoExclusao(false)}
        />
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}
