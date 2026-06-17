import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const maxDuration = 60

// Formato compacto pipe-delimitado — ~12 tokens/linha vs ~37 no JSON
// 243 linhas × 12 tokens = 2.916 tokens → bem abaixo do limite
const PROMPT = `Extraia todas as contas a pagar deste PDF.

Retorne APENAS linhas no formato abaixo, sem cabeçalho, sem explicações:
CODIGO_FORN|NOME_FORN|DOCUMENTO|VENCIMENTO|VALOR_PARCELA|VALOR_PAGO|SALDO|SITUACAO

Exemplo:
182|BONOR INDUSTRIAL SA|29153|2026-01-26|176.92|0.00|176.92|Aberta
023|EMPRESA XYZ LTDA|45678|2026-02-15|1500.00|1500.00|0.00|Pago

Regras:
- VENCIMENTO no formato YYYY-MM-DD (ou vazio se não houver)
- VALOR_PARCELA, VALOR_PAGO e SALDO com ponto decimal
- SITUACAO deve ser exatamente: Aberta, Pago ou Parcial
- Extraia TODOS os registros sem pular nenhum`

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const formData = await request.formData()
    const arquivo   = formData.get('arquivo') as File | null
    const substituir = formData.get('substituir') === 'true'

    if (!arquivo) return NextResponse.json({ erro: 'Arquivo não enviado' }, { status: 400 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ erro: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })

    const base64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64')
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''

    type Conta = {
      fornecedor_codigo: string; fornecedor_nome: string; documento: string
      vencimento: string | null; valor_parcela: number; valor_pago: number
      saldo: number; situacao: string
    }

    const records: Conta[] = text.split('\n')
      .map(l => l.trim())
      .filter(l => l && l.includes('|'))
      .map(l => {
        const p = l.split('|')
        const situacaoRaw = (p[7] ?? '').trim()
        return {
          fornecedor_codigo: (p[0] ?? '').trim(),
          fornecedor_nome:   (p[1] ?? '').trim(),
          documento:         (p[2] ?? '').trim(),
          vencimento:        (p[3] ?? '').trim() || null,
          valor_parcela:     parseFloat(p[4] ?? '0') || 0,
          valor_pago:        parseFloat(p[5] ?? '0') || 0,
          saldo:             parseFloat(p[6] ?? '0') || 0,
          situacao:          ['Aberta','Pago','Parcial'].includes(situacaoRaw) ? situacaoRaw : 'Aberta',
        }
      })
      .filter(r => r.fornecedor_nome && r.documento)

    if (records.length === 0) {
      return NextResponse.json({ erro: 'Nenhuma conta encontrada no PDF' }, { status: 422 })
    }

    if (substituir) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM contas_pagar WHERE cliente_id = $1 AND banco_lancamento_id IS NULL`,
        clienteId
      )
    }

    // Busca duplicatas por (fornecedor_nome, documento) para evitar re-inserção
    const chaves = records.map(r => `${r.fornecedor_nome}||${r.documento}`)
    const existentes = substituir ? [] : await prisma.$queryRawUnsafe<{ fornecedor_nome: string; documento: string }[]>(
      `SELECT fornecedor_nome, documento FROM contas_pagar WHERE cliente_id = $1`,
      clienteId
    )
    const existSet = new Set(existentes.map(e => `${e.fornecedor_nome}||${e.documento}`))

    const novos = records.filter((_, i) => !existSet.has(chaves[i]))
    const ignorados = records.length - novos.length

    // Bulk INSERT em lotes de 100
    const BATCH = 100
    for (let i = 0; i < novos.length; i += BATCH) {
      const batch = novos.slice(i, i + BATCH)
      const vals = batch.map((_, j) => {
        const b = j * 12
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12})`
      }).join(',')
      const args = batch.flatMap(r => [
        randomUUID(), clienteId,
        r.fornecedor_codigo, r.fornecedor_nome, r.documento,
        null, null, r.vencimento,
        r.valor_parcela, r.valor_pago, r.saldo, r.situacao,
      ])
      await prisma.$executeRawUnsafe(
        `INSERT INTO contas_pagar
          (id, cliente_id, fornecedor_codigo, fornecedor_nome, documento,
           emissao, entrada, vencimento, valor_parcela, valor_pago, saldo, situacao)
         VALUES ${vals}`,
        ...args
      )
    }

    return NextResponse.json({ inseridos: novos.length, ignorados, total: records.length })
  } catch (err) {
    console.error('[importar-contas-pagar]', err)
    return NextResponse.json({ erro: err instanceof Error ? err.message : 'Erro ao processar PDF' }, { status: 500 })
  }
}
