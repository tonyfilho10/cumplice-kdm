import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const maxDuration = 120

const TOOL_SCHEMA = {
  name: 'registrar_fornecedores',
  description: 'Registra a lista de fornecedores extraída do PDF',
  input_schema: {
    type: 'object' as const,
    properties: {
      fornecedores: {
        type: 'array',
        description: 'Lista de fornecedores encontrados',
        items: {
          type: 'object',
          properties: {
            codigo: { type: 'string', description: 'Código/ID do fornecedor no ERP' },
            cnpj:   { type: 'string', description: 'CNPJ ou CPF do fornecedor (apenas dígitos ou formatado)' },
            nome:   { type: 'string', description: 'Razão social ou nome do fornecedor' },
          },
          required: ['codigo', 'nome'],
        },
      },
    },
    required: ['fornecedores'],
  },
}

const PROMPT = `Extraia todos os fornecedores deste PDF. O arquivo contém uma tabela com colunas como Código, CNPJ/CPF e Razão Social (ou Nome).

Extraia TODOS os registros, sem pular nenhum. Use a ferramenta registrar_fornecedores para retornar os dados.`

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
      return NextResponse.json({ erro: 'Não foi possível extrair fornecedores do PDF' }, { status: 422 })
    }

    const { fornecedores } = toolUse.input as { fornecedores: { codigo: string; cnpj?: string; nome: string }[] }

    if (!fornecedores?.length) {
      return NextResponse.json({ erro: 'Nenhum fornecedor encontrado no PDF' }, { status: 422 })
    }

    // Limpa CNPJ para apenas dígitos
    function limparCnpj(v?: string) {
      return (v ?? '').replace(/\D/g, '').padStart(14, '0') || '00000000000000'
    }

    let inseridos = 0
    let atualizados = 0

    for (const f of fornecedores) {
      const cnpj = limparCnpj(f.cnpj)
      const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM fornecedores_cadastro WHERE cliente_id = $1 AND codigo_erp = $2 LIMIT 1`,
        clienteId, f.codigo
      )

      if (existing.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE fornecedores_cadastro SET nome = $1, cnpj = $2 WHERE id = $3`,
          f.nome, cnpj, existing[0].id
        )
        atualizados++
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO fornecedores_cadastro (id, cliente_id, cnpj, codigo_erp, nome) VALUES ($1, $2, $3, $4, $5)`,
          randomUUID(), clienteId, cnpj, f.codigo, f.nome
        )
        inseridos++
      }
    }

    return NextResponse.json({ inseridos, atualizados, total: fornecedores.length })
  } catch (err) {
    console.error('[importar-fornecedores-cadastro]', err)
    return NextResponse.json({ erro: 'Erro ao processar PDF' }, { status: 500 })
  }
}
