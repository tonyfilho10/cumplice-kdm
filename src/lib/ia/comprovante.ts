// Análise de comprovantes (PDF/imagem) via Claude API
import Anthropic from '@anthropic-ai/sdk'

export type ComprovanteDetectado = {
  paginas: number[]
  valor: number
  data: string | null // YYYY-MM-DD
  descricao: string
}

const TOOL_NAME = 'registrar_comprovantes'

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description: 'Registra os comprovantes de pagamento identificados no documento',
  input_schema: {
    type: 'object' as const,
    properties: {
      comprovantes: {
        type: 'array',
        description: 'Um item para cada comprovante de pagamento distinto encontrado no documento',
        items: {
          type: 'object',
          properties: {
            paginas: {
              type: 'array',
              description: 'Números das páginas (1-indexed) que compõem este comprovante',
              items: { type: 'integer' },
            },
            valor: {
              type: 'number',
              description: 'Valor pago em reais (ex: 215.90)',
            },
            data: {
              type: ['string', 'null'],
              description: 'Data de pagamento/vencimento no formato YYYY-MM-DD, ou null se não encontrada',
            },
            descricao: {
              type: 'string',
              description: 'Descrição curta do comprovante (ex: "DARF - Código 2089", "PIX para Fornecedor X", "Guia GPS")',
            },
          },
          required: ['paginas', 'valor', 'descricao'],
        },
      },
    },
    required: ['comprovantes'],
  },
}

const PROMPT = `Analise este documento, que pode conter um ou mais comprovantes de pagamento (DARF, GPS, FGTS, PIX, TED, boleto, guias de tributos, etc).

Para CADA comprovante de pagamento distinto presente no documento, identifique:
- as páginas (1-indexed) que ele ocupa
- o valor pago em reais
- a data de pagamento (ou vencimento, se não houver data de pagamento), no formato YYYY-MM-DD
- uma descrição curta (tipo de documento + favorecido/código, quando disponível)

Se o documento inteiro for um único comprovante, retorne apenas um item. Use a ferramenta ${TOOL_NAME} para responder.`

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada')
    client = new Anthropic({ apiKey })
  }
  return client
}

export async function analisarComprovante(buffer: Buffer, mimeType: string): Promise<ComprovanteDetectado[]> {
  const base64 = buffer.toString('base64')

  const documentBlock = mimeType === 'application/pdf'
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
      }
    : {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: base64 },
      }

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [documentBlock, { type: 'text', text: PROMPT }],
      },
    ],
  })

  const toolUse = response.content.find(c => c.type === 'tool_use' && c.name === TOOL_NAME)
  if (!toolUse || toolUse.type !== 'tool_use') return []

  const input = toolUse.input as { comprovantes?: ComprovanteDetectado[] }
  return (input.comprovantes || []).filter(c => Array.isArray(c.paginas) && c.paginas.length > 0)
}
