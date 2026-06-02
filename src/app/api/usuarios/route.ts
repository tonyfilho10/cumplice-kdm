import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// GET /api/usuarios
export async function GET() {
  const authUser = await getAuthUser()
  if (!authUser) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const vinculos = await prisma.usuarioCliente.findMany({
    where: { usuario_id: authUser.id },
    select: { cliente_id: true },
  })
  const clienteIds = vinculos.map(v => v.cliente_id)

  const uc = await prisma.usuarioCliente.findMany({
    where: { cliente_id: { in: clienteIds } },
  })

  const usuarioIds = [...new Set(uc.map(u => u.usuario_id))]

  const usuarios = await prisma.$queryRaw<{
    id: string; email: string; created_at: Date; last_sign_in_at: Date | null
  }[]>`
    SELECT id, email, created_at, last_sign_in_at
    FROM auth.users
    WHERE id = ANY(${usuarioIds}::uuid[])
    ORDER BY email
  `

  return NextResponse.json(
    usuarios.map(u => ({ ...u, vinculos: uc.filter(v => v.usuario_id === u.id) }))
  )
}

// POST /api/usuarios — cria usuário via signUp oficial + confirma + vincula
export async function POST(request: NextRequest) {
  const authUser = await getAuthUser()
  if (!authUser) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const { email, senha, cliente_ids, papel } = await request.json()

  if (!email || !senha) return NextResponse.json({ erro: 'E-mail e senha são obrigatórios' }, { status: 400 })
  if (!cliente_ids?.length) return NextResponse.json({ erro: 'Selecione ao menos um cliente' }, { status: 400 })

  // Verifica se já existe
  const existente = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM auth.users WHERE email = ${email} LIMIT 1
  `
  if (existente.length > 0) return NextResponse.json({ erro: 'E-mail já cadastrado' }, { status: 409 })

  // Cria via signUp — GoTrue cria auth.users + auth.identities corretamente
  const supabaseAnon = (await import('@supabase/supabase-js')).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data, error } = await supabaseAnon.auth.signUp({ email, password: senha })

  if (error || !data.user) {
    return NextResponse.json({ erro: error?.message || 'Falha ao criar usuário' }, { status: 500 })
  }

  const userId = data.user.id

  // Confirma o e-mail automaticamente (sem esperar e-mail de confirmação)
  await prisma.$executeRaw`
    UPDATE auth.users
    SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()), updated_at = NOW()
    WHERE id = ${userId}::uuid
  `

  // Vincula aos clientes
  for (const clienteId of (cliente_ids as string[])) {
    await prisma.usuarioCliente.upsert({
      where: { usuario_id_cliente_id: { usuario_id: userId, cliente_id: clienteId } },
      update: { papel: papel || 'contador' },
      create: { usuario_id: userId, cliente_id: clienteId, papel: papel || 'contador' },
    })
  }

  return NextResponse.json({ id: userId, email })
}
