import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const maxDuration = 300

const PROMPT = `Extraia todos os fornecedores deste PDF. A tabela contém colunas como Código, CNPJ/CPF e Razão Social.

Retorne APENAS linhas JSON, uma por fornecedor, sem nenhum outro texto:
{"codigo":"001","cnpj":"12345678901234","nome":"RAZÃO SOCIAL LTDA"}

Sem cabeçalho, sem explicações, sem markdown. Apenas as linhas JSON.
Extraia TODOS os registros sem pular nenhum.`

function limparCnpj(v?: string) {
  return (v ?? '').replace(/\D/g, '').padStart(14, '0') || '00000000000000'
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  const formData = await request.formData()
  const arquivo = formData.get('arquivo') as File | null
  if (!arquivo) {
    return Response.json({ erro: 'Arquivo não enviado' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ erro: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })
  }

  const base64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64')
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))

      try {
        await send({ status: 'processing', msg: 'Analisando PDF...' })

        const client = new Anthropic({ apiKey })
        const aiStream = client.messages.stream({
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

        let buf = ''
        const records: { codigo: string; cnpj?: string; nome: string }[] = []

        for await (const chunk of aiStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            buf += chunk.delta.text
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              const t = line.trim()
              if (!t) continue
              try {
                const r = JSON.parse(t)
                if (r.nome) { records.push(r); await send({ status: 'progress', count: records.length }) }
              } catch { /* linha parcial */ }
            }
          }
        }
        if (buf.trim()) {
          try { const r = JSON.parse(buf.trim()); if (r.nome) records.push(r) } catch {}
        }

        await send({ status: 'processing', msg: `Salvando ${records.length} fornecedores...` })

        let inseridos = 0, atualizados = 0
        for (const f of records) {
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
              `INSERT INTO fornecedores_cadastro (id, cliente_id, cnpj, codigo_erp, nome) VALUES ($1,$2,$3,$4,$5)`,
              randomUUID(), clienteId, cnpj, f.codigo, f.nome
            )
            inseridos++
          }
        }

        await send({ status: 'done', inseridos, atualizados, total: records.length })
      } catch (err) {
        controller.enqueue(
          encoder.encode(JSON.stringify({ status: 'error', erro: err instanceof Error ? err.message : String(err) }) + '\n')
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
