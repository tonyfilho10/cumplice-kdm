import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const items = await prisma.atualizacao.findMany({
    orderBy: { created_at: 'desc' },
    include: {
      feedbacks: {
        select: {
          id: true, tipo: true, usuario_id: true,
          mensagem: true, nome_usuario: true, status_sugestao: true, created_at: true,
        },
        orderBy: { created_at: 'asc' },
      },
      edicoes: {
        orderBy: { created_at: 'desc' },
        select: { id: true, titulo_antes: true, descricao_antes: true, editado_por: true, created_at: true },
      },
      _count: { select: { notificacoes: true } },
    },
  })
  return NextResponse.json(items)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const { data: rows } = await supabase
    .from('usuario_clientes').select('papel').eq('usuario_id', user.id).eq('papel', 'desenvolvedor').limit(1)
  if (!rows?.length) return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })

  const { titulo, descricao, versao, categoria } = await request.json()
  if (!titulo?.trim() || !descricao?.trim()) {
    return NextResponse.json({ erro: 'Título e descrição obrigatórios' }, { status: 400 })
  }

  const item = await prisma.atualizacao.create({
    data: { titulo, descricao, versao: versao || null, categoria: categoria || 'nova-feature' },
  })
  return NextResponse.json(item)
}
