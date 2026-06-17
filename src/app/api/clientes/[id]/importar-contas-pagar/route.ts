import { NextRequest, NextResponse } from 'next/server'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const maxDuration = 30

type Registro = {
  fornecedor_codigo: string; fornecedor_nome: string; documento: string
  vencimento: string | null; valor_parcela: number; valor_pago: number
  saldo: number; situacao: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const { registros, substituir } = await request.json() as { registros: Registro[]; substituir?: boolean }
    if (!registros?.length) return NextResponse.json({ erro: 'Nenhum registro recebido' }, { status: 400 })

    if (substituir) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM contas_pagar WHERE cliente_id = $1 AND banco_lancamento_id IS NULL`,
        clienteId
      )
    }

    const existentes = substituir ? [] : await prisma.$queryRawUnsafe<{ fornecedor_nome: string; documento: string }[]>(
      `SELECT fornecedor_nome, documento FROM contas_pagar WHERE cliente_id = $1`,
      clienteId
    )
    const existSet = new Set(existentes.map(e => `${e.fornecedor_nome}||${e.documento}`))
    const novos    = registros.filter(r => !existSet.has(`${r.fornecedor_nome}||${r.documento}`))
    const ignorados = registros.length - novos.length

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

    return NextResponse.json({ inseridos: novos.length, ignorados, total: registros.length })
  } catch (err) {
    console.error('[importar-contas-pagar]', err)
    return NextResponse.json({ erro: err instanceof Error ? err.message : 'Erro ao importar' }, { status: 500 })
  }
}
