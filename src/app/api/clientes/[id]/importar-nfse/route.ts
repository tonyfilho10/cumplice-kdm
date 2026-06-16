import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'

export const maxDuration = 60

const TOOL_NAME = 'registrar_nfse'

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description: 'Registra os dados extraídos de uma Nota Fiscal Eletrônica de Serviços (NFS-e)',
  input_schema: {
    type: 'object' as const,
    properties: {
      numero: {
        type: 'string',
        description: 'Número da nota (ex: "00018599")',
      },
      data: {
        type: 'string',
        description: 'Data de emissão no formato YYYY-MM-DD',
      },
      prestador: {
        type: 'string',
        description: 'Razão social do prestador de serviços',
      },
      cnpj_prestador: {
        type: ['string', 'null'],
        description: 'CNPJ do prestador (ex: "24.480.018/0001-04"), ou null se não encontrado',
      },
      valor: {
        type: 'number',
        description: 'Valor total do serviço em reais (ex: 2073.25)',
      },
      discriminacao: {
        type: ['string', 'null'],
        description: 'Discriminação/descrição dos serviços prestados, ou null se não encontrada',
      },
      codigo_servico: {
        type: ['string', 'null'],
        description: 'Código do serviço (ex: "01899"), ou null se não encontrado',
      },
    },
    required: ['numero', 'data', 'prestador', 'valor'],
  },
}

const PROMPT = `Analise esta Nota Fiscal Eletrônica de Serviços (NFS-e) e extraia os dados estruturados.

Procure pelos campos:
- Número da nota (geralmente no canto superior direito)
- Data de emissão
- Prestador de serviços (razão social e CNPJ)
- Valor total do serviço
- Discriminação dos serviços prestados
- Código do serviço

Use a ferramenta registrar_nfse para retornar os dados extraídos.`

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

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ erro: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })
    const client = new Anthropic({ apiKey })

    const buffer = Buffer.from(await arquivo.arrayBuffer())
    const base64 = buffer.toString('base64')

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    })

    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ erro: 'Não foi possível extrair dados da NFS-e' }, { status: 422 })
    }

    return NextResponse.json(toolUse.input)
  } catch (err) {
    console.error('[importar-nfse]', err)
    return NextResponse.json({ erro: 'Erro ao processar PDF' }, { status: 500 })
  }
}
