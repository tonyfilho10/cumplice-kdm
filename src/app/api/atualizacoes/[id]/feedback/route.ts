import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// POST — enviar feedback (aprovado / sugestao)
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

// PATCH — desenvolvedor atualiza status de uma sugestão
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const { data: rows } = await supabase
    .from('usuario_clientes').select('papel').eq('usuario_id', user.id).eq('papel', 'desenvolvedor').limit(1)
  if (!rows?.length) return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })

  const { feedback_id, status_sugestao } = await request.json() as {
    feedback_id: string
    status_sugestao: 'nao_lida' | 'em_andamento' | 'resolvida'
  }
  if (!['nao_lida', 'em_andamento', 'resolvida'].includes(status_sugestao)) {
    return NextResponse.json({ erro: 'Status inválido' }, { status: 400 })
  }

  await prisma.atualizacaoFeedback.update({
    where: { id: feedback_id },
    data: { status_sugestao },
  })

  return NextResponse.json({ ok: true })
}
