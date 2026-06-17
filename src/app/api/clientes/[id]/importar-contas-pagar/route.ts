import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const maxDuration = 120

const TOOL_SCHEMA = {
  name: 'registrar_contas_pagar',
  description: 'Registra a lista de contas a pagar extraída do PDF',
  input_schema: {
    type: 'object' as const,
    properties: {
      contas: {
        type: 'array',
        description: 'Lista de contas a pagar encontradas',
        items: {
          type: 'object',
          properties: {
            fornecedor_codigo: { type: 'string', description: 'Código do fornecedor' },
            fornecedor_nome:   { type: 'string', description: 'Nome/razão social do fornecedor' },
            documento:         { type: 'string', description: 'Número do documento/nota/boleto' },
            emissao:           { type: ['string', 'null'], description: 'Data de emissão YYYY-MM-DD ou null' },
            entrada:           { type: ['string', 'null'], description: 'Data de entrada YYYY-MM-DD ou null' },
            vencimento:        { type: ['string', 'null'], description: 'Data de vencimento YYYY-MM-DD ou null' },
            valor_parcela:     { type: 'number', description: 'Valor da parcela em reais' },
            valor_pago:        { type: 'number', description: 'Valor já pago em reais (0 se em aberto)' },
            saldo:             { type: 'number', description: 'Saldo restante em reais' },
            situacao:          { type: 'string', enum: ['Aberta', 'Pago', 'Parcial'], description: 'Situação da conta' },
          },
          required: ['fornecedor_nome', 'documento', 'valor_parcela', 'situacao'],
        },
      },
    },
    required: ['contas'],
  },
}

const PROMPT = `Extraia todas as contas a pagar deste PDF. O arquivo contém uma tabela com lançamentos de fornecedores.

Colunas esperadas: Fornecedor (código e nome), Documento, Emissão, Entrada, Vencimento, Valor Parcela, Valor Pago, Saldo, Situação.

Extraia TODOS os registros, sem pular nenhum. Para datas, converta para o formato YYYY-MM-DD.
Para valores, use números decimais (ex: 1234.56). Situação deve ser "Aberta", "Pago" ou "Parcial".

Use a ferramenta registrar_contas_pagar para retornar os dados.`

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
    const substituir = formData.get('substituir') === 'true'

    if (!arquivo) return NextResponse.json({ erro: 'Arquivo não enviado' }, { status: 400 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ erro: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })
    const client = new Anthropic({ apiKey })

    const buffer = Buffer.from(await arquivo.arrayBuffer())
    const base64 = buffer.toString('base64')

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'any' },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    })

    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ erro: 'Não foi possível extrair contas a pagar do PDF' }, { status: 422 })
    }

    type ContaInput = {
      fornecedor_codigo?: string; fornecedor_nome: string; documento: string
      emissao?: string | null; entrada?: string | null; vencimento?: string | null
      valor_parcela: number; valor_pago?: number; saldo?: number; situacao: string
    }
    const { contas } = toolUse.input as { contas: ContaInput[] }

    if (!contas?.length) {
      return NextResponse.json({ erro: 'Nenhuma conta encontrada no PDF' }, { status: 422 })
    }

    // Se substituir=true, remove contas sem banco_lancamento_id vinculado (mantém as já baixadas)
    if (substituir) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM contas_pagar WHERE cliente_id = $1 AND banco_lancamento_id IS NULL`,
        clienteId
      )
    }

    let inseridos = 0
    let ignorados = 0

    for (const c of contas) {
      const valorParcela = Number(c.valor_parcela) || 0
      const valorPago    = Number(c.valor_pago)    || 0
      const saldo        = c.saldo != null ? Number(c.saldo) : valorParcela - valorPago
      const situacao     = ['Aberta', 'Pago', 'Parcial'].includes(c.situacao) ? c.situacao : 'Aberta'

      // Verifica duplicata por fornecedor + documento (evita re-importar o mesmo PDF)
      if (!substituir) {
        const dup = await prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM contas_pagar WHERE cliente_id = $1 AND fornecedor_nome = $2 AND documento = $3 LIMIT 1`,
          clienteId, c.fornecedor_nome, c.documento
        )
        if (dup.length > 0) { ignorados++; continue }
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO contas_pagar
          (id, cliente_id, fornecedor_codigo, fornecedor_nome, documento,
           emissao, entrada, vencimento, valor_parcela, valor_pago, saldo, situacao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        randomUUID(), clienteId,
        c.fornecedor_codigo ?? '',
        c.fornecedor_nome,
        c.documento,
        c.emissao   ?? null,
        c.entrada   ?? null,
        c.vencimento ?? null,
        valorParcela, valorPago, saldo, situacao
      )
      inseridos++
    }

    return NextResponse.json({ inseridos, ignorados, total: contas.length })
  } catch (err) {
    console.error('[importar-contas-pagar]', err)
    return NextResponse.json({ erro: 'Erro ao processar PDF' }, { status: 500 })
  }
}
