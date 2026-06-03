'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cruzarDados } from '@/lib/crossref'
import type { BancoLancamento, Compra, Despesa, NotaFiscal } from '@/lib/supabase/types'
import { AlertBar, Badge, Btn, Card, CardTitle, KpiCard, Table, Td, Toast, Tr, brl, fmtData, } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { GitMerge } from 'lucide-react'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

export default function Cruzamento({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [resultado, setResultado] = useState<ReturnType<typeof cruzarDados> | null>(null)
  const [toast, setToast] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [conciliando, setConciliando] = useState(false)

  async function rodarConciliacao() {
    setConciliando(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}/conciliar?periodo=${periodo}`, { method: 'POST' })
      const result = await res.json()
      if (result.ok) {
        setToast(`✅ ${result.conciliados} conciliado(s) · ${result.a_conciliar} a conciliar (${result.pct_conciliado}%)`)
        await carregar()
        onRecarregar()
      } else {
        setToast(`Erro: ${result.erro}`)
      }
    } catch { setToast('Erro ao conciliar') }
    setConciliando(false)
  }

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [{ data: notas }, { data: compras }, { data: despesas }, { data: banco }, { data: thresh }] = await Promise.all([
      supabase.from('notas_fiscais').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false),
      supabase.from('compras').select('*').eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false),
      supabase.from('despesas').select('*').eq('cliente_id', clienteId).eq('periodo', periodo),
      supabase.from('banco_lancamentos').select('*').eq('cliente_id', clienteId).eq('periodo', periodo),
      supabase.from('thresholds').select('*').eq('cliente_id', clienteId).maybeSingle(),
    ])

    const r = cruzarDados(
      clienteId, periodo,
      (banco || []) as BancoLancamento[],
      (notas || []) as NotaFiscal[],
      (compras || []).map(c => ({ ...c, status: c.nf_entrada ? 'ok' : 'sem_nf' })) as Compra[],
      (despesas || []).map(d => ({ ...d, status: d.documento ? 'ok' : 'sem_doc' })) as Despesa[],
      thresh || undefined
    )
    setResultado(r)
    setCarregando(false)
  }, [clienteId, periodo])

  useEffect(() => { carregar() }, [carregar, refresh])

  if (carregando || !resultado) {
    return <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Processando cruzamento...</div>
  }

  const { divergencias, estatisticas } = resultado
  const recNaoDeclarada = divergencias.filter(d => d.tipo === 'receita_nao_declarada' && d.severidade === 'alto')
  const comprasSemNF = divergencias.filter(d => d.tipo === 'compra_sem_nf')
  const despSemDoc = divergencias.filter(d => d.tipo === 'despesa_sem_comprovante')
  const totalDiverg = divergencias.filter(d => !d.resolvida).length

  return (
    <div>
      {/* Botão de conciliação manual */}
      <div className="flex justify-end mb-4">
        <Button onClick={rodarConciliacao} disabled={conciliando} size="sm" className="gap-2">
          <GitMerge className={`h-3.5 w-3.5 ${conciliando ? 'animate-spin' : ''}`} />
          {conciliando ? 'Conciliando...' : 'Conciliar Agora'}
        </Button>
      </div>

      <AlertBar variant="warn">
        <span style={{ fontSize: 18 }}>🔍</span>
        <div>
          Cruzamento automático identificou{' '}
          <strong>{totalDiverg} divergência{totalDiverg !== 1 ? 's' : ''}</strong>.
          {totalDiverg > 0 ? ' Revise cada item e oriente o cliente.' : ' Tudo conciliado!'}
        </div>
      </AlertBar>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        <KpiCard label="Entradas s/ NF" value={brl(estatisticas.valor_receita_nao_declarada)}
          delta="Receita não declarada" deltaType="down" topColor="var(--red)" />
        <KpiCard label="Compras s/ NF Entrada" value={brl(estatisticas.valor_compras_sem_nf)}
          delta="Crédito fiscal perdido" deltaType="warn" topColor="var(--orange)" />
        <KpiCard label="Despesas s/ Comprovante" value={brl(estatisticas.valor_despesas_sem_doc)}
          delta="Não dedutível" topColor="var(--yellow)" />
        <KpiCard label="NF × Banco Conciliado" value={`${estatisticas.pct_conciliado}%`}
          delta={`▲ ${estatisticas.conciliados} lançamentos OK`} deltaType="up" topColor="var(--green)" />
      </div>

      {/* Entradas sem NF */}
      {recNaoDeclarada.length > 0 && (
        <Card style={{ marginBottom: 18 }}>
          <CardTitle sub={<span style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>RISCO ALTO</span>}>
            🚨 Entradas Bancárias sem NF Emitida
          </CardTitle>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Foram identificadas entradas na conta da empresa que não possuem nota fiscal de venda correspondente. Possível omissão de receita.
          </p>
          <Table headers={['Descrição', 'Valor', 'Severidade', 'Ação']}>
            {recNaoDeclarada.map(d => (
              <Tr key={d.banco_lancamento_id || d.descricao}>
                <Td>{d.descricao}</Td>
                <Td><span style={{ color: 'var(--red)', fontWeight: 700 }}>{brl(d.valor || 0)}</span></Td>
                <Td><Badge variant={d.severidade === 'alto' ? 'err' : 'warn'}>{d.severidade.toUpperCase()}</Badge></Td>
                <Td>
                  <Btn variant="ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setToast('Orientação registrada')}>
                    Orientar
                  </Btn>
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}

      {/* Compras sem NF */}
      {comprasSemNF.length > 0 && (
        <Card style={{ marginBottom: 18 }}>
          <CardTitle sub={<span style={{ background: 'rgba(249,115,22,0.15)', color: '#fdba74', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>ATENÇÃO</span>}>
            ⚠️ Compras sem Nota Fiscal de Entrada
          </CardTitle>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Compras sem nota de entrada registrada. Empresa perde crédito fiscal e fica exposta a autuação.
          </p>
          <Table headers={['Descrição', 'Valor', 'Severidade', 'Ação']}>
            {comprasSemNF.map(d => (
              <Tr key={d.compra_id || d.descricao}>
                <Td>{d.descricao}</Td>
                <Td><span style={{ color: 'var(--orange)', fontWeight: 700 }}>{brl(d.valor || 0)}</span></Td>
                <Td><Badge variant="warn">{d.severidade.toUpperCase()}</Badge></Td>
                <Td>
                  <Btn variant="ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setToast('Alerta enviado ao cliente')}>
                    Alertar
                  </Btn>
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}

      {/* Despesas sem doc */}
      {despSemDoc.length > 0 && (
        <Card>
          <CardTitle sub={<span style={{ background: 'rgba(234,179,8,0.15)', color: '#fde047', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>MONITORAR</span>}>
            💳 Despesas sem Comprovante Fiscal
          </CardTitle>
          <Table headers={['Descrição', 'Valor', 'Impacto']}>
            {despSemDoc.map(d => (
              <Tr key={d.despesa_id || d.descricao}>
                <Td>{d.descricao}</Td>
                <Td>{brl(d.valor || 0)}</Td>
                <Td><span style={{ color: 'var(--yellow)' }}>Não dedutível</span></Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}

      {totalDiverg === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--green)' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Nenhuma divergência encontrada!</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Todos os dados estão conciliados.</div>
        </div>
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}
