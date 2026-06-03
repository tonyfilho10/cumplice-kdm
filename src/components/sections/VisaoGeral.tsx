'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calcularSimples, calcularLucroPresumido } from '@/lib/crossref'
import type { Cliente, Compra, Despesa, NotaFiscal, BancoLancamento } from '@/lib/supabase/types'
import { AlertBar, Card, CardTitle, KpiCard, Tag, brl, brlC, pct } from '@/components/ui'
import { ehVenda, ehRemessa, ehRetorno, ehDevolucao } from '@/lib/cfop'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void; cliente: Cliente }

export default function VisaoGeral({ clienteId, periodo, refresh, cliente }: Props) {
  const supabase = createClient()

  // Simulação de estoque — valores temporários (perdem ao atualizar a página)
  const [simEstoqueInicial, setSimEstoqueInicial] = useState('')
  const [simEstoqueFinal, setSimEstoqueFinal]     = useState('')
  const [mostrarSim, setMostrarSim]               = useState(false)

  const [dados, setDados] = useState<{
    notas: NotaFiscal[]; compras: Compra[]; despesas: Despesa[]; banco: BancoLancamento[]
  } | null>(null)
  const [carregando, setCarregando] = useState(true)

  // Limpa dados ao trocar de cliente ou período (mostra loading do zero)
  useEffect(() => {
    setDados(null)
    setCarregando(true)
  }, [clienteId, periodo])

  // Busca dados — em refresh não bloqueia a tela (mantém dados anteriores visíveis)
  useEffect(() => {
    let cancelado = false
    async function carregar() {
      try {
        const [{ data: notas }, { data: compras }, { data: despesas }, { data: banco }] = await Promise.all([
          supabase.from('notas_fiscais').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false),
          supabase.from('compras').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false),
          supabase.from('despesas').select('*').eq('cliente_id', clienteId).eq('periodo', periodo),
          supabase.from('banco_lancamentos').select('*').eq('cliente_id', clienteId).eq('periodo', periodo),
        ])
        if (cancelado) return
        setDados({
          notas: (notas || []) as NotaFiscal[],
          compras: (compras || []).map(r => ({ ...r, status: r.nf_entrada ? 'ok' : 'sem_nf' })) as Compra[],
          despesas: (despesas || []).map(r => ({ ...r, status: r.documento ? 'ok' : 'sem_doc' })) as Despesa[],
          banco: (banco || []) as BancoLancamento[],
        })
      } catch {
        if (!cancelado) setDados({ notas: [], compras: [], despesas: [], banco: [] })
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }
    carregar()
    return () => { cancelado = true }
  }, [clienteId, periodo, refresh])

  if (carregando || !dados) {
    return <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Carregando...</div>
  }

  const { notas, compras, despesas, banco } = dados

  // Classifica NFs por CFOP
  const notasVenda     = notas.filter(n => ehVenda(n.cfop))
  const notasRemessa   = notas.filter(n => ehRemessa(n.cfop))
  const notasRetorno   = notas.filter(n => ehRetorno(n.cfop))
  const notasDevolucao = notas.filter(n => ehDevolucao(n.cfop))

  // Totais por tipo
  const total_remessas         = notasRemessa.reduce((s, n) => s + n.valor, 0)
  // (notasRetorno agora é remessa, total_retornos mantido para compatibilidade)
  const total_retornos         = notasRetorno.reduce((s, n) => s + n.valor, 0)

  // Faturamento real = vendas − devoluções − retornos
  // Remessas: excluídas (neutras — saída de estoque sem receita)
  const faturamento_vendas     = notasVenda.reduce((s, n) => s + n.valor, 0)
  const faturamento_devolucoes = notasDevolucao.reduce((s, n) => s + n.valor, 0)
  const faturamento_nf         = faturamento_vendas - faturamento_devolucoes - total_retornos

  const entradas_banco = banco.filter(b => b.tipo === 'entrada').reduce((s, b) => s + b.valor, 0)
  const total_compras = compras.reduce((s, c) => s + c.valor, 0)
  const total_despesas = despesas.reduce((s, d) => s + d.valor, 0)

  const compras_sem_nf = compras.filter(c => c.status === 'sem_nf').reduce((s, c) => s + c.valor, 0)
  const despesas_sem_doc = despesas.filter(d => d.status === 'sem_doc').reduce((s, d) => s + d.valor, 0)
  const divergencia_banco_nf = Math.max(0, entradas_banco - faturamento_nf)

  // Calcula imposto conforme o regime do cliente
  const regimeLower = (cliente.regime || '').toLowerCase()
  const ehPresumido = regimeLower.includes('presumido')
  const ehReal      = regimeLower.includes('real')

  let imposto = 0
  let labelImposto = ''
  let aliquotaImposto = 0

  if (ehPresumido) {
    const { total, pis, cofins, irpj, csll } = calcularLucroPresumido(faturamento_nf)
    imposto = total
    aliquotaImposto = faturamento_nf > 0 ? total / faturamento_nf * 100 : 0
    labelImposto = `Lucro Presumido (PIS+COFINS+IRPJ+CSLL)`
  } else if (ehReal) {
    // Lucro Real: estimativa simplificada (PIS 1.65% + COFINS 7.6% sobre faturamento)
    imposto = faturamento_nf * (0.0165 + 0.076)
    aliquotaImposto = faturamento_nf > 0 ? imposto / faturamento_nf * 100 : 0
    labelImposto = `Lucro Real (PIS+COFINS estimado)`
  } else {
    // Simples Nacional
    const acumulado_est = faturamento_nf * 5
    const r = calcularSimples(acumulado_est, faturamento_nf)
    imposto = r.imposto
    aliquotaImposto = r.aliquota_efetiva * 100
    labelImposto = `Simples Nacional`
  }

  // CMV só é calculado com estoque informado
  // Fórmula: CMV = Estoque Inicial + Compras − Estoque Final
  // Sem estoque → CMV indefinido (não calcula lucro bruto)
  const estoqueIni = parseFloat(simEstoqueInicial.replace(/\./g,'').replace(',','.')) || 0
  const estoqueFin = parseFloat(simEstoqueFinal.replace(/\./g,'').replace(',','.')) || 0
  const usando_sim  = estoqueIni > 0 || estoqueFin > 0
  const cmv_simulado = usando_sim ? estoqueIni + total_compras - estoqueFin : null

  // Lucro bruto só existe quando há CMV calculado
  const lucro_bruto   = cmv_simulado !== null ? faturamento_nf - cmv_simulado : null
  const resultado_liq = lucro_bruto !== null ? lucro_bruto - total_despesas - imposto : null
  const margem = resultado_liq !== null && faturamento_nf > 0
    ? (resultado_liq / faturamento_nf * 100).toFixed(1)
    : null

  const alertas = [
    divergencia_banco_nf > 500 && {
      tipo: 'red', msg: `Receita não declarada: ${brl(divergencia_banco_nf)} entraram no banco sem NF emitida.`,
      meta: 'Risco fiscal alto · Verificar origens', tag: 'RISCO ALTO' as const,
    },
    compras_sem_nf > 200 && {
      tipo: 'red', msg: `Compras sem NF: ${brl(compras_sem_nf)} em compras sem nota de entrada.`,
      meta: 'Crédito perdido · Risco de autuação', tag: 'RISCO ALTO' as const,
    },
    despesas_sem_doc > 300 && {
      tipo: 'orange', msg: `Despesas sem comprovante: ${brl(despesas_sem_doc)} sem documento fiscal.`,
      meta: 'Despesa não dedutível', tag: 'ATENÇÃO' as const,
    },
  ].filter(Boolean) as Array<{ tipo: string; msg: string; meta: string; tag: 'RISCO ALTO' | 'ATENÇÃO' }>

  return (
    <div>
      {alertas.length > 0 && (
        <AlertBar variant={alertas.some(a => a.tipo === 'red') ? 'error' : 'warn'}>
          <span style={{ fontSize: 18 }}>🚨</span>
          <div>
            <strong>{alertas.length} alerta{alertas.length > 1 ? 's' : ''} estratégico{alertas.length > 1 ? 's' : ''} identificado{alertas.length > 1 ? 's' : ''}</strong>
            {' — '}Há divergências entre entradas bancárias e notas emitidas.
          </div>
        </AlertBar>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
        <KpiCard label="Faturamento Real" value={brlC(faturamento_nf)}
          delta={
            (total_remessas + total_retornos) > 0
              ? `−${brlC(total_retornos)} retornos · −${brlC(total_remessas)} rem. excl.`
              : `${notasVenda.length} NFs de venda`
          }
          deltaType={(total_remessas + total_retornos) > 0 ? 'warn' : undefined}
          topColor="var(--accent)" />
        <KpiCard label="Entradas no Banco" value={brlC(entradas_banco)}
          delta={divergencia_banco_nf > 0 ? `⚠ ${brlC(divergencia_banco_nf)} sem NF` : '✓ Conciliado'}
          deltaType={divergencia_banco_nf > 0 ? 'warn' : 'up'} topColor="var(--green)" />
        <KpiCard
          label={usando_sim ? 'CMV (simulação)' : 'Compras do Período'}
          value={usando_sim && cmv_simulado !== null ? brlC(cmv_simulado) : brlC(total_compras)}
          delta={usando_sim && cmv_simulado !== null
            ? `Est.ini ${brlC(estoqueIni)} · Est.fin ${brlC(estoqueFin)}`
            : '⚠ CMV requer estoque — use o simulador'}
          deltaType={usando_sim ? undefined : 'warn'}
          topColor="var(--red)" />
        <KpiCard label="Imposto Estimado" value={brlC(imposto)}
          delta={faturamento_nf > 0 ? `${pct(aliquotaImposto)} · ${ehPresumido ? 'Presumido' : ehReal ? 'Lucro Real' : 'Simples'}` : '—'}
          topColor="var(--gold)" />
      </div>

      {/* Simulador de Estoque */}
      <div className="mb-5 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🧮</span>
            <span className="text-sm font-semibold text-foreground">Simulação de CMV com Estoque</span>
            <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded font-bold uppercase">Temporário</span>
          </div>
          <button onClick={() => setMostrarSim(s => !s)}
            className="text-xs text-primary hover:underline">
            {mostrarSim ? 'Ocultar' : 'Simular'}
          </button>
        </div>
        {mostrarSim && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              CMV = Estoque Inicial + Compras ({brl(total_compras)}) − Estoque Final
              <br/>Valores temporários — somem ao atualizar a página.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Estoque Inicial (R$)</label>
                <input value={simEstoqueInicial} onChange={e => setSimEstoqueInicial(e.target.value)}
                  placeholder="0,00" type="text"
                  className="w-full h-9 rounded-lg border border-border bg-secondary text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground block mb-1">Estoque Final (R$)</label>
                <input value={simEstoqueFinal} onChange={e => setSimEstoqueFinal(e.target.value)}
                  placeholder="0,00" type="text"
                  className="w-full h-9 rounded-lg border border-border bg-secondary text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
            </div>
            {usando_sim && (
              <div className="flex items-center gap-6 text-xs bg-card rounded-lg p-3 border border-border">
                <span className="text-muted-foreground">Est.Ini <strong className="text-foreground">{brl(estoqueIni)}</strong></span>
                <span className="text-muted-foreground">+ Compras <strong className="text-foreground">{brl(total_compras)}</strong></span>
                <span className="text-muted-foreground">− Est.Fin <strong className="text-foreground">{brl(estoqueFin)}</strong></span>
                <span className="font-bold text-red-400">= CMV {brl(cmv_simulado)}</span>
                <button onClick={() => { setSimEstoqueInicial(''); setSimEstoqueFinal('') }}
                  className="ml-auto text-muted-foreground hover:text-destructive text-xs">× Limpar</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cruzamento rápido */}
      <Card style={{ marginBottom: 20 }}>
        <CardTitle>Cruzamento Rápido do Mês</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 20px 1fr 20px 1fr 20px 1fr', gap: 4, alignItems: 'center' }}>
          <CruzCol titulo="🛒 Compras" valor={brl(total_compras)} sub={`${compras.length} notas`} color="var(--accent2)"
            warn={compras_sem_nf > 0 ? `${brl(compras_sem_nf)} s/ NF ⚠` : undefined} />
          <Arrow />
          <CruzCol titulo="🧾 NF Vendas" valor={brl(faturamento_nf)}
            sub={`${notasVenda.length} vendas${notasRemessa.length > 0 ? ` · ${notasRemessa.length} remessas excl.` : ''}`}
            color="var(--green)"
            warn={notasRemessa.length > 0 ? `${brl(total_remessas)} excluídos` : undefined} />
          <Arrow />
          <CruzCol titulo="🏦 Banco" valor={brl(entradas_banco)} sub={`${banco.filter(b => b.tipo === 'entrada').length} entradas`}
            color="var(--gold)" warn={divergencia_banco_nf > 0 ? `+${brl(divergencia_banco_nf)} ⚠` : undefined} />
          <Arrow />
          <CruzCol titulo="💳 Despesas" valor={brl(total_despesas)} sub={`${despesas.length} lançamentos`} color="var(--red)"
            warn={despesas_sem_doc > 0 ? `${brl(despesas_sem_doc)} s/ doc ⚠` : undefined} />
        </div>
      </Card>

      {/* Alertas + Saúde */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 20 }}>
        <Card>
          <CardTitle sub={`${alertas.length} ativo${alertas.length !== 1 ? 's' : ''}`}>Alertas Estratégicos</CardTitle>
          {alertas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--green)' }}>
              ✓ Nenhum alerta — mês limpo!
            </div>
          ) : alertas.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 0', borderBottom: i < alertas.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                background: a.tipo === 'red' ? 'var(--red)' : 'var(--orange)',
                boxShadow: a.tipo === 'red' ? '0 0 6px rgba(239,68,68,0.5)' : '0 0 6px rgba(249,115,22,0.5)',
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{a.msg}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{a.meta}</div>
              </div>
              <Tag variant={a.tipo === 'red' ? 'red' : 'orange'}>{a.tag}</Tag>
            </div>
          ))}
        </Card>

        <Card>
          <CardTitle>Saúde Financeira do Mês</CardTitle>

          {!usando_sim && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-orange-500/10 border border-orange-500/20 px-3 py-2 text-xs text-orange-300">
              ⚠️ <span>Informe o <strong>estoque inicial e final</strong> no simulador para calcular CMV, Lucro Bruto e Resultado.</span>
            </div>
          )}

          <div key="fat" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>Receita Bruta (NF)</span>
            <span style={{ fontWeight: 700, color: 'var(--green)' }}>{brlC(faturamento_nf)}</span>
          </div>
          <div key="cmv" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>{usando_sim ? '(−) CMV (Est.Ini + Compras − Est.Fin)' : '(−) Compras do período'}</span>
            <span style={{ fontWeight: 700, color: usando_sim ? undefined : 'var(--muted)' }}>
              {usando_sim && cmv_simulado !== null ? brlC(cmv_simulado) : <span style={{ fontStyle: 'italic', color: 'var(--muted)' }}>— informe estoque</span>}
            </span>
          </div>
          <div key="lb" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>(=) Lucro Bruto</span>
            <span style={{ fontWeight: 700, color: 'var(--accent2)' }}>
              {lucro_bruto !== null ? brlC(lucro_bruto) : <span style={{ fontStyle: 'italic', color: 'var(--muted)' }}>—</span>}
            </span>
          </div>
          <div key="desp" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>(−) Despesas Operacionais</span>
            <span style={{ fontWeight: 700 }}>{brlC(total_despesas)}</span>
          </div>
          <div key="imp" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>{`(−) Impostos (${ehPresumido ? 'Presumido' : ehReal ? 'Lucro Real' : 'Simples'})`}</span>
            <span style={{ fontWeight: 700 }}>{brlC(imposto)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 0', borderTop: '2px solid var(--accent)', marginTop: 4 }}>
            <span style={{ fontWeight: 700 }}>Resultado Líquido Estimado</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: resultado_liq !== null ? (resultado_liq >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--muted)' }}>
              {resultado_liq !== null ? brlC(resultado_liq) : <span style={{ fontStyle: 'italic', fontSize: 13 }}>— informe estoque</span>}
            </span>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', padding: '10px 12px', borderRadius: 8 }}>
            {faturamento_nf > 0 && margem !== null
              ? <>📌 Margem líquida: <strong style={{ color: 'var(--text)' }}>{margem}%</strong>
                  {parseFloat(margem) < 8 && ' — Abaixo do benchmark do setor (8–12%).'}
                </>
              : faturamento_nf > 0
              ? '📌 Informe o estoque no simulador acima para calcular a margem líquida.'
              : '📌 Sem faturamento registrado neste período.'
            }
          </div>
        </Card>
      </div>
    </div>
  )
}

function CruzCol({ titulo, valor, sub, color, warn }: { titulo: string; valor: string; sub: string; color: string; warn?: string }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8, textAlign: 'center' }}>{titulo}</div>
      <div style={{ fontSize: 17, fontWeight: 700, textAlign: 'center', color, marginBottom: 4 }}>{valor}</div>
      <div style={{ fontSize: 11, color: warn ? 'var(--red)' : 'var(--muted)', textAlign: 'center', fontWeight: warn ? 700 : 400 }}>{warn || sub}</div>
    </div>
  )
}

function Arrow() {
  return <div style={{ textAlign: 'center', fontSize: 18, color: 'var(--muted)' }}>→</div>
}
