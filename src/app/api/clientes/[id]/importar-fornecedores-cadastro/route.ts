import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

export const maxDuration = 60

const PROMPT = `Abaixo está o texto extraído de um PDF de cadastro de fornecedores.
Extraia todos os fornecedores e retorne APENAS linhas no formato:
CODIGO|CNPJ|NOME

Regras:
- CNPJ/CPF apenas dígitos (sem pontos, barras ou traços), 14 dígitos para CNPJ ou 11 para CPF
- Uma linha por fornecedor
- Sem cabeçalho, sem explicações, sem linhas em branco
- Extraia TODOS os registros

TEXTO DO PDF:
`

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

    // Extrai texto do PDF localmente (sem IA) — rápido e sem timeout
    const buffer = Buffer.from(await arquivo.arrayBuffer())
    const { text: rawText } = await pdfParse(buffer)

    // Limita a 80 mil chars para evitar prompts gigantes (≈ 20k tokens de entrada)
    const pdfText = rawText?.slice(0, 80_000)

    if (!pdfText?.trim()) {
      return NextResponse.json({ erro: 'Não foi possível extrair texto do PDF' }, { status: 422 })
    }

    // Envia só o texto (não o PDF) para Claude — 10x mais rápido
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: PROMPT + pdfText,
      }],
    })

    const out = response.content[0]?.type === 'text' ? response.content[0].text : ''

    const records = out.split('\n')
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

    if (records.length === 0) {
      return NextResponse.json({ erro: 'Nenhum fornecedor encontrado no PDF' }, { status: 422 })
    }

    // Insere em lotes de 200
    const BATCH = 200
    let inseridos = 0, atualizados = 0

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH)
      const codigos = batch.map(r => r.codigo)
      const ph = codigos.map((_, j) => `$${j + 2}`).join(',')
      const existentes = await prisma.$queryRawUnsafe<{ id: string; codigo_erp: string }[]>(
        `SELECT id, codigo_erp FROM fornecedores_cadastro WHERE cliente_id = $1 AND codigo_erp IN (${ph})`,
        clienteId, ...codigos
      )
      const existMap = new Map(existentes.map(e => [e.codigo_erp, e.id]))

      const novos  = batch.filter(r => !existMap.has(r.codigo))
      const update = batch.filter(r =>  existMap.has(r.codigo))

      if (novos.length > 0) {
        const vals = novos.map((_, j) => `($${j*5+1},$${j*5+2},$${j*5+3},$${j*5+4},$${j*5+5})`).join(',')
        const args = novos.flatMap(r => [randomUUID(), clienteId, r.cnpj, r.codigo, r.nome])
        await prisma.$executeRawUnsafe(
          `INSERT INTO fornecedores_cadastro (id, cliente_id, cnpj, codigo_erp, nome) VALUES ${vals}`,
          ...args
        )
        inseridos += novos.length
      }
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
