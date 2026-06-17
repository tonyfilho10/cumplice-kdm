import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const maxDuration = 60

// Formato compacto: codigo|cnpj|nome — ~6 tokens/linha vs ~16 no JSON
// 940 linhas × 6 tokens = 5.640 tokens → bem abaixo do limite
const PROMPT = `Extraia todos os fornecedores deste PDF.

Retorne APENAS linhas no formato abaixo, sem cabeçalho, sem explicações:
CODIGO|CNPJ|NOME

Exemplo:
001|12345678901234|RAZÃO SOCIAL LTDA
182|98765432000100|OUTRA EMPRESA SA

Use apenas dígitos no CNPJ (sem pontos, barras ou traços).
Extraia TODOS os registros sem pular nenhum.`

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

    const records = text.split('\n')
      .map(l => l.trim())
      .filter(l => l && l.includes('|'))
      .map(l => {
        const parts = l.split('|')
        return {
          codigo: (parts[0] ?? '').trim(),
          cnpj:   (parts[1] ?? '').replace(/\D/g, '').padStart(14, '0'),
          nome:   (parts[2] ?? '').trim(),
        }
      })
      .filter(r => r.codigo && r.nome)

    if (records.length === 0) {
      return NextResponse.json({ erro: 'Nenhum fornecedor encontrado no PDF' }, { status: 422 })
    }

    // Insere em lotes de 200 para evitar limite de parâmetros do PG
    const BATCH = 200
    let inseridos = 0, atualizados = 0

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH)

      // Verifica quais códigos já existem
      const codigos = batch.map(r => r.codigo)
      const placeholders = codigos.map((_, j) => `$${j + 2}`).join(',')
      const existentes = await prisma.$queryRawUnsafe<{ id: string; codigo_erp: string }[]>(
        `SELECT id, codigo_erp FROM fornecedores_cadastro WHERE cliente_id = $1 AND codigo_erp IN (${placeholders})`,
        clienteId, ...codigos
      )
      const existMap = new Map(existentes.map(e => [e.codigo_erp, e.id]))

      const novos    = batch.filter(r => !existMap.has(r.codigo))
      const update   = batch.filter(r =>  existMap.has(r.codigo))

      // Bulk INSERT dos novos
      if (novos.length > 0) {
        const vals = novos.map((_, j) => `($${j*5+1},$${j*5+2},$${j*5+3},$${j*5+4},$${j*5+5})`).join(',')
        const args = novos.flatMap(r => [randomUUID(), clienteId, r.cnpj, r.codigo, r.nome])
        await prisma.$executeRawUnsafe(
          `INSERT INTO fornecedores_cadastro (id, cliente_id, cnpj, codigo_erp, nome) VALUES ${vals}`,
          ...args
        )
        inseridos += novos.length
      }

      // UPDATE dos existentes
      for (const r of update) {
        await prisma.$executeRawUnsafe(
          `UPDATE fornecedores_cadastro SET nome=$1, cnpj=$2 WHERE id=$3`,
          r.nome, r.cnpj, existMap.get(r.codigo)!
        )
        atualizados++
      }
    }

    return NextResponse.json({ inseridos, atualizados, total: records.length })
  } catch (err) {
    console.error('[importar-fornecedores-cadastro]', err)
    return NextResponse.json({ erro: err instanceof Error ? err.message : 'Erro ao processar PDF' }, { status: 500 })
  }
}
