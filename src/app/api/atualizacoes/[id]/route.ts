import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// PATCH — editar atualização publicada (só desenvolvedor)
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

  const { titulo, descricao } = await request.json()
  if (!titulo?.trim() || !descricao?.trim()) {
    return NextResponse.json({ erro: 'Título e descrição obrigatórios' }, { status: 400 })
  }

  const atual = await prisma.atualizacao.findUnique({ where: { id } })
  if (!atual) return NextResponse.json({ erro: 'Não encontrado' }, { status: 404 })

  await prisma.$transaction([
    // Salva histórico antes de editar
    prisma.atualizacaoEdicao.create({
      data: {
        atualizacao_id: id,
        titulo_antes: atual.titulo,
        descricao_antes: atual.descricao,
        editado_por: user.id,
      },
    }),
    prisma.atualizacao.update({
      where: { id },
      data: { titulo, descricao, editado_em: new Date() },
    }),
  ])

  return NextResponse.json({ ok: true })
}
