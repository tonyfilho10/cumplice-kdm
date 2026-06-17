import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const maxDuration = 300

const PROMPT = `Extraia todas as contas a pagar deste PDF. Colunas esperadas: Fornecedor (código e nome), Documento, Emissão, Entrada, Vencimento, Valor Parcela, Valor Pago, Saldo, Situação.

Retorne APENAS linhas JSON, uma por conta, sem nenhum outro texto:
{"fornecedor_codigo":"182","fornecedor_nome":"EMPRESA LTDA","documento":"29153","emissao":"2026-01-10","entrada":"2026-01-10","vencimento":"2026-01-26","valor_parcela":176.92,"valor_pago":0,"saldo":176.92,"situacao":"Aberta"}

Situação deve ser "Aberta", "Pago" ou "Parcial". Datas no formato YYYY-MM-DD ou null.
Sem cabeçalho, sem explicações, sem markdown. Apenas as linhas JSON.
Extraia TODOS os registros sem pular nenhum.`

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  const formData = await request.formData()
  const arquivo   = formData.get('arquivo') as File | null
  const substituir = formData.get('substituir') === 'true'

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

        type ContaRaw = {
          fornecedor_codigo?: string; fornecedor_nome: string; documento: string
          emissao?: string | null; entrada?: string | null; vencimento?: string | null
          valor_parcela: number; valor_pago?: number; saldo?: number; situacao: string
        }

        let buf = ''
        const records: ContaRaw[] = []

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
                if (r.fornecedor_nome && r.documento) {
                  records.push(r)
                  await send({ status: 'progress', count: records.length })
                }
              } catch { /* linha parcial */ }
            }
          }
        }
        if (buf.trim()) {
          try {
            const r = JSON.parse(buf.trim())
            if (r.fornecedor_nome) records.push(r)
          } catch {}
        }

        await send({ status: 'processing', msg: `Salvando ${records.length} contas...` })

        if (substituir) {
          await prisma.$executeRawUnsafe(
            `DELETE FROM contas_pagar WHERE cliente_id = $1 AND banco_lancamento_id IS NULL`,
            clienteId
          )
        }

        let inseridos = 0, ignorados = 0
        for (const c of records) {
          const valorParcela = Number(c.valor_parcela) || 0
          const valorPago    = Number(c.valor_pago)    || 0
          const saldo        = c.saldo != null ? Number(c.saldo) : valorParcela - valorPago
          const situacao     = ['Aberta', 'Pago', 'Parcial'].includes(c.situacao) ? c.situacao : 'Aberta'

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
            c.emissao    ?? null,
            c.entrada    ?? null,
            c.vencimento ?? null,
            valorParcela, valorPago, saldo, situacao
          )
          inseridos++
        }

        await send({ status: 'done', inseridos, ignorados, total: records.length })
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
