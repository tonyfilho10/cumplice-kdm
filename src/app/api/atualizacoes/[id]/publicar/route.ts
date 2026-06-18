import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const { data: isAdmin } = await supabase
    .from('usuario_clientes').select('papel').eq('usuario_id', user.id).eq('papel', 'admin').limit(1)
  if (!isAdmin?.length) return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })

  // Publica a atualização
  await prisma.atualizacao.update({
    where: { id },
    data: { publicada: true, publicado_em: new Date() },
  })

  // Busca todos os usuários únicos do sistema
  const { data: usuarios } = await supabase
    .from('usuario_clientes').select('usuario_id')
  const ids = [...new Set((usuarios ?? []).map(u => u.usuario_id))]

  // Cria notificação para cada um
  if (ids.length > 0) {
    await prisma.notificacao.createMany({
      data: ids.map(uid => ({ usuario_id: uid, atualizacao_id: id })),
      skipDuplicates: true,
    })
  }

  return NextResponse.json({ ok: true, notificados: ids.length })
}
