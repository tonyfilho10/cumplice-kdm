import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json([])

  const items = await prisma.notificacao.findMany({
    where: { usuario_id: user.id },
    include: { atualizacao: { select: { titulo: true, versao: true } } },
    orderBy: { created_at: 'desc' },
  })
  return NextResponse.json(items)
}

export async function PATCH() {
  // Marca todas como lidas
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })

  await prisma.notificacao.updateMany({
    where: { usuario_id: user.id, lida: false },
    data: { lida: true },
  })
  return NextResponse.json({ ok: true })
}
