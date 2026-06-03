'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calcularSimples } from '@/lib/crossref'
import type { Cliente, Compra, Despesa, NotaFiscal, BancoLancamento } from '@/lib/supabase/types'
import { AlertBar, Card, CardTitle, KpiCard, Tag, brl, pct } from '@/components/ui'
import { ehVenda, ehRemessa, ehRetorno, ehDevolucao } from '@/lib/cfop'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void; cliente: Cliente }

export default function VisaoGeral({ clienteId, periodo, refresh, cliente }: Props) {
  const supabase = createClient()
  const [dados, setDados] = useState<{
    notas: NotaFiscal[]; compras: Compra[]; despesas: Despesa[]; banco: BancoLancamento[]
  } | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    async function carregar() {
      setCarregando(true)
      const [{ data: notas }, { data: compras }, { data: despesas }, { data: banco }] = await Promise.all([
        supabase.from('notas_fiscais').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false),
        supabase.from('compras').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false),
        supabase.from('despesas').select('*').eq('cliente_id', clienteId).eq('periodo', periodo),
        supabase.from('banco_lancamentos').select('*').eq('cliente_id', clienteId).eq('periodo', periodo),
      ])
      setDados({
        notas: (notas || []) as NotaFiscal[],
        compras: (compras || []).map(r => ({ ...r, status: r.nf_entrada ? 'ok' : 'sem_nf' })) as Compra[],
        despesas: (despesas || []).map(r => ({ ...r, status: r.documento ? 'ok' : 'sem_doc' })) as Despesa[],
        banco: (banco || []) as BancoLancamento[],
      })
      setCarregando(false)
    }
    carregar()
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
  const total_retornos         = notasRetorno.reduce((s, n) => s + n.valor, 0)

  // Faturamento real = vendas - devoluções - retornos (remessas são neutras)
  const faturamento_vendas     = notasVenda.reduce((s, n) => s + n.valor, 0)
  const faturamento_devolucoes = notasDevolucao.reduce((s, n) => s + n.valor, 0)
  const faturamento_nf         = faturamento_vendas - faturamento_devolucoes - total_retornos

  const entradas_banco = banco.filter(b => b.tipo === 'entrada').reduce((s, b) => s + b.valor, 0)
  const total_compras = compras.reduce((s, c) => s + c.valor, 0)
  const total_despesas = despesas.reduce((s, d) => s + d.valor, 0)

  const compras_sem_nf = compras.filter(c => c.status === 'sem_nf').reduce((s, c) => s + c.valor, 0)
  const despesas_sem_doc = despesas.filter(d => d.status === 'sem_doc').reduce((s, d) => s + d.valor, 0)
  const divergencia_banco_nf = Math.max(0, entradas_banco - faturamento_nf)

  // Simples Nacional estimado
  const acumulado_est = faturamento_nf * 5
  const { imposto } = calcularSimples(acumulado_est, faturamento_nf)

  const lucro_bruto = faturamento_nf - total_compras
  const resultado_liq = lucro_bruto - total_despesas - imposto
  const margem = faturamento_nf > 0 ? (resultado_liq / faturamento_nf * 100).toFixed(1) : '0'

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
        <KpiCard label="Faturamento Real" value={brl(faturamento_nf)}
          delta={
            total_remessas > 0 || total_retornos > 0
              ? `−${brl(total_retornos)} retornos · remessas excl.`
              : `${notasVenda.length} NFs de venda`
          }
          deltaType={total_remessas > 0 || total_retornos > 0 ? 'warn' : undefined}
          topColor="var(--accent)" />
        <KpiCard label="Entradas no Banco" value={brl(entradas_banco)}
          delta={divergencia_banco_nf > 0 ? `⚠ ${brl(divergencia_banco_nf)} sem NF` : '✓ Conciliado'}
          deltaType={divergencia_banco_nf > 0 ? 'warn' : 'up'} topColor="var(--green)" />
        <KpiCard label="Compras (Mercadoria)" value={brl(total_compras)}
          delta={compras_sem_nf > 0 ? `▼ ${brl(compras_sem_nf)} sem nota` : '✓ Todas com NF'}
          deltaType={compras_sem_nf > 0 ? 'down' : 'up'} topColor="var(--red)" />
        <KpiCard label="Imposto Estimado" value={brl(imposto)}
          delta={faturamento_nf > 0 ? `${pct(imposto / faturamento_nf * 100)} do faturamento` : '—'}
          topColor="var(--gold)" />
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
          {[
            { label: 'Receita Bruta (NF)', valor: faturamento_nf, color: 'var(--green)' },
            { label: '(−) CMV — Custo Mercadoria', valor: -total_compras },
            { label: '(=) Lucro Bruto', valor: lucro_bruto, color: 'var(--accent2)' },
            { label: '(−) Despesas Operacionais', valor: -total_despesas },
            { label: '(−) Impostos Simples', valor: -imposto },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ color: 'var(--muted)' }}>{r.label}</span>
              <span style={{ fontWeight: 700, color: r.color }}>{brl(Math.abs(r.valor))}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 0', borderTop: '2px solid var(--accent)', marginTop: 4 }}>
            <span style={{ fontWeight: 700 }}>Resultado Líquido Estimado</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: resultado_liq >= 0 ? 'var(--green)' : 'var(--red)' }}>{brl(resultado_liq)}</span>
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', padding: '10px 12px', borderRadius: 8 }}>
            {faturamento_nf > 0
              ? <>📌 Margem líquida: <strong style={{ color: 'var(--text)' }}>{margem}%</strong>
                  {parseFloat(margem) < 8 && ' — Abaixo do benchmark do setor (8–12%). Revisar política de preços ou despesas.'}
                </>
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
