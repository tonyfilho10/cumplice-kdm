// Análise de uma única página de comprovante (PDF/imagem) via Claude API
import Anthropic from '@anthropic-ai/sdk'

export type PaginaAnalisada = {
  valor: number | null
  data: string | null // YYYY-MM-DD
  descricao: string
}

const TOOL_NAME = 'registrar_pagina_comprovante'

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description: 'Registra os dados extraídos de uma página de comprovante de pagamento',
  input_schema: {
    type: 'object' as const,
    properties: {
      valor: {
        type: ['number', 'null'],
        description: 'Valor pago em reais (ex: 215.90), ou null se esta página não contém um valor de pagamento próprio (ex: página de continuação/instruções de um comprovante anterior)',
      },
      data: {
        type: ['string', 'null'],
        description: 'Data de pagamento (ou vencimento, se não houver data de pagamento) no formato YYYY-MM-DD, ou null se não encontrada',
      },
      descricao: {
        type: 'string',
        description: 'Descrição curta do conteúdo da página (tipo de documento + favorecido/código, quando disponível). Se for página de continuação, descreva como tal.',
      },
    },
    required: ['valor', 'data', 'descricao'],
  },
}

const PROMPT = `Esta é UMA página de um documento PDF que pode conter um ou mais comprovantes de pagamento (DARF, GPS, FGTS, PIX, TED, boleto, guias de tributos, etc), um após o outro.

Analise APENAS esta página e identifique:
- O valor pago em reais (campo "valor"), se esta página contém o valor de um comprovante de pagamento.
- A data de pagamento/vencimento (campo "data"), no formato YYYY-MM-DD.
- Uma descrição curta do conteúdo (campo "descricao").

Se esta página for apenas a CONTINUAÇÃO de um comprovante cujo valor já apareceu em uma página anterior (ex: instruções, código de barras sem novo valor, segunda via), retorne "valor": null.

Use a ferramenta ${TOOL_NAME} para responder.`

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada')
    client = new Anthropic({ apiKey })
  }
  return client
}

export async function analisarPaginaComprovante(buffer: Buffer, mimeType: string): Promise<PaginaAnalisada> {
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
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
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
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { valor: null, data: null, descricao: '' }
  }

  const input = toolUse.input as PaginaAnalisada
  return {
    valor: typeof input.valor === 'number' ? input.valor : null,
    data: input.data || null,
    descricao: input.descricao || '',
  }
}
