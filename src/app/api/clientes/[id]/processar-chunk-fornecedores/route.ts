import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'

export const maxDuration = 30

const PROMPT = `Abaixo está parte do texto extraído de um PDF de cadastro de fornecedores.
Extraia todos os fornecedores e retorne APENAS linhas no formato:
CODIGO|CNPJ|NOME

Regras:
- CNPJ/CPF apenas dígitos (sem pontos, barras ou traços), 14 dígitos para CNPJ ou 11 para CPF
- Uma linha por fornecedor
- Sem cabeçalho, sem explicações, sem linhas em branco
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
        return {
          codigo: (p[0] ?? '').trim(),
          cnpj:   (p[1] ?? '').replace(/\D/g, '').padStart(14, '0'),
          nome:   (p[2] ?? '').trim(),
        }
      })
      .filter(r => r.codigo && r.nome)

    return NextResponse.json({ registros })
  } catch (err) {
    console.error('[processar-chunk-fornecedores]', err)
    return NextResponse.json({ erro: err instanceof Error ? err.message : 'Erro ao processar chunk' }, { status: 500 })
  }
}
