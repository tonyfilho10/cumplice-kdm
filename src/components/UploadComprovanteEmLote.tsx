'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { BancoLancamento } from '@/lib/supabase/types'
import { brl, fmtData } from '@/components/ui'
import { Upload, CheckCircle2, XCircle, Link2, Loader2, FileText, ChevronDown, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  status: 'analisando' | 'pendente' | 'enviando' | 'ok' | 'erro'
  erro?: string
  url?: string
  valorExtraido: number | null
  dataExtraida: string | null
  descricaoExtraida: string | null
}

function extFromMime(mime: string): string {
  switch (mime) {
    case 'application/pdf': return 'pdf'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    default: return 'jpg'
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export default function UploadComprovanteEmLote({ clienteId, periodo, lancamentos, onConcluido }: Props) {
  const supabase = createClient()
  const [aberto, setAberto] = useState(false)
  const [arquivos, setArquivos] = useState<ArquivoItem[]>([])
  const [enviandoTudo, setEnviandoTudo] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function processarArquivo(file: File) {
    const id = crypto.randomUUID()
    // Item provisório enquanto a análise roda
    const provisorio: ArquivoItem = {
      id,
      blob: file,
      ext: file.name.split('.').pop()?.toLowerCase() || 'pdf',
      nomeExibicao: file.name,
      lancamentoId: null,
      status: 'analisando',
      valorExtraido: null,
      dataExtraida: null,
      descricaoExtraida: null,
    }
    setArquivos(prev => [...prev, provisorio])

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('periodo', periodo)

      const resp = await fetch(`/api/clientes/${clienteId}/processar-comprovante`, {
        method: 'POST',
        body: formData,
      })
      const data = await resp.json()

      if (!resp.ok) {
        throw new Error(data?.erro || 'Falha ao analisar o documento')
      }

      type ComprovanteResp = {
        nomeExibicao: string
        valor: number
        data: string | null
        descricao: string
        lancamentoId: string | null
        mimeType: string
        arquivoBase64: string
      }

      const comprovantes: ComprovanteResp[] = data.comprovantes || []
      const novosItens: ArquivoItem[] = comprovantes.map(c => ({
        id: crypto.randomUUID(),
        blob: base64ToBlob(c.arquivoBase64, c.mimeType),
        ext: extFromMime(c.mimeType),
        nomeExibicao: c.nomeExibicao,
        lancamentoId: c.lancamentoId,
        status: 'pendente',
        valorExtraido: c.valor,
        dataExtraida: c.data,
        descricaoExtraida: c.descricao,
      }))

      setArquivos(prev => prev.flatMap(a => a.id === id ? novosItens : [a]))
    } catch (err) {
      setArquivos(prev => prev.map(a => a.id === id
        ? { ...a, status: 'erro', erro: err instanceof Error ? err.message : 'Erro ao analisar' }
        : a))
    }
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
    setArquivos(prev => prev.map((a, i) => i === index ? { ...a, lancamentoId: lancamentoId || null, status: 'pendente' } : a))
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
            <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — o conteúdo é lido automaticamente para vincular ao lançamento</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={e => e.target.files && onDropFiles(Array.from(e.target.files))}
            />
          </div>

          {/* Lista de arquivos */}
          {arquivos.length > 0 && (
            <div className="mt-3 space-y-2">
              {arquivos.map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2">
                  {/* Ícone status */}
                  <div className="shrink-0">
                    {item.status === 'ok'        && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    {item.status === 'erro'      && <XCircle className="h-4 w-4 text-red-400" />}
                    {(item.status === 'enviando' || item.status === 'analisando') && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                    {item.status === 'pendente'  && <FileText className="h-4 w-4 text-muted-foreground" />}
                  </div>

                  {/* Nome do arquivo + dados extraídos */}
                  <div className="flex flex-col min-w-0 max-w-[220px] shrink-0">
                    <span className="text-xs text-foreground truncate" title={item.nomeExibicao}>
                      {item.nomeExibicao}
                    </span>
                    {item.status === 'analisando' && (
                      <span className="text-[10px] text-muted-foreground">Analisando conteúdo...</span>
                    )}
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
                  ) : item.status === 'analisando' ? (
                    <span className="text-xs text-muted-foreground flex-1">Lendo documento...</span>
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

                  {/* Erro */}
                  {item.status === 'erro' && (
                    <span className="text-[10px] text-red-400 shrink-0" title={item.erro}>{item.erro || 'erro'}</span>
                  )}

                  {/* Botão remover */}
                  {item.status !== 'enviando' && item.status !== 'ok' && item.status !== 'analisando' && (
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
