'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calcularSimples, calcularLucroPresumido } from '@/lib/crossref'
import type { Cliente, Compra, Despesa, DocumentoSped, NotaFiscal, BancoLancamento } from '@/lib/supabase/types'
import { Card, CardTitle, KpiCard, brl, brlC, pct } from '@/components/ui'
import { ehVenda, ehRemessa, ehRetorno, ehDevolucao, ehDevolucaoEntrada } from '@/lib/cfop'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void; cliente: Cliente }

// Busca todas as linhas superando o limite de 1000 do Supabase
async function fetchTudo(supabase: ReturnType<typeof createClient>, tabela: string, filtros: Record<string, string | boolean>) {
  const PAGE = 1000
  let from = 0
  const tudo: unknown[] = []
  while (true) {
    let q = supabase.from(tabela).select('*')
    for (const [k, v] of Object.entries(filtros)) q = q.eq(k, v)
    const { data } = await q.range(from, from + PAGE - 1)
    if (!data || data.length === 0) break
    tudo.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return tudo
}

export default function VisaoGeral({ clienteId, periodo, refresh, cliente }: Props) {
  const supabase = createClient()

  // Simulação de estoque — valores temporários (perdem ao atualizar a página)
  const [simEstoqueInicial, setSimEstoqueInicial] = useState('')
  const [simEstoqueFinal, setSimEstoqueFinal]     = useState('')
  const [mostrarSim, setMostrarSim]               = useState(false)

  const [dados, setDados] = useState<{
    notas: NotaFiscal[]; compras: Compra[]; despesas: Despesa[]; banco: BancoLancamento[]
    sped: DocumentoSped[]
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
        const [notas, compras, despesas, banco, sped] = await Promise.all([
          fetchTudo(supabase, 'notas_fiscais', { cliente_id: clienteId, periodo, cancelada: false }),
          fetchTudo(supabase, 'compras',        { cliente_id: clienteId, periodo, cancelada: false }),
          fetchTudo(supabase, 'despesas',       { cliente_id: clienteId, periodo }),
          fetchTudo(supabase, 'banco_lancamentos', { cliente_id: clienteId, periodo }),
          fetchTudo(supabase, 'documentos_sped', { cliente_id: clienteId, periodo, cancelado: false }),
        ])
        if (cancelado) return
        setDados({
          notas: notas as NotaFiscal[],
          compras: (compras as Compra[]).map(r => ({ ...r, status: r.nf_entrada ? 'ok' : 'sem_nf' })),
          despesas: (despesas as Despesa[]).map(r => ({ ...r, status: (r.documento || (r as unknown as { comprovante_url?: string }).comprovante_url) ? 'ok' : 'sem_doc' })),
          banco: banco as BancoLancamento[],
          sped: sped as DocumentoSped[],
        })
      } catch {
        if (!cancelado) setDados({ notas: [], compras: [], despesas: [], banco: [], sped: [] })
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }
    carregar()
    return () => { cancelado = true }
  }, [clienteId, periodo, refresh])

  if (carregando || !dados) {
    return <div style={{ color: 'var(--muted-foreground)', padding: 40, textAlign: 'center' }}>Carregando...</div>
  }

  const { notas, compras, despesas, banco, sped } = dados

  // ── SPED como fonte de dados quando tabelas manuais estão vazias ─────────
  // Fonte dos dados: 'nf' (notas_fiscais) ou 'sped' (documentos_sped)
  const usandoSpedFaturamento = notas.length === 0 && sped.length > 0
  const usandoSpedCompras     = compras.length === 0 && sped.length > 0

  // Faturamento via notas_fiscais (XML/manual)
  const notasVenda     = notas.filter(n => ehVenda(n.cfop))
  const notasRemessa   = notas.filter(n => ehRemessa(n.cfop))
  const notasRetorno   = notas.filter(n => ehRetorno(n.cfop))
  const notasDevolucao = notas.filter(n => ehDevolucao(n.cfop))
  const total_remessas         = notasRemessa.reduce((s, n) => s + n.valor, 0)
  const total_retornos         = notasRetorno.reduce((s, n) => s + n.valor, 0)
  const faturamento_vendas_nf  = notasVenda.reduce((s, n) => s + n.valor, 0)
  const faturamento_devolucoes = notasDevolucao.reduce((s, n) => s + n.valor, 0)
  const faturamento_nf_manual  = faturamento_vendas_nf - faturamento_devolucoes

  // Faturamento via SPED (saídas com classificacao='venda')
  const spedVendas         = sped.filter(d => d.tipo === 'saida' && d.classificacao === 'venda')
  const faturamento_nf_sped = spedVendas.reduce((s, d) => s + d.valor_total, 0)

  // Faturamento efetivo: prioriza notas_fiscais; cai para SPED quando vazio
  const faturamento_nf = usandoSpedFaturamento ? faturamento_nf_sped : faturamento_nf_manual

  const entradas_banco = banco.filter(b => b.tipo === 'entrada').reduce((s, b) => s + b.valor, 0)

  // Compras via tabela compras (manual/XML)
  const ehDev = (c: Compra) => !!c.devolucao || ehDevolucaoEntrada(c.cfop)
  const total_bruto_compras  = compras.reduce((s, c) => s + c.valor, 0)
  const devolucoes_entrada   = compras.filter(c => ehDev(c)).reduce((s, c) => s + c.valor, 0)
  const compras_brutas       = total_bruto_compras
  const total_compras_manual = total_bruto_compras - devolucoes_entrada

  // Compras via SPED (entradas com classificacao='compra')
  const spedCompras      = sped.filter(d => d.tipo === 'entrada' && d.classificacao === 'compra')
  const total_compras_sped = spedCompras.reduce((s, d) => s + d.valor_total, 0)

  // Compras efetivas: prioriza tabela compras; cai para SPED quando vazio
  const total_compras = usandoSpedCompras ? total_compras_sped : total_compras_manual

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

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
        <KpiCard
          label={usandoSpedFaturamento ? 'Faturamento Real (SPED)' : 'Faturamento Real'}
          value={brlC(faturamento_nf)}
          delta={
            usandoSpedFaturamento
              ? `via SPED · ${spedVendas.length} docs venda`
              : (total_remessas + total_retornos) > 0
                ? `${brlC(total_remessas + total_retornos)} excl. (remessas/retornos)`
                : `${notasVenda.length} NFs de venda`
          }
          deltaType={usandoSpedFaturamento ? 'up' : undefined}
          topColor="var(--accent)" />
        <KpiCard label="Entradas no Banco" value={brlC(entradas_banco)}
          delta={divergencia_banco_nf > 0 ? `⚠ ${brlC(divergencia_banco_nf)} sem NF` : '✓ Conciliado'}
          deltaType={divergencia_banco_nf > 0 ? 'warn' : 'up'} topColor="var(--green)" />
        <KpiCard
          label={usandoSpedCompras ? 'Compras Líquidas (SPED)' : usando_sim ? 'Compras (c/ CMV simulado)' : 'Compras Líquidas'}
          value={usando_sim && cmv_simulado !== null ? brlC(cmv_simulado) : brlC(total_compras)}
          delta={usandoSpedCompras && !usando_sim
            ? `via SPED · ${spedCompras.length} docs compra`
            : usando_sim && cmv_simulado !== null
              ? `Est.ini ${brlC(estoqueIni)} · Est.fin ${brlC(estoqueFin)}`
              : devolucoes_entrada > 0
                ? `Bruto ${brlC(compras_brutas)} − Dev. ${brlC(devolucoes_entrada)}`
                : '⚠ CMV requer estoque — use o simulador'}
          deltaType={usandoSpedCompras && !usando_sim ? 'up' : usando_sim ? undefined : devolucoes_entrada > 0 ? undefined : 'warn'}
          topColor="var(--red)" />
        <KpiCard label="Imposto Estimado" value={brlC(imposto)}
          delta={faturamento_nf > 0 ? `${pct(aliquotaImposto)} · ${ehPresumido ? 'Presumido' : ehReal ? 'Lucro Real' : 'Simples'}` : '—'}
          topColor="var(--gold)" />
      </div>

      {/* Simulador de Estoque */}
      <div className="mb-5 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base"></span>
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
          <CruzCol titulo="Compras" valor={brl(total_compras)} sub={`${compras.length} notas`} color="var(--accent2)"
            warn={compras_sem_nf > 0 ? `${brl(compras_sem_nf)} s/ NF` : undefined} />
          <Arrow />
          <CruzCol titulo="NF Vendas" valor={brl(faturamento_nf)}
            sub={`${notasVenda.length} vendas${notasRemessa.length > 0 ? ` · ${notasRemessa.length} remessas excl.` : ''}`}
            color="var(--green)"
            warn={notasRemessa.length > 0 ? `${brl(total_remessas)} excluídos` : undefined} />
          <Arrow />
          <CruzCol titulo="Banco" valor={brl(entradas_banco)} sub={`${banco.filter(b => b.tipo === 'entrada').length} entradas`}
            color="var(--gold)" warn={divergencia_banco_nf > 0 ? `+${brl(divergencia_banco_nf)}` : undefined} />
          <Arrow />
          <CruzCol titulo="Despesas" valor={brl(total_despesas)} sub={`${despesas.length} lançamentos`} color="var(--red)"
            warn={despesas_sem_doc > 0 ? `${brl(despesas_sem_doc)} s/ doc` : undefined} />
        </div>
      </Card>

      {/* Saúde Financeira */}
      <div style={{ marginBottom: 20 }}>
        <Card>
          <CardTitle>Saúde Financeira do Mês</CardTitle>

          {!usando_sim && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-orange-500/10 border border-orange-500/20 px-3 py-2 text-xs text-orange-300">
              <span>Informe o <strong>estoque inicial e final</strong> no simulador para calcular CMV, Lucro Bruto e Resultado.</span>
            </div>
          )}

          <div key="fat" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted-foreground)' }}>Receita Bruta (NF)</span>
            <span style={{ fontWeight: 700, color: 'var(--green)' }}>{brlC(faturamento_nf)}</span>
          </div>
          <div key="cmv" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted-foreground)' }}>
              {usando_sim ? '(−) CMV (Est.Ini + Compras Líq. − Est.Fin)' : '(−) Compras Líquidas'}
              {devolucoes_entrada > 0 && !usando_sim && (
                <span style={{ fontSize: 10, color: 'var(--red)', marginLeft: 6 }}>
                  (bruto {brl(compras_brutas)} − dev. {brl(devolucoes_entrada)})
                </span>
              )}
            </span>
            <span style={{ fontWeight: 700, color: usando_sim ? undefined : 'var(--muted-foreground)' }}>
              {usando_sim && cmv_simulado !== null ? brlC(cmv_simulado) : <span style={{ fontStyle: 'italic', color: 'var(--muted-foreground)' }}>— informe estoque</span>}
            </span>
          </div>
          <div key="lb" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted-foreground)' }}>(=) Lucro Bruto</span>
            <span style={{ fontWeight: 700, color: 'var(--accent2)' }}>
              {lucro_bruto !== null ? brlC(lucro_bruto) : <span style={{ fontStyle: 'italic', color: 'var(--muted-foreground)' }}>—</span>}
            </span>
          </div>
          <div key="desp" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted-foreground)' }}>(−) Despesas Operacionais</span>
            <span style={{ fontWeight: 700 }}>{brlC(total_despesas)}</span>
          </div>
          <div key="imp" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted-foreground)' }}>{`(−) Impostos (${ehPresumido ? 'Presumido' : ehReal ? 'Lucro Real' : 'Simples'})`}</span>
            <span style={{ fontWeight: 700 }}>{brlC(imposto)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 0', borderTop: '2px solid var(--accent)', marginTop: 4 }}>
            <span style={{ fontWeight: 700 }}>Resultado Líquido Estimado</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: resultado_liq !== null ? (resultado_liq >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--muted-foreground)' }}>
              {resultado_liq !== null ? brlC(resultado_liq) : <span style={{ fontStyle: 'italic', fontSize: 13 }}>— informe estoque</span>}
            </span>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted-foreground)', background: 'var(--surface2)', padding: '10px 12px', borderRadius: 8 }}>
            {faturamento_nf > 0 && margem !== null
              ? <>Margem líquida: <strong style={{ color: 'var(--text)' }}>{margem}%</strong>
                  {parseFloat(margem) < 8 && ' — Abaixo do benchmark do setor (8–12%).'}
                </>
              : faturamento_nf > 0
              ? 'Informe o estoque no simulador acima para calcular a margem líquida.'
              : 'Sem faturamento registrado neste período.'
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
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground)', marginBottom: 8, textAlign: 'center' }}>{titulo}</div>
      <div style={{ fontSize: 17, fontWeight: 700, textAlign: 'center', color, marginBottom: 4 }}>{valor}</div>
      <div style={{ fontSize: 11, color: warn ? 'var(--red)' : 'var(--muted-foreground)', textAlign: 'center', fontWeight: warn ? 700 : 400 }}>{warn || sub}</div>
    </div>
  )
}

function Arrow() {
  return <div style={{ textAlign: 'center', fontSize: 18, color: 'var(--muted-foreground)' }}>→</div>
}
