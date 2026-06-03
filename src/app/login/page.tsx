'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setCarregando(true)
    setErro('')

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: senha,
    })

    if (error) {
      // Mensagem mais útil por tipo de erro
      if (error.message.includes('Invalid login') || error.message.includes('invalid_credentials')) {
        setErro('E-mail ou senha incorretos. Verifique os dados e tente novamente.')
      } else if (error.message.includes('Email not confirmed')) {
        setErro('E-mail não confirmado. Entre em contato com o administrador.')
      } else if (error.message.includes('rate limit')) {
        setErro('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
      } else {
        setErro(`Erro ao entrar: ${error.message}`)
      }
      setCarregando(false)
      return
    }

    if (!data.session) {
      setErro('Sessão não iniciada. Tente novamente.')
      setCarregando(false)
      return
    }

    // Reload completo garante que os cookies de sessão sejam lidos pelo proxy SSR
    // router.push() pode navegar antes dos cookies serem gravados no servidor
    window.location.href = '/dashboard'
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-[380px] rounded-2xl border border-border bg-card p-10 shadow-xl">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-3xl font-black text-foreground mb-1">⚡ Cúmplice</div>
          <div className="text-sm text-muted-foreground">Sistema de Inteligência Contábil</div>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="seu@email.com"
              className="h-11 rounded-lg border border-border bg-secondary text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            />
          </div>

          {/* Senha */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Senha
            </label>
            <input
              type="password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="h-11 rounded-lg border border-border bg-secondary text-foreground px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            />
          </div>

          {/* Erro */}
          {erro && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
              {erro}
            </div>
          )}

          {/* Botão */}
          <button
            type="submit"
            disabled={carregando}
            className="mt-1 h-11 rounded-lg bg-primary text-primary-foreground font-bold text-sm transition-opacity disabled:opacity-60 hover:opacity-90"
          >
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
