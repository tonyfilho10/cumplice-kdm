'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { NotaFiscal } from '@/lib/supabase/types'
import { checkPeriodoAberto } from '@/lib/periodo-check-client'
import { classificarCFOP } from '@/lib/cfop'
import {
  Badge, Btn, Card, CardTitle, ConfirmDelete, Input, Modal,
  RowActions, Select, Table, Td, Toast, Tr, UploadZone, brl, fmtData,
} from '@/components/ui'
import BuscaLancamentos from '@/components/sections/BuscaLancamentos'
import { parseNFeXML, parseEventoNFe } from '@/lib/parsers/nfe'

type Props = { clienteId: string; periodo: string; refresh: number; onRecarregar: () => void }

const hoje = new Date().toISOString().substring(0, 10)

export default function NotasFiscais({ clienteId, periodo, refresh, onRecarregar }: Props) {
  const supabase = createClient()
  const [notas, setNotas] = useState<NotaFiscal[]>([])
  const [toast, setToast] = useState('')
  const [editando, setEditando] = useState<NotaFiscal | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [relatorioMinimizado, setRelatorioMinimizado] = useState(false)
  const [relatorio, setRelatorio] = useState<{
    importados: string[]
    cancelamentos: string[]
    duplicados: { arquivo: string; numero: string; motivo: string; detalhe: string }[]
    erros: { arquivo: string; erro: string; detalhe?: string }[]
  } | null>(null)

  const [data, setData] = useState(hoje)
  const [numero, setNumero] = useState('')
  const [clienteNF, setClienteNF] = useState('')
  const [valor, setValor] = useState('')
  const [cfop, setCFOP] = useState('5102')
  const [recebimento, setRecebimento] = useState('À Vista')
  const [dataRec, setDataRec] = useState(hoje)

  const carregar = useCallback(async () => {
    const { data: rows } = await supabase.from('notas_fiscais').select('*')
      .eq('cliente_id', clienteId).eq('periodo', periodo).eq('cancelada', false).order('data', { ascending: false })
    setNotas((rows || []) as NotaFiscal[])
  }, [clienteId, periodo])

  useEffect(() => { carregar() }, [carregar, refresh])

  async function adicionar() {
    if (!numero || !valor) return
    const erroP = await checkPeriodoAberto(clienteId, data)
    if (erroP) { setToast(`Erro: ${erroP}`); return }
    setSalvando(true)
    const { error } = await supabase.from('notas_fiscais').insert({
      id: crypto.randomUUID(),
      cliente_id: clienteId, periodo: data.substring(0, 7), data, numero,
      cliente_nf: clienteNF || 'Consumidor Final',
      valor: parseFloat(valor), cfop, recebimento,
      data_recebimento: dataRec, conciliada: false,
    })
    if (error) { setToast(`Erro ao salvar: ${error.message}`); setSalvando(false); return }
    setNumero(''); setValor(''); setClienteNF('')
    await carregar(); onRecarregar(); setToast('NF adicionada!'); setSalvando(false)
  }

  async function salvarEdicao() {
    if (!editando) return
    const { error } = await supabase.from('notas_fiscais').update({
      data: editando.data, numero: editando.numero,
      cliente_nf: editando.cliente_nf, valor: editando.valor,
      cfop: editando.cfop, recebimento: editando.recebimento,
      data_recebimento: editando.data_recebimento,
    }).eq('id', editando.id)
    if (error) { setToast(`Erro ao editar: ${error.message}`); return }
    setEditando(null); await carregar(); onRecarregar(); setToast('NF atualizada!')
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const { error } = await supabase.from('notas_fiscais').delete().eq('id', excluindo)
    if (error) { setToast(`Erro ao excluir: ${error.message}`); setExcluindo(null); return }
    setExcluindo(null); await carregar(); onRecarregar(); setToast('NF excluída!')
  }

  async function importarXML(files: File[]) {
    setImportando(true)

    const importados: string[] = []
    const erros: { arquivo: string; erro: string; detalhe?: string }[] = []
    const duplicados: { arquivo: string; numero: string; motivo: string; detalhe: string }[] = []
    const cancelamentos: string[] = []

    try {
      // Processa em lotes de 5 para não sobrecarregar o Supabase
      const LOTE = 5
      for (let i = 0; i < files.length; i += LOTE) {
        const lote = files.slice(i, i + LOTE)

        await Promise.all(lote.map(async (file) => {
          try {
            const conteudo = await file.text()
            const nfe = await parseNFeXML(conteudo)

            if (nfe.erro?.startsWith('Arquivo ignorado:')) return

            // Evento (cancelamento, CCe)
            if (nfe.erro === '__evento__') {
              const evento = parseEventoNFe(conteudo)
              if (!evento) { erros.push({ arquivo: file.name, erro: 'Evento não reconhecido' }); return }
              if (evento.tipo === 'cancelamento' && evento.chave_nfe) {
                const { data: nfExistente } = await supabase
                  .from('notas_fiscais').select('id, numero')
                  .eq('chave_acesso', evento.chave_nfe).eq('cliente_id', clienteId).maybeSingle()
                if (nfExistente) {
                  await supabase.from('notas_fiscais').update({ cancelada: true }).eq('id', nfExistente.id)
                  cancelamentos.push(`NF ${nfExistente.numero} cancelada — ${evento.descricao}`)
                } else {
                  cancelamentos.push(`Cancelamento para chave ${evento.chave_nfe.substring(0, 10)}... (NF não encontrada)`)
                }
              } else if (evento.tipo === 'carta_correcao') {
                cancelamentos.push(`Carta de Correção para ${evento.chave_nfe?.substring(0, 10)}... — ${evento.descricao}`)
              }
              return
            }

            if (nfe.erro) { erros.push({ arquivo: file.name, erro: nfe.erro }); return }

            const periodoNF = nfe.data_emissao?.substring(0, 7) || periodo
            const dadosNF = {
              cliente_id: clienteId,
              periodo: periodoNF,
              data: nfe.data_emissao,
              numero: nfe.numero,
              chave_acesso: nfe.chave_acesso || null,
              cliente_nf: nfe.razao_destinatario || 'Consumidor Final',
              cfop: nfe.cfop,
              valor: nfe.valor_total,
              conciliada: false,
              cancelada: false,
            }

            // Dedup por chave de acesso (NF-e)
            if (nfe.chave_acesso) {
              const { data: existente } = await supabase
                .from('notas_fiscais').select('id')
                .eq('chave_acesso', nfe.chave_acesso).eq('cliente_id', clienteId).maybeSingle()
              if (existente) {
                await supabase.from('notas_fiscais').update(dadosNF).eq('id', existente.id)
                duplicados.push({
                  arquivo: file.name, numero: nfe.numero ?? '?', motivo: 'Atualizada (já existia)',
                  detalhe: `NF ${nfe.numero} | ${periodoNF} | R$ ${nfe.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                })
                return
              }
            } else if (nfe.numero) {
              // Dedup por número + período (NFS-e)
              let q = supabase.from('notas_fiscais').select('id, valor')
                .eq('cliente_id', clienteId).eq('numero', nfe.numero)
                .eq('periodo', periodoNF).is('chave_acesso', null)
              if (nfe.razao_destinatario) q = q.eq('cliente_nf', nfe.razao_destinatario)
              const { data: existente } = await q.maybeSingle()
              if (existente) {
                await supabase.from('notas_fiscais').update(dadosNF).eq('id', existente.id)
                duplicados.push({
                  arquivo: file.name, numero: nfe.numero, motivo: 'Atualizada (já existia)',
                  detalhe: `NF ${nfe.numero} | ${periodoNF} | anterior R$ ${Number(existente.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                })
                return
              }
            }

            // Insere nova NF
            const { error: insertError } = await supabase.from('notas_fiscais').insert({
              id: crypto.randomUUID(), ...dadosNF,
            })
            if (insertError) { erros.push({ arquivo: file.name, erro: insertError.message }); return }

            const label = nfe.formato === 'nfse' ? 'NFS-e' : 'NF-e'
            const aviso = periodoNF !== periodo ? ` → alocado em ${periodoNF}` : ''
            importados.push(`${label} ${nfe.numero}${aviso} — R$ ${nfe.valor_total.toLocaleString('pt-BR')}`)

          } catch (fileErr) {
            erros.push({ arquivo: file.name, erro: fileErr instanceof Error ? fileErr.message : 'Erro inesperado' })
          }
        }))
      }

      await carregar()
      onRecarregar()

      if (duplicados.length > 0 || erros.length > 0 || cancelamentos.length > 0) {
        setRelatorio({ importados, cancelamentos, duplicados, erros })
      }

      const n = importados.length, d = duplicados.length, e = erros.length, c = cancelamentos.length
      const fora = importados.filter(s => s.includes('→ alocado'))
      let msg = `${n} NF(s) importada(s)`
      if (fora.length > 0) msg += ` · ${fora.length} alocada(s) no período correto`
      if (c > 0) msg += ` · ${c} cancelamento(s)`
      if (d > 0) msg += ` · ${d} duplicada(s)`
      if (e > 0) msg += ` · ${e} erro(s)`
      setToast(n > 0 || c > 0 ? msg : d > 0 ? `Todas já importadas (${d} duplicadas)` : `Erro: ${erros[0]?.erro || 'Nenhuma NF importada'}`)

    } finally {
      setImportando(false)
    }
  }

  // ── Relatório de notas faltantes (gaps na sequência numérica) ─────────────
  const [mostrarFaltantes, setMostrarFaltantes] = useState(false)
  const notasFaltantes = (() => {
    const nums = notas
      .map(n => parseInt(n.numero || '0', 10))
      .filter(n => n > 0)
      .sort((a, b) => a - b)
    if (nums.length < 2) return []
    const faltantes: number[] = []
    for (let i = 0; i < nums.length - 1; i++) {
      for (let j = nums[i] + 1; j < nums[i + 1]; j++) {
        faltantes.push(j)
        if (faltantes.length > 500) return faltantes // segurança
      }
    }
    return faltantes
  })()

  const [busca, setBusca] = useState('')
  const total = notas.reduce((s, n) => s + n.valor, 0)
  const visiveis = busca.trim()
    ? notas.filter(n =>
        (n.numero || '').toLowerCase().includes(busca.toLowerCase()) ||
        (n.cliente_nf || '').toLowerCase().includes(busca.toLowerCase())
      )
    : notas

  return (
    <div>
      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Registrar NF Emitida</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <Input label="Data de Emissão" type="date" value={data} onChange={e => setData(e.target.value)} />
          <Input label="Nº da NF" value={numero} onChange={e => setNumero(e.target.value)} placeholder="000001" />
          <Input label="Cliente / Consumidor" value={clienteNF} onChange={e => setClienteNF(e.target.value)} placeholder="Nome ou Consumidor Final" />
          <Input label="Valor Total (R$)" type="number" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" />
          <Select label="CFOP" value={cfop} onChange={e => setCFOP(e.target.value)}>
            <option value="5102">5102 – Venda de mercadoria</option>
            <option value="5101">5101 – Venda de produto industrializado</option>
            <option value="5405">5405 – Venda c/ substituição tributária</option>
            <option value="5403">5403 – Venda de mercadoria c/ ICMS-ST</option>
            <option value="5933">5933 – Prestação de serviço (ISSQN)</option>
            <option value="6101">6101 – Venda interestadual de produto</option>
            <option value="6102">6102 – Venda interestadual de mercadoria</option>
            <option value="6933">6933 – Serviço interestadual (ISSQN)</option>
            <option value="5201">5201 – Devolução de compra</option>
            <option value="5949">5949 – Outra saída</option>
          </Select>
          <Select label="Forma de Recebimento" value={recebimento} onChange={e => setRecebimento(e.target.value)}>
            <option>À Vista</option><option>Cartão Débito</option><option>Cartão Crédito</option>
            <option>Pix</option><option>Boleto</option>
          </Select>
          <Input label="Recebimento Previsto" type="date" value={dataRec} onChange={e => setDataRec(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Btn onClick={adicionar} disabled={salvando || !numero || !valor} style={{ width: '100%', justifyContent: 'center' }}>
              + Adicionar
            </Btn>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <UploadZone icon="🧾" label="Importar XMLs de NF-e Emitidas"
            sub={importando ? 'Importando em lotes...' : 'Exportado do SEFAZ ou ERP — XML (múltiplos)'}
            onFiles={importarXML} accept=".xml" />
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <CardTitle sub={`Total: ${brl(total)} · ${notas.length} notas`}>NFs Emitidas no Mês</CardTitle>
          {notasFaltantes.length > 0 && (
            <Btn variant="ghost" onClick={() => setMostrarFaltantes(m => !m)}
              style={{ fontSize: 11, gap: 6, color: 'var(--color-yellow-400)' }}>
              ⚠️ {notasFaltantes.length} NF(s) faltando
              <span style={{ fontSize: 10 }}>{mostrarFaltantes ? '▲' : '▼'}</span>
            </Btn>
          )}
        </div>

        {mostrarFaltantes && notasFaltantes.length > 0 && (
          <div style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 8,
            background: 'var(--color-secondary)', border: '1px solid var(--color-yellow-400)',
          }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-yellow-400)', marginBottom: 8 }}>
              ⚠️ Números ausentes na sequência do período (NFs não importadas ou canceladas):
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {/* Agrupa em faixas consecutivas */}
              {(() => {
                const ranges: string[] = []
                let start = notasFaltantes[0], prev = notasFaltantes[0]
                for (let i = 1; i <= notasFaltantes.length; i++) {
                  const cur = notasFaltantes[i]
                  if (cur !== prev + 1) {
                    ranges.push(start === prev ? `${start}` : `${start}–${prev}`)
                    start = cur; prev = cur
                  } else { prev = cur }
                }
                return ranges.map((r, i) => (
                  <span key={i} style={{
                    fontSize: 11, fontFamily: 'monospace', padding: '2px 8px',
                    background: 'var(--color-card)', borderRadius: 4,
                    border: '1px solid var(--color-border)', color: 'var(--color-yellow-400)',
                  }}>{r}</span>
                ))
              })()}
            </div>
            {notasFaltantes.length >= 500 && (
              <p style={{ fontSize: 10, color: 'var(--color-muted-foreground)', marginTop: 6 }}>
                Exibindo os primeiros 500 números faltantes.
              </p>
            )}
          </div>
        )}

        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número da NF ou cliente..."
            className="w-full h-8 rounded-md border border-border bg-secondary text-foreground text-xs pl-8 pr-3 focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <Table headers={['Data', 'Nº NF', 'Cliente', 'CFOP / Tipo', 'Valor', 'Recebimento', 'Banco', '']}>
          {visiveis.map(n => {
            const cfopInfo = classificarCFOP(n.cfop)
            return (
            <Tr key={n.id}>
              <Td>{fmtData(n.data)}</Td>
              <Td mono>{n.numero}</Td>
              <Td>{n.cliente_nf}</Td>
              <Td>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs">{n.cfop}</span>
                  <span className={`text-[10px] font-semibold ${cfopInfo.cor}`}>{cfopInfo.badge}</span>
                </div>
              </Td>
              <Td>
                <span className={cfopInfo.tipo === 'remessa' || cfopInfo.tipo === 'retorno_remessa' ? 'text-muted-foreground line-through' : ''}>
                  {brl(n.valor)}
                </span>
                {cfopInfo.tipo === 'remessa' && (
                  <span className="text-[10px] text-yellow-400 block">excluída</span>
                )}
                {cfopInfo.tipo === 'retorno_remessa' && (
                  <span className="text-[10px] text-orange-400 block">−deduz fat.</span>
                )}
                {cfopInfo.tipo === 'devolucao' && (
                  <span className="text-[10px] text-orange-400 block">−deduz fat.</span>
                )}
              </Td>
              <Td>{n.recebimento}</Td>
              <Td><Badge variant={n.conciliada ? 'ok' : 'warn'}>{n.conciliada ? '✓ Conciliado' : 'Pendente'}</Badge></Td>
              <Td><RowActions onEdit={() => setEditando({ ...n })} onDelete={() => setExcluindo(n.id)} /></Td>
            </Tr>
            )
          })}
        </Table>
        {visiveis.length === 0 && (
          <p className="text-center py-8 text-muted-foreground text-sm">
            {busca ? `Nenhuma NF encontrada para "${busca}"` : 'Nenhuma NF registrada'}
          </p>
        )}
      </Card>

      {/* Busca e gestão de lançamentos — integrada na aba */}
      <div className="mt-5">
        <BuscaLancamentos clienteId={clienteId} periodo={periodo} refresh={refresh} onRecarregar={onRecarregar} />
      </div>

      {editando && (
        <Modal title="Editar Nota Fiscal" onClose={() => setEditando(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Input label="Data" type="date" value={editando.data} onChange={e => setEditando({ ...editando, data: e.target.value })} />
            <Input label="Nº da NF" value={editando.numero} onChange={e => setEditando({ ...editando, numero: e.target.value })} />
            <Input label="Cliente" value={editando.cliente_nf || ''} onChange={e => setEditando({ ...editando, cliente_nf: e.target.value })} />
            <Input label="Valor (R$)" type="number" value={String(editando.valor)} onChange={e => setEditando({ ...editando, valor: parseFloat(e.target.value) || 0 })} />
            <Select label="CFOP" value={editando.cfop || ''} onChange={e => setEditando({ ...editando, cfop: e.target.value })}>
              <option value="5102">5102 – Venda de mercadoria</option>
              <option value="5101">5101 – Venda de produto industrializado</option>
              <option value="5405">5405 – Venda c/ substituição tributária</option>
              <option value="5403">5403 – Venda de mercadoria c/ ICMS-ST</option>
              <option value="5933">5933 – Prestação de serviço (ISSQN)</option>
              <option value="6101">6101 – Venda interestadual de produto</option>
              <option value="6102">6102 – Venda interestadual de mercadoria</option>
              <option value="6933">6933 – Serviço interestadual (ISSQN)</option>
              <option value="5201">5201 – Devolução de compra</option>
              <option value="5949">5949 – Outra saída</option>
            </Select>
            <Select label="Recebimento" value={editando.recebimento || ''} onChange={e => setEditando({ ...editando, recebimento: e.target.value })}>
              <option>À Vista</option><option>Cartão Débito</option><option>Cartão Crédito</option>
              <option>Pix</option><option>Boleto</option>
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
            <Btn variant="ghost" onClick={() => setEditando(null)}>Cancelar</Btn>
            <Btn onClick={salvarEdicao}>Salvar</Btn>
          </div>
        </Modal>
      )}

      {excluindo && (
        <ConfirmDelete msg="Excluir esta nota fiscal?" onConfirm={confirmarExclusao} onCancel={() => setExcluindo(null)} />
      )}

      {/* ── Relatório de importação — painel flutuante minimizável ───────── */}
      {relatorio && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          width: relatorioMinimizado ? 'auto' : 380,
          background: 'var(--color-card)', border: '1px solid var(--color-border)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}>
          {/* Cabeçalho sempre visível */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', background: 'var(--color-secondary)',
            cursor: 'pointer', userSelect: 'none',
          }} onClick={() => setRelatorioMinimizado(m => !m)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
              📋 Relatório de Importação
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-muted-foreground)' }}>
                {[
                  relatorio.importados.length > 0 && `${relatorio.importados.length} ok`,
                  relatorio.cancelamentos.length > 0 && `${relatorio.cancelamentos.length} cancel.`,
                  relatorio.duplicados.length > 0 && `${relatorio.duplicados.length} atualizadas`,
                  relatorio.erros.length > 0 && `${relatorio.erros.length} erros`,
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={e => { e.stopPropagation(); setRelatorioMinimizado(m => !m) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)', fontSize: 14, padding: '0 2px' }}
                title={relatorioMinimizado ? 'Expandir' : 'Minimizar'}
              >
                {relatorioMinimizado ? '▲' : '▼'}
              </button>
              <button
                onClick={e => { e.stopPropagation(); setRelatorio(null); setRelatorioMinimizado(false) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground)', fontSize: 14, padding: '0 2px' }}
                title="Fechar"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Conteúdo expandido */}
          {!relatorioMinimizado && (
            <div style={{ maxHeight: 360, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

              {relatorio.importados.length > 0 && (
                <p style={{ fontSize: 11, color: 'var(--color-green-400)', margin: 0 }}>
                  ✅ {relatorio.importados.length} NF(s) importada(s) com sucesso
                </p>
              )}

              {relatorio.cancelamentos.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-blue-400)', marginBottom: 6 }}>
                    🚫 {relatorio.cancelamentos.length} cancelamento(s)
                  </p>
                  {relatorio.cancelamentos.map((c, i) => (
                    <div key={i} style={{ fontSize: 11, padding: '6px 10px', borderLeft: '3px solid var(--color-blue-400)', background: 'var(--color-secondary)', borderRadius: 4, marginBottom: 4 }}>{c}</div>
                  ))}
                </div>
              )}

              {relatorio.duplicados.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-yellow-400)', marginBottom: 6 }}>
                    ♻️ {relatorio.duplicados.length} atualizada(s)
                  </p>
                  {relatorio.duplicados.map((d, i) => (
                    <div key={i} style={{ fontSize: 11, padding: '6px 10px', borderLeft: '3px solid var(--color-yellow-400)', background: 'var(--color-secondary)', borderRadius: 4, marginBottom: 4 }}>
                      <div style={{ fontWeight: 600 }}>NF {d.numero} — {d.motivo}</div>
                      <div style={{ color: 'var(--color-muted-foreground)', marginTop: 2 }}>{d.detalhe}</div>
                    </div>
                  ))}
                </div>
              )}

              {relatorio.erros.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-red-400)', marginBottom: 6 }}>
                    ❌ {relatorio.erros.length} erro(s)
                  </p>
                  {relatorio.erros.map((e, i) => (
                    <div key={i} style={{ fontSize: 11, padding: '6px 10px', borderLeft: '3px solid var(--color-red-400)', background: 'var(--color-secondary)', borderRadius: 4, marginBottom: 4 }}>
                      <div style={{ fontWeight: 600 }}>{e.arquivo}</div>
                      <div style={{ color: 'var(--color-red-400)', marginTop: 2 }}>{e.erro}</div>
                      {e.detalhe && <div style={{ color: 'var(--color-muted-foreground)', marginTop: 2 }}>{e.detalhe}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {toast && <Toast msg={toast} onHide={() => setToast('')} />}
    </div>
  )
}
