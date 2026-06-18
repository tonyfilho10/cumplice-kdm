import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const { tipo, mensagem } = await request.json() as { tipo: 'aprovado' | 'sugestao'; mensagem?: string }
  if (!['aprovado', 'sugestao'].includes(tipo)) {
    return NextResponse.json({ erro: 'Tipo inválido' }, { status: 400 })
  }

  const fb = await prisma.atualizacaoFeedback.upsert({
    where: { atualizacao_id_usuario_id: { atualizacao_id: id, usuario_id: user.id } },
    create: { atualizacao_id: id, usuario_id: user.id, tipo, mensagem: mensagem ?? null },
    update: { tipo, mensagem: mensagem ?? null },
  })

  return NextResponse.json(fb)
}
