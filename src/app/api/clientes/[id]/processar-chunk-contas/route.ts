import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'

export const maxDuration = 30

const PROMPT = `Abaixo está parte do texto extraído de um PDF de contas a pagar.
Extraia todas as contas e retorne APENAS linhas no formato:
CODIGO_FORN|NOME_FORN|DOCUMENTO|VENCIMENTO|VALOR_PARCELA|VALOR_PAGO|SALDO|SITUACAO

Regras:
- VENCIMENTO no formato YYYY-MM-DD (ou vazio se não houver)
- VALOR_PARCELA, VALOR_PAGO e SALDO com ponto decimal (ex: 176.92)
- SITUACAO deve ser exatamente: Aberta, Pago ou Parcial
- Uma linha por conta, sem cabeçalho, sem explicações
- Extraia TODOS os registros visíveis neste trecho

TEXTO:
`

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const { texto } = await request.json() as { texto: string }
    if (!texto?.trim()) return NextResponse.json({ registros: [] })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ erro: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: PROMPT + texto.slice(0, 12_000) }],
    })

    const out = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const registros = out.split('\n')
      .map(l => l.trim())
      .filter(l => l && l.includes('|'))
      .map(l => {
        const p = l.split('|')
        const sit = (p[7] ?? '').trim()
        return {
          fornecedor_codigo: (p[0] ?? '').trim(),
          fornecedor_nome:   (p[1] ?? '').trim(),
          documento:         (p[2] ?? '').trim(),
          vencimento:        (p[3] ?? '').trim() || null,
          valor_parcela:     parseFloat(p[4] ?? '0') || 0,
          valor_pago:        parseFloat(p[5] ?? '0') || 0,
          saldo:             parseFloat(p[6] ?? '0') || 0,
          situacao:          ['Aberta','Pago','Parcial'].includes(sit) ? sit : 'Aberta',
        }
      })
      .filter(r => r.fornecedor_nome && r.documento)

    return NextResponse.json({ registros })
  } catch (err) {
    console.error('[processar-chunk-contas]', err)
    return NextResponse.json({ erro: err instanceof Error ? err.message : 'Erro ao processar chunk' }, { status: 500 })
  }
}
