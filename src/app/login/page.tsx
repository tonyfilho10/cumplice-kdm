'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [mostrarSenha, setMostrarSenha] = useState(false)
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
      if (error.message.includes('Invalid login') || error.message.includes('invalid_credentials')) {
        setErro('E-mail ou senha incorretos.')
      } else if (error.message.includes('Email not confirmed')) {
        setErro('E-mail não confirmado. Entre em contato com o administrador.')
      } else if (error.message.includes('rate limit')) {
        setErro('Muitas tentativas. Aguarde alguns minutos.')
      } else {
        setErro(`Erro: ${error.message}`)
      }
      setCarregando(false)
      return
    }

    if (!data.session) {
      setErro('Sessão não iniciada. Tente novamente.')
      setCarregando(false)
      return
    }

    window.location.href = '/dashboard'
  }

  return (
    <div className="min-h-screen flex bg-background overflow-hidden">

      {/* Painel esquerdo — identidade */}
      <div className="hidden lg:flex flex-col justify-between w-[480px] shrink-0 bg-card border-r border-border px-12 py-16">
        <div>
          <div className="flex items-center gap-2.5 mb-16">
            <span className="text-2xl">⚡</span>
            <span className="text-xl font-black text-foreground tracking-tight">Cúmplice</span>
          </div>

          <div className="space-y-6">
            <h1 className="text-3xl font-bold text-foreground leading-snug">
              Inteligência contábil<br />
              <span className="text-primary">para quem entende</span><br />
              de números.
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
              Cruzamento automático de NF-e × banco, diagnóstico tributário e análise em tempo real.
            </p>
          </div>
        </div>

        {/* Features */}
        <div className="space-y-4">
          {[
            { icon: '🔍', label: 'Cruzamento NF × Banco automático' },
            { icon: '📊', label: 'KPIs e alertas fiscais em tempo real' },
            { icon: '📈', label: 'Projeção Simples × Presumido × Real' },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-3">
              <span className="text-base">{f.icon}</span>
              <span className="text-sm text-muted-foreground">{f.label}</span>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/50">
          © 2026 Cúmplice · Inteligência Contábil
        </p>
      </div>

      {/* Painel direito — formulário */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">

        {/* Logo mobile */}
        <div className="flex lg:hidden items-center gap-2 mb-10">
          <span className="text-2xl">⚡</span>
          <span className="text-xl font-black text-foreground">Cúmplice</span>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground">Bem-vindo de volta</h2>
            <p className="text-sm text-muted-foreground mt-1">Entre com suas credenciais para continuar</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                placeholder="seu@email.com"
                className="w-full h-11 rounded-xl border border-border bg-secondary text-foreground px-4 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
              />
            </div>

            {/* Senha */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Senha
              </label>
              <div className="relative">
                <input
                  type={mostrarSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full h-11 rounded-xl border border-border bg-secondary text-foreground px-4 pr-10 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {mostrarSenha ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Erro */}
            {erro && (
              <div className="flex items-center gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                <svg className="h-4 w-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-sm text-red-400">{erro}</p>
              </div>
            )}

            {/* Botão */}
            <button
              type="submit"
              disabled={carregando || !email || !senha}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-bold text-sm transition-all disabled:opacity-50 hover:opacity-90 active:scale-[.98] flex items-center justify-center gap-2 mt-2"
            >
              {carregando ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Entrando...
                </>
              ) : (
                <>
                  Entrar
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
