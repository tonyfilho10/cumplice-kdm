import { NextRequest, NextResponse } from 'next/server'
import { guardCliente } from '@/lib/supabase/auth-guard'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

export const maxDuration = 30

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const formData = await request.formData()
    const arquivo = formData.get('arquivo') as File | null
    if (!arquivo) return NextResponse.json({ erro: 'Arquivo não enviado' }, { status: 400 })

    const buffer = Buffer.from(await arquivo.arrayBuffer())
    const { text } = await pdfParse(buffer)

    if (!text?.trim()) {
      return NextResponse.json({ erro: 'Não foi possível extrair texto do PDF (talvez seja um PDF escaneado)' }, { status: 422 })
    }

    return NextResponse.json({ texto: text })
  } catch (err) {
    console.error('[extrair-texto-pdf]', err)
    return NextResponse.json({ erro: err instanceof Error ? err.message : 'Erro ao ler PDF' }, { status: 500 })
  }
}
