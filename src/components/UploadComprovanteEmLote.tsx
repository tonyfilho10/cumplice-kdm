'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { BancoLancamento } from '@/lib/supabase/types'
import { brl, fmtData } from '@/components/ui'
import { Upload, CheckCircle2, XCircle, Link2, Loader2, FileText, ChevronDown, Sparkles, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { contarPaginas, extrairPagina, juntarPaginas } from '@/lib/pdf-client'
import { matchComprovanteLancamento } from '@/lib/matching/comprovante'

type Props = {
  clienteId: string
  periodo: string
  lancamentos: BancoLancamento[]
  onConcluido?: () => void
}

type ArquivoItem = {
  id: string
  blob: Blob
  ext: string
  nomeExibicao: string
  lancamentoId: string | null   // null = não associado ainda
  semMatchIA: boolean           // true = IA extraiu dados, mas nenhum lançamento correspondeu
  status: 'pendente' | 'enviando' | 'ok' | 'erro'
  erro?: string
  url?: string
  valorExtraido: number | null
  dataExtraida: string | null
  descricaoExtraida: string | null
}

type Processamento = {
  id: string
  nome: string
  total: number
  feitas: number
}

type PaginaResultado = {
  blob: Blob
  valor: number | null
  data: string | null
  descricao: string
  erro?: string
}

export default function UploadComprovanteEmLote({ clienteId, periodo, lancamentos, onConcluido }: Props) {
  const supabase = createClient()
  const [aberto, setAberto] = useState(false)
  const [arquivos, setArquivos] = useState<ArquivoItem[]>([])
  const [processamentos, setProcessamentos] = useState<Processamento[]>([])
  const [enviandoTudo, setEnviandoTudo] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function analisarPagina(file: File): Promise<{ valor: number | null; data: string | null; descricao: string; erro?: string }> {
    try {
      const formData = new FormData()
      formData.append('file', file)

      const resp = await fetch(`/api/clientes/${clienteId}/analisar-pagina-comprovante`, {
        method: 'POST',
        body: formData,
      })

      let data: { erro?: string; valor?: number | null; data?: string | null; descricao?: string }
      try {
        data = await resp.json()
      } catch {
        throw new Error(`Erro inesperado do servidor (HTTP ${resp.status})`)
      }

      if (!resp.ok) throw new Error(data?.erro || 'Falha ao analisar')

      return { valor: data.valor ?? null, data: data.data ?? null, descricao: data.descricao || '' }
    } catch (err) {
      return { valor: null, data: null, descricao: '', erro: err instanceof Error ? err.message : 'Erro ao analisar' }
    }
  }

  async function processarArquivo(file: File) {
    const fileId = crypto.randomUUID()
    const ehPdf = /\.pdf$/i.test(file.name)
    const nomeBase = file.name.replace(/\.(pdf|jpg|jpeg|png|webp)$/i, '')

    let totalPaginas = 1
    if (ehPdf) {
      try {
        totalPaginas = await contarPaginas(file)
      } catch {
        totalPaginas = 1
      }
    }

    setProcessamentos(prev => [...prev, { id: fileId, nome: file.name, total: totalPaginas, feitas: 0 }])
    setAberto(true)

    const resultados: PaginaResultado[] = []

    for (let i = 0; i < totalPaginas; i++) {
      let paginaBlob: Blob
      let paginaFile: File
      if (ehPdf) {
        paginaBlob = await extrairPagina(file, i)
        paginaFile = new File([paginaBlob], `pagina-${i + 1}.pdf`, { type: 'application/pdf' })
      } else {
        paginaBlob = file
        paginaFile = file
      }

      const analise = await analisarPagina(paginaFile)
      resultados.push({ blob: paginaBlob, ...analise })

      setProcessamentos(prev => prev.map(p => p.id === fileId ? { ...p, feitas: i + 1 } : p))
    }

    // Agrupa páginas consecutivas: cada página com valor inicia um novo comprovante;
    // páginas sem valor (continuação) entram no comprovante anterior.
    const grupos: PaginaResultado[][] = []
    for (const r of resultados) {
      if (r.valor != null || grupos.length === 0) {
        grupos.push([r])
      } else {
        grupos[grupos.length - 1].push(r)
      }
    }

    const lancamentosParaMatch = lancamentos.map(l => ({ id: l.id, valor: l.valor, data: l.data }))

    const novosItens: ArquivoItem[] = []
    for (const grupo of grupos) {
      const head = grupo[0]
      const blob = ehPdf ? await juntarPaginas(grupo.map(g => g.blob)) : grupo[0].blob
      const lancamentoId = matchComprovanteLancamento({ valor: head.valor, data: head.data }, lancamentosParaMatch)
      const algumErro = grupo.find(g => g.erro)?.erro

      novosItens.push({
        id: crypto.randomUUID(),
        blob,
        ext: ehPdf ? 'pdf' : (file.name.split('.').pop()?.toLowerCase() || 'jpg'),
        nomeExibicao: grupos.length > 1 ? `${nomeBase} — ${head.descricao || `comprovante ${novosItens.length + 1}`}` : file.name,
        lancamentoId,
        semMatchIA: head.valor != null && !lancamentoId,
        status: algumErro ? 'erro' : 'pendente',
        erro: algumErro,
        valorExtraido: head.valor,
        dataExtraida: head.data,
        descricaoExtraida: head.descricao || null,
      })
    }

    setArquivos(prev => [...prev, ...novosItens])
    setProcessamentos(prev => prev.filter(p => p.id !== fileId))
  }

  function onDropFiles(files: File[]) {
    const validos = files.filter(f => /\.(pdf|jpg|jpeg|png|webp)$/i.test(f.name))
    if (!validos.length) return
    setAberto(true)
    for (const file of validos) {
      processarArquivo(file)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    onDropFiles(Array.from(e.dataTransfer.files))
  }

  async function uploadArquivo(item: ArquivoItem, index: number): Promise<void> {
    if (!item.lancamentoId) return

    setArquivos(prev => prev.map((a, i) => i === index ? { ...a, status: 'enviando' } : a))

    try {
      const path = `clientes/${clienteId}/banco_lancamentos/${item.lancamentoId}/${Date.now()}.${item.ext}`

      const { error: upErr } = await supabase.storage
        .from('comprovantes')
        .upload(path, item.blob, { upsert: true })
      if (upErr) throw new Error(upErr.message)

      const { data: signed } = await supabase.storage
        .from('comprovantes')
        .createSignedUrl(path, 365 * 24 * 3600)

      const url = signed?.signedUrl || null
      if (!url) throw new Error('Falha ao gerar URL')

      const { error: saveErr } = await supabase
        .from('banco_lancamentos')
        .update({ comprovante_url: url })
        .eq('id', item.lancamentoId)
      if (saveErr) throw new Error(saveErr.message)

      setArquivos(prev => prev.map((a, i) => i === index ? { ...a, status: 'ok', url } : a))
    } catch (err) {
      setArquivos(prev => prev.map((a, i) => i === index
        ? { ...a, status: 'erro', erro: err instanceof Error ? err.message : 'Erro' } : a))
    }
  }

  async function enviarTodos() {
    setEnviandoTudo(true)
    const pendentes = arquivos.map((a, i) => ({ a, i })).filter(({ a }) => a.lancamentoId && a.status === 'pendente')
    await Promise.all(pendentes.map(({ a, i }) => uploadArquivo(a, i)))
    setEnviandoTudo(false)
    onConcluido?.()
  }

  function remover(index: number) {
    setArquivos(prev => prev.filter((_, i) => i !== index))
  }

  function alterarLancamento(index: number, lancamentoId: string) {
    setArquivos(prev => prev.map((a, i) => i === index
      ? { ...a, lancamentoId: lancamentoId || null, semMatchIA: false, status: 'pendente', erro: undefined }
      : a))
  }

  const pendentesComVinculo = arquivos.filter(a => a.lancamentoId && a.status === 'pendente').length
  const total = arquivos.length
  const ok = arquivos.filter(a => a.status === 'ok').length

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header clicável */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors"
        onClick={() => setAberto(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <Upload className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Upload de Comprovantes em Lote</span>
          {processamentos.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> analisando {processamentos.length}
            </span>
          )}
          {ok > 0 && (
            <span className="text-[10px] font-bold bg-green-500/15 text-green-400 px-2 py-0.5 rounded-full border border-green-500/20">
              {ok} enviado(s)
            </span>
          )}
          {total > ok && total > 0 && (
            <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
              {total - ok} pendente(s)
            </span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && (
        <div className="px-4 pb-4 border-t border-border">
          {/* Drop zone */}
          <div
            className="mt-3 rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors p-6 text-center cursor-pointer"
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-semibold text-muted-foreground">Arraste PDFs ou clique para selecionar</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — o conteúdo é lido página a página para identificar e vincular cada comprovante</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={e => e.target.files && onDropFiles(Array.from(e.target.files))}
            />
          </div>

          {/* Progresso de análise */}
          {processamentos.length > 0 && (
            <div className="mt-3 space-y-2">
              {processamentos.map(p => (
                <div key={p.id} className="rounded-lg border border-border bg-secondary/50 px-3 py-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-foreground truncate" title={p.nome}>{p.nome}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                      {p.total > 1 ? `Página ${Math.min(p.feitas + 1, p.total)} de ${p.total}` : 'Analisando...'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${p.total > 0 ? Math.round((p.feitas / p.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Lista de arquivos */}
          {arquivos.length > 0 && (
            <div className="mt-3 space-y-2">
              {arquivos.map((item, i) => (
                <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2">
                  {/* Ícone status */}
                  <div className="shrink-0">
                    {item.status === 'ok'       && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    {item.status === 'erro'     && <XCircle className="h-4 w-4 text-red-400" />}
                    {item.status === 'enviando' && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                    {item.status === 'pendente' && <FileText className="h-4 w-4 text-muted-foreground" />}
                  </div>

                  {/* Nome do arquivo + dados extraídos */}
                  <div className="flex flex-col min-w-0 max-w-[220px] shrink-0">
                    <span className="text-xs text-foreground truncate" title={item.nomeExibicao}>
                      {item.nomeExibicao}
                    </span>
                    {(item.valorExtraido != null || item.dataExtraida) && (
                      <span className="text-[10px] text-muted-foreground truncate">
                        {item.valorExtraido != null ? brl(item.valorExtraido) : ''}
                        {item.dataExtraida ? ` · ${fmtData(item.dataExtraida)}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Seta de vínculo */}
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

                  {/* Seletor de lançamento */}
                  {item.status === 'ok' ? (
                    <span className="text-xs text-green-400 font-semibold flex-1">Enviado com sucesso</span>
                  ) : (
                    <select
                      value={item.lancamentoId || ''}
                      onChange={e => alterarLancamento(i, e.target.value)}
                      disabled={item.status === 'enviando'}
                      className="flex-1 h-7 rounded-md border border-border bg-card text-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer min-w-0"
                    >
                      <option value="">— Selecionar lançamento —</option>
                      {lancamentos.map(l => (
                        <option key={l.id} value={l.id}>
                          {fmtData(l.data)} · {l.descricao.substring(0, 35)} · {brl(l.valor)}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Match automático badge */}
                  {item.lancamentoId && item.status === 'pendente' && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded shrink-0">
                      <Sparkles className="h-2.5 w-2.5" /> auto
                    </span>
                  )}

                  {/* IA não encontrou lançamento correspondente */}
                  {item.semMatchIA && item.status === 'pendente' && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded shrink-0" title="A IA leu o comprovante, mas não encontrou um lançamento com valor/data correspondentes. Selecione manualmente.">
                      <AlertTriangle className="h-2.5 w-2.5" /> sem match
                    </span>
                  )}

                  {/* Erro */}
                  {item.status === 'erro' && (
                    <span className="text-[10px] text-red-400 shrink-0" title={item.erro}>{item.erro || 'erro'}</span>
                  )}

                  {/* Botão remover */}
                  {item.status !== 'enviando' && item.status !== 'ok' && (
                    <button onClick={() => remover(i)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Rodapé de ação */}
          {arquivos.length > 0 && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {pendentesComVinculo} de {total} arquivo(s) pronto(s) para envio
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-xs"
                  onClick={() => setArquivos([])} disabled={enviandoTudo}>
                  Limpar
                </Button>
                <Button size="sm" className="text-xs gap-1.5"
                  onClick={enviarTodos}
                  disabled={enviandoTudo || pendentesComVinculo === 0}>
                  {enviandoTudo
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando...</>
                    : <><Upload className="h-3.5 w-3.5" /> Enviar {pendentesComVinculo} arquivo(s)</>
                  }
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
