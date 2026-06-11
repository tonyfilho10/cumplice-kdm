import { NextRequest, NextResponse } from 'next/server'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { analisarPaginaComprovante } from '@/lib/ia/comprovante'

const MIME_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params

  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) return NextResponse.json({ erro: 'Arquivo não enviado' }, { status: 400 })

    const mimeType = file.type || 'application/pdf'
    if (!MIME_PERMITIDOS.includes(mimeType)) {
      return NextResponse.json({ erro: `Tipo de arquivo não suportado: ${mimeType}` }, { status: 415 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    try {
      const resultado = await analisarPaginaComprovante(buffer, mimeType)
      return NextResponse.json(resultado)
    } catch (err) {
      console.error('[analisar-pagina-comprovante] análise IA falhou', err)
      return NextResponse.json({ erro: 'Falha ao analisar a página' }, { status: 502 })
    }
  } catch (err) {
    console.error('[analisar-pagina-comprovante]', err)
    return NextResponse.json({ erro: 'Erro interno ao processar página' }, { status: 500 })
  }
}
