// Garante que o usuário está autenticado (acesso global a todos os clientes)
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function guardCliente(_clienteId: string): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ erro: 'Não autenticado' }, { status: 401 }),
    }
  }

  return { ok: true, userId: user.id }
}
