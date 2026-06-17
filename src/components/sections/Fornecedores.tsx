'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ContaPagar, BancoLancamento, FornecedorCadastro } from '@/lib/supabase/types'
import { Card, CardTitle, Modal, Toast, brl, fmtData } from '@/components/ui'
import { Search, CheckCircle2, AlertCircle, Clock, Link2, Users, GitMerge, Upload, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  clienteId: string; periodo: string; refresh: number; onRecarregar: () => void
  onNavegar?: (secao: string, highlightId?: string, periodo?: string) => void
}

type ContaComMatch = ContaPagar & { matchesBanco?: BancoLancamento[] }
type View = 'contas' | 'cadastro' | 'importar'

type ImportStatus = { loading: boolean; msg: string; ok: boolean | null }

const SITUACAO_CORES: Record<string, string> = {
  Aberta:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  Pago:    'bg-green-500/15 text-green-400 border-green-500/30',
  Parcial: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
}

function normalizar(s: string) {
  return (s ?? '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim()
}

function nomeSimilar(nomeFornecedor: string, descricaoBanco: string): boolean {
  const nf = normalizar(nomeFornecedor)
  const db = normalizar(descricaoBanco)
  const palavras = nf.split(' ').filter(p => p.length > 3)
  return palavras.some(p => db.includes(p))
}

export default function Fornecedores({ clienteId, periodo, refresh, onRecarregar, onNavegar }: Props) {
  const supabase = createClient()
  const [view, setView] = useState<View>('contas')
  const [contas, setContas] = useState<ContaComMatch[]>([])
  const [fornecedores, setFornecedores] = useState<FornecedorCadastro[]>([])
  const [saidasSemNf, setSaidasSemNf] = useState<BancoLancamento[]>([])
  const [toast, setToast] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroSituacao, setFiltroSituacao] = useState('Aberta')
  const [dando_baixa, setDandoBaixa] = useState<ContaComMatch | null>(null)
  const [lancamentoSelecionado, setLancamentoSelecionado] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [buscaFornecedor, setBuscaFornecedor] = useState('')
  const [cruzando, setCruzando] = useState(false)
  const [baixandoMassa, setBaixandoMassa] = useState(false)
  const [importCadastro, setImportCadastro] = useState<ImportStatus>({ loading: false, msg: '', ok: null })
  const [importContas, setImportContas]     = useState<ImportStatus>({ loading: false, msg: '', ok: null })
  const [substituirContas, setSubstituirContas] = useState(false)

  const carregar = useCallback(async () => {
    const [{ data: contasData }, { data: fornData }, { data: saidasData }] = await Promise.all([
      supabase.from('contas_pagar').select('*').eq('cliente_id', clienteId).order('vencimento', { ascending: true }),
      supabase.from('fornecedores_cadastro').select('*').eq('cliente_id', clienteId).order('nome'),
      supabase.from('banco_lancamentos').select('*').eq('cliente_id', clienteId)
        .eq('tipo', 'saida').in('status', ['sem_nf', 'pendente']).is('nota_fiscal_id', null).order('data', { ascending: false }),
    ])

    const saidas = (saidasData ?? []) as BancoLancamento[]

    const contasComMatch: ContaComMatch[] = (contasData ?? []).map((c: ContaPagar) => {
      if (c.situacao === 'Pago') return { ...c, matchesBanco: [] }
      const venc = c.vencimento ? new Date(c.vencimento) : null
      const matches = saidas.filter(s => {
        const diffValor = c.saldo > 0 ? Math.abs(s.valor - c.saldo) / c.saldo : 1
        if (diffValor > 0.02) return false
        if (venc) {
          const ds = new Date(s.data)
          const diffDias = Math.abs((ds.getTime() - venc.getTime()) / 86400000)
          if (diffDias > 180) return false
        }
        return nomeSimilar(c.fornecedor_nome, s.descricao) || diffValor < 0.001
      })
      return { ...c, matchesBanco: matches }
    })

    setContas(contasComMatch)
    setFornecedores(fornData ?? [])
    setSaidasSemNf(saidas)
  }, [clienteId, supabase])

  useEffect(() => { carregar() }, [carregar, refresh])

  async function darBaixa() {
    if (!dando_baixa || !lancamentoSelecionado) return
    setSalvando(true)
    try {
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('contas_pagar').update({
          situacao: 'Pago',
          valor_pago: dando_baixa.valor_parcela,
          banco_lancamento_id: lancamentoSelecionado,
        }).eq('id', dando_baixa.id),
        supabase.from('banco_lancamentos').update({ status: 'ok', categoria: 'Fornecedor' }).eq('id', lancamentoSelecionado),
      ])
      if (e1 || e2) throw new Error(e1?.message ?? e2?.message)
      setToast('Baixa registrada com sucesso!')
      setDandoBaixa(null)
      setLancamentoSelecionado('')
      await carregar()
      onRecarregar()
    } catch (err: unknown) {
      setToast('Erro: ' + (err instanceof Error ? err.message : 'falha ao salvar'))
    }
    setSalvando(false)
  }

  async function darBaixaEmMassa() {
    const pendentes = contas.filter(c => c.situacao !== 'Pago' && (c.matchesBanco?.length ?? 0) > 0)
    if (pendentes.length === 0) return
    setBaixandoMassa(true)
    let ok = 0
    for (const conta of pendentes) {
      const match = conta.matchesBanco![0]
      try {
        const [{ error: e1 }, { error: e2 }] = await Promise.all([
          supabase.from('contas_pagar').update({ situacao: 'Pago', valor_pago: conta.valor_parcela, banco_lancamento_id: match.id }).eq('id', conta.id),
          supabase.from('banco_lancamentos').update({ status: 'ok', categoria: 'Fornecedor' }).eq('id', match.id),
        ])
        if (!e1 && !e2) ok++
      } catch { /* segue */ }
    }
    setBaixandoMassa(false)
    setToast(`${ok} de ${pendentes.length} baixa(s) registrada(s).`)
    await carregar()
    onRecarregar()
  }

  async function uploadCadastro(file: File) {
    setImportCadastro({ loading: true, msg: 'Analisando PDF com IA...', ok: null })
    const fd = new FormData()
    fd.append('arquivo', file)
    try {
      const res  = await fetch(`/api/clientes/${clienteId}/importar-fornecedores-cadastro`, { method: 'POST', body: fd })
      const text = await res.text()
      let data: Record<string, unknown>
      try { data = JSON.parse(text) } catch { data = { erro: `Servidor retornou resposta inesperada (HTTP ${res.status})` } }
      if (data.erro) {
        setImportCadastro({ loading: false, msg: `Erro: ${data.erro}`, ok: false })
      } else {
        setImportCadastro({ loading: false, msg: `${data.inseridos} inseridos · ${data.atualizados} atualizados (total ${data.total})`, ok: true })
        await carregar()
      }
    } catch (err) {
      setImportCadastro({ loading: false, msg: `Erro: ${err instanceof Error ? err.message : 'falha na requisição'}`, ok: false })
    }
  }

  async function uploadContas(file: File) {
    setImportContas({ loading: true, msg: 'Analisando PDF com IA...', ok: null })
    const fd = new FormData()
    fd.append('arquivo', file)
    fd.append('substituir', String(substituirContas))
    try {
      const res  = await fetch(`/api/clientes/${clienteId}/importar-contas-pagar`, { method: 'POST', body: fd })
      const text = await res.text()
      let data: Record<string, unknown>
      try { data = JSON.parse(text) } catch { data = { erro: `Servidor retornou resposta inesperada (HTTP ${res.status})` } }
      if (data.erro) {
        setImportContas({ loading: false, msg: `Erro: ${data.erro}`, ok: false })
      } else {
        setImportContas({ loading: false, msg: `${data.inseridos} inseridas · ${data.ignorados} já existiam (total ${data.total})`, ok: true })
        await carregar()
      }
    } catch (err) {
      setImportContas({ loading: false, msg: `Erro: ${err instanceof Error ? err.message : 'falha na requisição'}`, ok: false })
    }
  }

  async function cruzarAgora() {
    setCruzando(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}/cruzar-fornecedores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = await res.json()
      if (result.erro) {
        setToast('Erro: ' + result.erro)
      } else {
        setToast(result.mensagem)
        if (result.baixas > 0) { await carregar(); onRecarregar() }
      }
    } catch {
      setToast('Erro ao cruzar fornecedores')
    }
    setCruzando(false)
  }

  const contasFiltradas = useMemo(() => contas.filter(c => {
    if (filtroSituacao && c.situacao !== filtroSituacao) return false
    if (busca) {
      const nb = normalizar(busca)
      return normalizar(c.fornecedor_nome).includes(nb) || c.documento.includes(busca)
    }
    return true
  }), [contas, filtroSituacao, busca])

  const fornecedoresFiltrados = useMemo(() => {
    if (!buscaFornecedor) return fornecedores
    const nb = normalizar(buscaFornecedor)
    return fornecedores.filter(f =>
      normalizar(f.nome).includes(nb) || f.cnpj.includes(buscaFornecedor) || (f.codigo_erp ?? '').includes(buscaFornecedor)
    )
  }, [fornecedores, buscaFornecedor])

  const totalAberto = contas.filter(c => c.situacao === 'Aberta').reduce((s, c) => s + c.saldo, 0)
  const totalPago   = contas.filter(c => c.situacao === 'Pago').reduce((s, c) => s + c.valor_pago, 0)
  const comMatch    = contas.filter(c => c.situacao === 'Aberta' && (c.matchesBanco?.length ?? 0) > 0).length

  const saidasDisponiveis = dando_baixa
    ? saidasSemNf.filter(s => {
        const diffValor = Math.abs(s.valor - dando_baixa.saldo) / (dando_baixa.saldo || 1)
        return diffValor <= 0.10
      })
    : []

  const thCls = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap'
  const tdCls = 'px-4 py-2.5 text-sm text-foreground align-middle'

  return (
    <div className="flex flex-col gap-4">

      {/* ── Barra de ações ── */}
      <div className="flex justify-end gap-2">
        {comMatch > 0 && (
          <button
            onClick={darBaixaEmMassa}
            disabled={baixandoMassa}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            <CheckCircle2 className="h-4 w-4" />
            {baixandoMassa ? 'Baixando...' : `Dar baixa nos matches (${comMatch})`}
          </button>
        )}
        <button
          onClick={cruzarAgora}
          disabled={cruzando}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          <GitMerge className="h-4 w-4" />
          {cruzando ? 'Cruzando...' : 'Cruzar com banco'}
        </button>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total em aberto',   valor: brl(totalAberto),   icon: AlertCircle,  cor: 'text-yellow-400' },
          { label: 'Total pago',        valor: brl(totalPago),     icon: CheckCircle2, cor: 'text-green-400'  },
          { label: 'Contas abertas',    valor: String(contas.filter(c => c.situacao === 'Aberta').length), icon: Clock, cor: 'text-muted-foreground' },
          { label: 'Possíveis matches', valor: String(comMatch),   icon: Link2,        cor: 'text-blue-400'   },
        ].map(k => (
          <Card key={k.label} className="flex items-center gap-3 p-4">
            <k.icon className={`h-5 w-5 shrink-0 ${k.cor}`} />
            <div>
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-lg font-bold text-foreground">{k.valor}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b border-border">
        {([
          ['contas',   'Contas a Pagar'],
          ['cadastro', `Cadastro (${fornecedores.length})`],
          ['importar', 'Importar PDF'],
        ] as [View, string][]).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              view === v ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ══ VIEW: CONTAS A PAGAR ══ */}
      {view === 'contas' && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <CardTitle>Contas a Pagar por Fornecedor</CardTitle>
            <div className="flex items-center gap-2">
              <select
                value={filtroSituacao}
                onChange={e => setFiltroSituacao(e.target.value)}
                className="h-8 rounded-md border border-border bg-secondary text-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Todas</option>
                <option value="Aberta">Em aberto</option>
                <option value="Pago">Pago</option>
                <option value="Parcial">Parcial</option>
              </select>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar fornecedor ou doc..."
                  className="h-8 w-52 pl-7 pr-3 rounded-md border border-border bg-secondary text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/60">
                  <th className={thCls}>Fornecedor</th>
                  <th className={thCls}>Documento</th>
                  <th className={thCls}>Vencimento</th>
                  <th className={cn(thCls, 'text-right')}>Valor</th>
                  <th className={cn(thCls, 'text-right')}>Pago</th>
                  <th className={cn(thCls, 'text-right')}>Saldo</th>
                  <th className={thCls}>Situação</th>
                  <th className={thCls}></th>
                </tr>
              </thead>
              <tbody>
                {contasFiltradas.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-muted-foreground py-10 text-sm">
                      Nenhuma conta encontrada
                    </td>
                  </tr>
                )}
                {contasFiltradas.map(c => {
                  const temMatch = (c.matchesBanco?.length ?? 0) > 0
                  const vencida = c.situacao === 'Aberta' && !!c.vencimento && new Date(c.vencimento) < new Date()
                  const matchLanc = c.matchesBanco?.[0]
                  const bancoId = c.banco_lancamento_id ?? matchLanc?.id

                  async function irParaBanco() {
                    if (!bancoId) return
                    // Se temos o match em memória, usamos o período diretamente
                    if (matchLanc) {
                      onNavegar?.('banco', bancoId, matchLanc.periodo)
                      return
                    }
                    // Para contas já pagas, buscamos o período do lançamento vinculado
                    const { data } = await supabase
                      .from('banco_lancamentos')
                      .select('periodo')
                      .eq('id', bancoId)
                      .single()
                    onNavegar?.('banco', bancoId, data?.periodo ?? undefined)
                  }

                  return (
                    <tr
                      key={c.id}
                      onClick={bancoId ? irParaBanco : undefined}
                      className={cn(
                        'border-b border-border hover:bg-secondary/40 transition-colors',
                        vencida && 'bg-red-500/5',
                        bancoId && 'cursor-pointer',
                      )}
                    >
                      <td className={tdCls}>
                        <p className="font-medium">{c.fornecedor_nome}</p>
                        <p className="text-xs text-muted-foreground">Cód. {c.fornecedor_codigo}</p>
                      </td>
                      <td className={cn(tdCls, 'font-mono text-xs')}>{c.documento}</td>
                      <td className={cn(tdCls, vencida ? 'text-red-400 font-medium' : '')}>
                        {c.vencimento ? fmtData(c.vencimento) : '—'}
                        {vencida && <span className="ml-1 text-[10px] text-red-400">VENCIDA</span>}
                      </td>
                      <td className={cn(tdCls, 'text-right font-mono')}>{brl(c.valor_parcela)}</td>
                      <td className={cn(tdCls, 'text-right font-mono text-green-400')}>{brl(c.valor_pago)}</td>
                      <td className={cn(tdCls, 'text-right font-mono font-bold')}>{brl(c.saldo)}</td>
                      <td className={tdCls}>
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium', SITUACAO_CORES[c.situacao])}>
                          {c.situacao}
                        </span>
                      </td>
                      <td className={tdCls} onClick={e => e.stopPropagation()}>
                        {c.situacao !== 'Pago' && (
                          <button
                            onClick={() => { setDandoBaixa(c); setLancamentoSelecionado(c.matchesBanco?.[0]?.id ?? '') }}
                            className={cn(
                              'flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors',
                              temMatch
                                ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border-blue-500/30'
                                : 'bg-secondary text-muted-foreground hover:text-foreground border-border'
                            )}
                          >
                            <Link2 className="h-3 w-3" />
                            {temMatch ? `Match (${c.matchesBanco!.length})` : 'Dar baixa'}
                          </button>
                        )}
                        {c.situacao === 'Pago' && c.banco_lancamento_id && (
                          <span className="flex items-center gap-1 text-xs text-green-400">
                            <CheckCircle2 className="h-3 w-3" /> Vinculado
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ══ VIEW: CADASTRO ══ */}
      {view === 'cadastro' && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <CardTitle>
              <span className="flex items-center gap-1.5">
                <Users className="h-4 w-4" /> Relação de Fornecedores
              </span>
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={buscaFornecedor}
                onChange={e => setBuscaFornecedor(e.target.value)}
                placeholder="Nome, CNPJ ou código..."
                className="h-8 w-64 pl-7 pr-3 rounded-md border border-border bg-secondary text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/60">
                  <th className={cn(thCls, 'w-16')}>Cód.</th>
                  <th className={thCls}>CNPJ/CPF</th>
                  <th className={thCls}>Razão Social</th>
                </tr>
              </thead>
              <tbody>
                {fornecedoresFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center text-muted-foreground py-10 text-sm">
                      {fornecedores.length === 0
                        ? 'Nenhum fornecedor importado. Execute o seed para carregar os dados.'
                        : 'Nenhum resultado.'}
                    </td>
                  </tr>
                )}
                {fornecedoresFiltrados.map(f => (
                  <tr key={f.id} className="border-b border-border hover:bg-secondary/40 transition-colors">
                    <td className={cn(tdCls, 'font-mono text-xs text-muted-foreground')}>{f.codigo_erp}</td>
                    <td className={cn(tdCls, 'font-mono text-xs')}>
                      {f.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}
                    </td>
                    <td className={cn(tdCls, 'font-medium')}>{f.nome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fornecedoresFiltrados.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2 text-right">
              {fornecedoresFiltrados.length} de {fornecedores.length} fornecedores
            </p>
          )}
        </Card>
      )}

      {/* ══ VIEW: IMPORTAR ══ */}
      {view === 'importar' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Card: Cadastro de Fornecedores */}
          <Card>
            <CardTitle>
              <span className="flex items-center gap-2"><Users className="h-4 w-4" /> Cadastro de Fornecedores</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mb-4">
              PDF exportado do ERP com a relação de fornecedores (código, CNPJ, razão social).
              Registros existentes serão atualizados; novos serão inseridos.
            </p>

            <DropZone
              accept=".pdf"
              loading={importCadastro.loading}
              onFile={uploadCadastro}
              label="Arraste o PDF do cadastro ou clique"
            />

            {importCadastro.msg && (
              <div className={cn(
                'mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm border',
                importCadastro.ok === true  && 'bg-green-500/10 border-green-500/30 text-green-400',
                importCadastro.ok === false && 'bg-red-500/10 border-red-500/30 text-red-400',
                importCadastro.ok === null  && 'bg-secondary border-border text-muted-foreground',
              )}>
                {importCadastro.loading
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                  : importCadastro.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                {importCadastro.msg}
              </div>
            )}
          </Card>

          {/* Card: Contas a Pagar */}
          <Card>
            <CardTitle>
              <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Contas a Pagar</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mb-3">
              PDF com a relação de contas a pagar (fornecedor, documento, vencimento, valores).
            </p>

            <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={substituirContas}
                onChange={e => setSubstituirContas(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-xs text-muted-foreground">
                Substituir contas existentes sem baixa (reimportar)
              </span>
            </label>

            <DropZone
              accept=".pdf"
              loading={importContas.loading}
              onFile={uploadContas}
              label="Arraste o PDF das contas a pagar ou clique"
            />

            {importContas.msg && (
              <div className={cn(
                'mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm border',
                importContas.ok === true  && 'bg-green-500/10 border-green-500/30 text-green-400',
                importContas.ok === false && 'bg-red-500/10 border-red-500/30 text-red-400',
                importContas.ok === null  && 'bg-secondary border-border text-muted-foreground',
              )}>
                {importContas.loading
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                  : importContas.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                {importContas.msg}
              </div>
            )}
          </Card>

        </div>
      )}

      {/* ══ MODAL: DAR BAIXA ══ */}
      {dando_baixa && (
        <Modal title="Dar Baixa — Vincular Pagamento" onClose={() => { setDandoBaixa(null); setLancamentoSelecionado('') }}>
          <div className="flex flex-col gap-4" style={{ minWidth: 480 }}>

            <div className="rounded-lg bg-secondary p-3 border border-border">
              <p className="font-semibold text-foreground">{dando_baixa.fornecedor_nome}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Doc. {dando_baixa.documento} · Venc. {dando_baixa.vencimento ? fmtData(dando_baixa.vencimento) : '—'}
              </p>
              <p className="text-base font-bold text-foreground mt-1">Saldo: {brl(dando_baixa.saldo)}</p>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                Selecione o lançamento bancário de saída
              </p>

              {saidasDisponiveis.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-secondary rounded-lg border border-border">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Nenhuma saída bancária sem NF com valor compatível encontrada.
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                  {saidasDisponiveis.map(s => {
                    const isMatch = (dando_baixa.matchesBanco ?? []).some(m => m.id === s.id)
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                          lancamentoSelecionado === s.id ? 'border-primary bg-primary/10' : 'border-border bg-secondary hover:border-primary/40'
                        )}
                      >
                        <input
                          type="radio"
                          name="lancamento"
                          value={s.id}
                          checked={lancamentoSelecionado === s.id}
                          onChange={() => setLancamentoSelecionado(s.id)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground truncate">{s.descricao}</p>
                            <span className="text-sm font-bold text-foreground shrink-0">{brl(s.valor)}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground">{fmtData(s.data)}</span>
                            {isMatch && (
                              <span className="text-[10px] bg-blue-500/15 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded">
                                Match automático
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => { setDandoBaixa(null); setLancamentoSelecionado('') }}
                className="px-4 py-2 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={darBaixa}
                disabled={!lancamentoSelecionado || salvando}
                className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {salvando ? 'Salvando...' : 'Confirmar Baixa'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}

function DropZone({ accept, loading, onFile, label }: {
  accept: string; loading: boolean; onFile: (f: File) => void; label: string
}) {
  return (
    <label className={cn(
      'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors',
      loading
        ? 'border-border/40 text-muted-foreground/40 cursor-not-allowed'
        : 'border-border hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary',
    )}>
      {loading
        ? <RefreshCw className="h-6 w-6 animate-spin" />
        : <Upload className="h-6 w-6" />}
      <span className="text-sm font-medium text-center">{loading ? 'Processando...' : label}</span>
      <span className="text-xs">{accept.toUpperCase().replace('.', '')}</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={loading}
        onChange={e => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = '' } }}
      />
    </label>
  )
}
