import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// PATCH — dono edita mensagem da própria sugestão
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; feedbackId: string }> }
) {
  const { feedbackId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const fb = await prisma.atualizacaoFeedback.findUnique({ where: { id: feedbackId } })
  if (!fb || fb.usuario_id !== user.id) return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })

  const { mensagem } = await request.json() as { mensagem: string }
  if (!mensagem?.trim()) return NextResponse.json({ erro: 'Mensagem obrigatória' }, { status: 400 })

  await prisma.atualizacaoFeedback.update({ where: { id: feedbackId }, data: { mensagem } })
  return NextResponse.json({ ok: true })
}

// DELETE — dono remove a própria sugestão
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; feedbackId: string }> }
) {
  const { feedbackId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const fb = await prisma.atualizacaoFeedback.findUnique({ where: { id: feedbackId } })
  if (!fb || fb.usuario_id !== user.id) return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })

  await prisma.atualizacaoFeedback.delete({ where: { id: feedbackId } })
  return NextResponse.json({ ok: true })
}
