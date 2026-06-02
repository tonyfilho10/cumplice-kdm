import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Cliente } from '@/lib/supabase/types'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Todos os usuários autenticados têm acesso a todas as empresas ativas
  const { data: clientes } = await supabase
    .from('clientes')
    .select('*')
    .eq('ativo', true)
    .order('razao_social')

  return <DashboardClient clientes={(clientes || []) as Cliente[]} />
}
