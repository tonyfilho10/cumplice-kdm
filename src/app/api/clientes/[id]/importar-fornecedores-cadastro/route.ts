import { NextRequest, NextResponse } from 'next/server'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'

export const maxDuration = 30

type Registro = { codigo: string; cnpj: string; nome: string }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const { registros } = await request.json() as { registros: Registro[] }
    if (!registros?.length) return NextResponse.json({ erro: 'Nenhum registro recebido' }, { status: 400 })

    let inseridos = 0, atualizados = 0
    const BATCH = 200

    for (let i = 0; i < registros.length; i += BATCH) {
      const batch = registros.slice(i, i + BATCH)
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

    return NextResponse.json({ inseridos, atualizados, total: registros.length })
  } catch (err) {
    console.error('[importar-fornecedores-cadastro]', err)
    return NextResponse.json({ erro: err instanceof Error ? err.message : 'Erro ao importar' }, { status: 500 })
  }
}
