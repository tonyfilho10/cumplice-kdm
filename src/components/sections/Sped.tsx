'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DocumentoSped } from '@/lib/supabase/types'
import {
  Btn, Card, CardTitle, ConfirmDelete, Input, Modal, RowActions, Select,
  Table, Td, Toast, Tr, UploadZone, brl, fmtData,
} from '@/components/ui'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

const CLASSIFICACAO_LABEL: Record<string, string> = {
  venda: 'Venda',
  compra: 'Compra',
  devolucao: 'Devolução (saída)',
  devolucao_entrada: 'Devolução (entrada)',
  remessa: 'Remessa',
  retorno_remessa: 'Retorno de remessa',
  entrada_remessa: 'Entrada de remessa',
  industrializacao: 'Industrialização',
  ativo_imobilizado: 'Ativo imobilizado',
  uso_consumo: 'Uso e consumo',
  outros: 'Outros',
}

const CLASSIFICACAO_COR: Record<string, string> = {
  venda: 'text-green-400',
  compra: 'text-blue-400',
  devolucao: 'text-orange-400',
  devolucao_entrada: 'text-orange-400',
  remessa: 'text-purple-400',
  retorno_remessa: 'text-purple-400',
  entrada_remessa: 'text-cyan-400',
  industrializacao: 'text-yellow-400',
  ativo_imobilizado: 'text-indigo-400',
  uso_consumo: 'text-slate-400',
  outros: 'text-muted-foreground',
}

export default function Sped({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [documentos, setDocumentos] = useState<DocumentoSped[]>([])
  const [toast, setToast] = useState('')
  const [importando, setImportando] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtroDataIni, setFiltroDataIni] = useState('')
  const [filtroDataFim, setFiltroDataFim] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroCfop, setFiltroCfop] = useState('')
  const [filtroClassificacao, setFiltroClassificacao] = useState('')
  const [editando, setEditando] = useState<DocumentoSped | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data: rows } = await supabase.from('documentos_sped').select('*')
      .eq('cliente_id', clienteId).eq('periodo', periodo).order('data_emissao', { ascending: false }).limit(50000)
    setDocumentos((rows || []) as DocumentoSped[])
  }, [clienteId, periodo])

  useEffect(() => { carregar() }, [carregar, refresh])

  async function importarSped(files: File[]) {
    if (!files[0]) return
    setImportando(true)
    try {
      const formData = new FormData()
      formData.append('file', files[0])

      const res = await fetch(`/api/clientes/${clienteId}/importar-sped`, { method: 'POST', body: formData })
      const result = await res.json()

      if (result.erro) {
        setToast(`Erro: ${result.erro}`)
      } else if (result.aviso) {
        setToast(result.aviso)
      } else {
        let msg = `${result.empresa} (${result.periodo}) — ${result.inseridos} documento(s) importado(s)`
        if (result.atualizados > 0) msg += ` · ${result.atualizados} atualizado(s)`
        if (result.ignorados > 0) msg += ` · ${result.ignorados} ignorado(s) (sem CFOP)`
        setToast(msg)
        await carregar()
        onRecarregar()
      }
    } catch {
      setToast('Erro ao importar arquivo SPED')
    } finally {
      setImportando(false)
    }
  }

  const entradas = documentos.filter(d => d.tipo === 'entrada')
  const saidas = documentos.filter(d => d.tipo === 'saida')
  const totalEntradas = entradas.reduce((s, d) => s + d.valor_total, 0)
  const totalSaidas = saidas.reduce((s, d) => s + d.valor_total, 0)

  // Valor fiscal dos retornos de industrialização: CFOPs 1902, 2902 (retorno de mercadoria enviada
  // para industrialização) e 2923 (venda à ordem — fecha o ciclo da consignação industrial).
  // Os 15 docs CFOP 5929 têm VL_DOC=0 por serem transferências de crédito ICMS (Convênio 29),
  // não movimentação financeira. CFOPs 2911/2912 (remessa para venda/demonstração) são excluídos
  // por representarem operações distintas do ciclo de industrialização.
  const CFOPS_RETORNO_INDUSTRIALIZACAO = ['1902', '2902', '2923']
  const valorRetornoRemessa = documentos
    .filter(d => CFOPS_RETORNO_INDUSTRIALIZACAO.includes(d.cfop))
    .reduce((s, d) => s + d.valor_total, 0)

  // CF-e SAT (MOD=65) são exibidos em card próprio e excluídos do card Venda
  const cupons = documentos.filter(d => d.modelo === '65')
  const totalCupons = cupons.reduce((s, d) => s + d.valor_total, 0)

  const saldosPorClassificacao = (() => {
    const mapa = new Map<string, { qtd: number; valor: number }>()
    for (const d of documentos) {
      if (d.modelo === '65') continue  // CF-e SAT tratado separadamente
      const atual = mapa.get(d.classificacao) || { qtd: 0, valor: 0 }
      atual.qtd += 1
      atual.valor += d.valor_total
      mapa.set(d.classificacao, atual)
    }
    return [...mapa.entries()].sort((a, b) => b[1].valor - a[1].valor)
  })()

  const visiveis = documentos.filter(d => {
    if (busca.trim()) {
      const b = busca.toLowerCase()
      const bate =
        (d.numero || '').toLowerCase().includes(b) ||
        (d.participante_nome || '').toLowerCase().includes(b) ||
        (d.cfop || '').toLowerCase().includes(b)
      if (!bate) return false
    }
    if (filtroDataIni && d.data_emissao < filtroDataIni) return false
    if (filtroDataFim && d.data_emissao > filtroDataFim) return false
    if (filtroTipo && d.tipo !== filtroTipo) return false
    if (filtroCfop && d.cfop !== filtroCfop) return false
    if (filtroClassificacao && d.classificacao !== filtroClassificacao) return false
    return true
  })

  const cfopsDisponiveis = [...new Set(documentos.map(d => d.cfop))].sort()
  const classificacoesDisponiveis = [...new Set(documentos.map(d => d.classificacao))].sort()

  function limparFiltros() {
    setBusca(''); setFiltroDataIni(''); setFiltroDataFim('')
    setFiltroTipo(''); setFiltroCfop(''); setFiltroClassificacao('')
  }

  async function salvarEdicao() {
    if (!editando) return
    const { error } = await supabase.from('documentos_sped').update({
      data_emissao: editando.data_emissao,
      data_entrada_saida: editando.data_entrada_saida || null,
      tipo: editando.tipo,
      emissao: editando.emissao,
      cod_participante: editando.cod_participante || null,
      participante_nome: editando.participante_nome || null,
      cnpj_participante: editando.cnpj_participante || null,
      modelo: editando.modelo || null,
      serie: editando.serie || null,
      numero: editando.numero,
      chave_nfe: editando.chave_nfe || null,
      valor_total: editando.valor_total,
      cfop: editando.cfop,
      classificacao: editando.classificacao,
      cancelado: editando.cancelado,
    }).eq('id', editando.id)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setEditando(null); await carregar(); onRecarregar(); setToast('Documento SPED atualizado!')
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const { error } = await supabase.from('documentos_sped').delete().eq('id', excluindo)
    if (error) { setToast(`Erro: ${error.message}`); setExcluindo(null); return }
    setExcluindo(null); await carregar(); onRecarregar(); setToast('Documento SPED excluído!')
  }

  return (
    <div>
      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Importar SPED EFD ICMS/IPI</CardTitle>
        <div style={{ marginTop: 14 }}>
          <UploadZone icon="📑" label="Importar SPED EFD ICMS/IPI"
            sub={importando ? 'Processando arquivo...' : 'Arquivo .txt da escrituração fiscal digital — registros C100/C170/C190'}
            onFiles={importarSped} accept=".txt" />
        </div>
      </Card>

      {documentos.length > 0 && (
        <Card style={{ marginBottom: 18 }}>
          <CardTitle sub="Saldos consolidados a partir dos documentos escriturados no SPED">Saldos do Período</CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 12 }}>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entradas</div>
              <div className="text-lg font-bold text-foreground">{brl(totalEntradas)}</div>
              <div className="text-xs text-muted-foreground">{entradas.length} documento(s)</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saídas</div>
              <div className="text-lg font-bold text-foreground">{brl(totalSaidas)}</div>
              <div className="text-xs text-muted-foreground">{saidas.length} documento(s)</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo (Saídas − Entradas)</div>
              <div className="text-lg font-bold text-foreground">{brl(totalSaidas - totalEntradas)}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total de Documentos</div>
              <div className="text-lg font-bold text-foreground">{documentos.length}</div>
            </div>
          </div>

          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {totalCupons > 0 && (
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs font-semibold text-green-400">CF-e SAT (Cupons)</div>
                <div className="text-base font-bold text-foreground mt-1">{brl(totalCupons)}</div>
                <div className="text-[11px] text-muted-foreground">{cupons.length} documento(s)</div>
                <div className="text-[10px] text-muted-foreground mt-1">vendas via PDV (MOD 65)</div>
              </div>
            )}
            {saldosPorClassificacao.filter(([c]) => c !== 'entrada_remessa').map(([classificacao, { qtd, valor }]) => {
              const isRetorno = classificacao === 'retorno_remessa'
              const valorExibido = isRetorno ? valorRetornoRemessa : valor
              return (
                <div key={classificacao} className="rounded-lg border border-border p-3">
                  <div className={`text-xs font-semibold ${CLASSIFICACAO_COR[classificacao] || 'text-muted-foreground'}`}>
                    {CLASSIFICACAO_LABEL[classificacao] || classificacao}
                  </div>
                  <div className="text-base font-bold text-foreground mt-1">{brl(valorExibido)}</div>
                  <div className="text-[11px] text-muted-foreground">{qtd} documento(s)</div>
                  {isRetorno && (
                    <div className="text-[10px] text-muted-foreground mt-1">ref. mercadorias retornadas ao estoque</div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <CardTitle sub={`${documentos.length} documento(s) escriturados no período`}>Documentos do SPED</CardTitle>
        </div>
        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número, participante ou CFOP..."
            className="w-full h-8 rounded-md border border-border bg-secondary text-foreground text-xs pl-8 pr-3 focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
          <input type="date" value={filtroDataIni} onChange={e => setFiltroDataIni(e.target.value)}
            className="h-8 rounded-md border border-border bg-secondary text-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring" />
          <input type="date" value={filtroDataFim} onChange={e => setFiltroDataFim(e.target.value)}
            className="h-8 rounded-md border border-border bg-secondary text-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring" />
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
            className="h-8 rounded-md border border-border bg-secondary text-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer">
            <option value="">Tipo (todos)</option>
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
          </select>
          <select value={filtroCfop} onChange={e => setFiltroCfop(e.target.value)}
            className="h-8 rounded-md border border-border bg-secondary text-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer">
            <option value="">CFOP (todos)</option>
            {cfopsDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filtroClassificacao} onChange={e => setFiltroClassificacao(e.target.value)}
            className="h-8 rounded-md border border-border bg-secondary text-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer">
            <option value="">Classificação (todas)</option>
            {classificacoesDisponiveis.map(c => <option key={c} value={c}>{CLASSIFICACAO_LABEL[c] || c}</option>)}
          </select>
          <button onClick={limparFiltros}
            className="h-8 text-xs text-muted-foreground border border-border rounded-md hover:bg-secondary transition-colors">
            Limpar filtros
          </button>
        </div>
        <Table headers={['Emissão', 'Tipo', 'Participante', 'CFOP', 'Classificação', 'Nº Doc', 'Valor', '']}>
          {visiveis.map(d => (
            <Tr key={d.id}>
              <Td>{fmtData(d.data_emissao)}</Td>
              <Td>
                <span className={d.tipo === 'entrada' ? 'text-blue-400 text-xs font-semibold' : 'text-green-400 text-xs font-semibold'}>
                  {d.tipo === 'entrada' ? '⬇ Entrada' : '⬆ Saída'}
                </span>
              </Td>
              <Td>{d.participante_nome || <span className="text-muted-foreground">—</span>}</Td>
              <Td mono>{d.cfop}</Td>
              <Td>
                <span className={`text-xs font-semibold ${CLASSIFICACAO_COR[d.classificacao] || 'text-muted-foreground'}`}>
                  {CLASSIFICACAO_LABEL[d.classificacao] || d.classificacao}
                </span>
              </Td>
              <Td mono>{d.numero}</Td>
              <Td>{brl(d.valor_total)}</Td>
              <Td><RowActions onEdit={() => setEditando({ ...d })} onDelete={() => setExcluindo(d.id)} /></Td>
            </Tr>
          ))}
        </Table>
        {visiveis.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Nenhum documento SPED importado para este período.
          </div>
        )}
      </Card>

      {editando && (
        <Modal title="Editar Documento SPED" onClose={() => setEditando(null)}>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <Input label="Data de Emissão" type="date" value={editando.data_emissao}
              onChange={e => setEditando({ ...editando, data_emissao: e.target.value })} />
            <Input label="Data Entrada/Saída" type="date" value={editando.data_entrada_saida || ''}
              onChange={e => setEditando({ ...editando, data_entrada_saida: e.target.value || null })} />
            <Select label="Tipo" value={editando.tipo}
              onChange={e => setEditando({ ...editando, tipo: e.target.value as DocumentoSped['tipo'] })}>
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
            </Select>
            <Select label="Emissão" value={editando.emissao}
              onChange={e => setEditando({ ...editando, emissao: e.target.value as DocumentoSped['emissao'] })}>
              <option value="propria">Própria</option>
              <option value="terceiros">Terceiros</option>
            </Select>
            <Input label="Participante" value={editando.participante_nome || ''}
              onChange={e => setEditando({ ...editando, participante_nome: e.target.value || null })} />
            <Input label="CNPJ Participante" value={editando.cnpj_participante || ''}
              onChange={e => setEditando({ ...editando, cnpj_participante: e.target.value || null })} />
            <Input label="Código Participante" value={editando.cod_participante || ''}
              onChange={e => setEditando({ ...editando, cod_participante: e.target.value || null })} />
            <Input label="Modelo" value={editando.modelo || ''}
              onChange={e => setEditando({ ...editando, modelo: e.target.value || null })} />
            <Input label="Série" value={editando.serie || ''}
              onChange={e => setEditando({ ...editando, serie: e.target.value || null })} />
            <Input label="Número" value={editando.numero}
              onChange={e => setEditando({ ...editando, numero: e.target.value })} />
            <Input label="Chave NF-e" value={editando.chave_nfe || ''}
              onChange={e => setEditando({ ...editando, chave_nfe: e.target.value || null })} />
            <Input label="CFOP" value={editando.cfop}
              onChange={e => setEditando({ ...editando, cfop: e.target.value })} />
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Classificação</label>
              <select
                value={editando.classificacao}
                onChange={e => setEditando({ ...editando, classificacao: e.target.value })}
                className="h-9 rounded-md border border-border bg-secondary text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
              >
                {Object.entries(CLASSIFICACAO_LABEL).map(([valor, label]) => (
                  <option key={valor} value={valor}>{label}</option>
                ))}
              </select>
            </div>
            <Input label="Valor Total (R$)" type="number" value={String(editando.valor_total)}
              onChange={e => setEditando({ ...editando, valor_total: parseFloat(e.target.value) || 0 })} />
            <Select label="Cancelado?" value={editando.cancelado ? 'sim' : 'nao'}
              onChange={e => setEditando({ ...editando, cancelado: e.target.value === 'sim' })}>
              <option value="nao">Não</option>
              <option value="sim">Sim</option>
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
