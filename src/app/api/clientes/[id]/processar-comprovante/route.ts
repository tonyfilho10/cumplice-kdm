import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { analisarComprovante } from '@/lib/ia/comprovante'
import { dividirPdf } from '@/lib/parsers/pdf'
import { matchComprovanteLancamento } from '@/lib/matching/comprovante'

const MIME_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

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
    const periodo = formData.get('periodo') as string

    if (!file)    return NextResponse.json({ erro: 'Arquivo não enviado' }, { status: 400 })
    if (!periodo) return NextResponse.json({ erro: 'Período obrigatório' }, { status: 400 })

    const mimeType = file.type || 'application/pdf'
    if (!MIME_PERMITIDOS.includes(mimeType)) {
      return NextResponse.json({ erro: `Tipo de arquivo não suportado: ${mimeType}` }, { status: 415 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    let detectados
    try {
      detectados = await analisarComprovante(buffer, mimeType)
    } catch (err) {
      console.error('[processar-comprovante] análise IA falhou', err)
      return NextResponse.json({ erro: 'Falha ao analisar o documento' }, { status: 502 })
    }

    if (detectados.length === 0) {
      return NextResponse.json({ erro: 'Nenhum comprovante identificado no documento' }, { status: 422 })
    }

    const lancamentos = await prisma.bancoLancamento.findMany({
      where: { cliente_id: clienteId, periodo },
      select: { id: true, data: true, valor: true, descricao: true },
    })
    const lancamentosNum = lancamentos.map(l => ({
      id: l.id,
      data: l.data.toISOString(),
      valor: Number(l.valor),
      descricao: l.descricao,
    }))

    const dividirEmSubArquivos = mimeType === 'application/pdf' && detectados.length > 1

    const resultado = await Promise.all(detectados.map(async (c, i) => {
      const arquivoBuffer = dividirEmSubArquivos
        ? await dividirPdf(buffer, c.paginas)
        : buffer

      const lancamentoId = matchComprovanteLancamento(
        { valor: c.valor, data: c.data },
        lancamentosNum
      )

      const sufixo = dividirEmSubArquivos ? ` (pág. ${c.paginas.join(', ')})` : ''
      const nomeBase = file.name.replace(/\.(pdf|jpg|jpeg|png|webp)$/i, '')

      return {
        nomeExibicao: `${nomeBase}${detectados.length > 1 ? ` — ${c.descricao}${sufixo}` : ''}`,
        valor: c.valor,
        data: c.data,
        descricao: c.descricao,
        lancamentoId,
        mimeType: dividirEmSubArquivos ? 'application/pdf' : mimeType,
        arquivoBase64: arquivoBuffer.toString('base64'),
        ordem: i,
      }
    }))

    return NextResponse.json({ comprovantes: resultado })
  } catch (err) {
    console.error('[processar-comprovante]', err)
    return NextResponse.json({ erro: 'Erro interno ao processar comprovante' }, { status: 500 })
  }
}
