import { NextRequest, NextResponse } from 'next/server'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { cruzarFornecedores } from '@/lib/matching/fornecedores'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params

  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const { periodo } = await request.json().catch(() => ({}))

    // Se vier período específico, usa ele; caso contrário pega todos os períodos com saídas abertas
    let periodos: string[]
    if (periodo) {
      periodos = [periodo]
    } else {
      const rows = await prisma.bancoLancamento.groupBy({
        by: ['periodo'],
        where: {
          cliente_id: clienteId,
          tipo: 'saida',
          status: { in: ['pendente', 'sem_nf'] },
          nota_fiscal_id: null,
        },
      })
      periodos = rows.map(r => r.periodo)
    }

    if (periodos.length === 0) {
      return NextResponse.json({ baixas: 0, mensagem: 'Nenhuma saída sem NF encontrada.' })
    }

    const baixas = await cruzarFornecedores(clienteId, periodos)

    return NextResponse.json({
      baixas,
      periodos,
      mensagem: baixas > 0
        ? `${baixas} pagamento(s) vinculado(s) automaticamente.`
        : 'Nenhum match encontrado com os critérios atuais.',
    })
  } catch (err) {
    console.error('[cruzar-fornecedores]', err)
    return NextResponse.json({ erro: 'Erro interno ao cruzar fornecedores' }, { status: 500 })
  }
}
