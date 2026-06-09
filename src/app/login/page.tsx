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

      {/* ── Painel esquerdo — navy marinho CSHub ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[480px] shrink-0 px-12 py-16"
        style={{ background: 'linear-gradient(160deg, #0C1E3E 60%, #0F2A52 100%)' }}
      >
        {/* Logo */}
        <div>
          <div className="flex items-center gap-3 mb-14">
            {/* Ícone CSHub — hexágono laranja */}
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'oklch(0.72 0.22 40)' }}>
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <span className="text-xl font-black text-white tracking-tight">Cúmplice</span>
              <span className="block text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'oklch(0.72 0.22 40)' }}>by CSHub</span>
            </div>
          </div>

          <div className="space-y-5">
            <h1 className="text-4xl font-black text-white leading-tight">
              Inteligência<br />
              <span style={{ color: 'oklch(0.80 0.20 40)' }}>contábil</span><br />
              que trabalha<br />
              por você.
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'oklch(0.70 0.02 240)' }}>
              Cruzamento automático de NF-e × banco, diagnóstico tributário e análise fiscal em tempo real.
            </p>
          </div>

          {/* Divisor laranja */}
          <div className="mt-10 mb-8 h-0.5 w-12 rounded" style={{ background: 'oklch(0.72 0.22 40)' }} />

          {/* Features */}
          <div className="space-y-5">
            {[
              { icon: '⚡', label: 'Cruzamento NF × Banco automático' },
              { icon: '📊', label: 'KPIs e alertas fiscais em tempo real' },
              { icon: '📈', label: 'Projeção Simples × Presumido × Real' },
              { icon: '🔗', label: 'SPED EFD integrado ao fluxo de caixa' },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-3">
                <span className="text-base leading-none">{f.icon}</span>
                <span className="text-sm" style={{ color: 'oklch(0.75 0.02 240)' }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px]" style={{ color: 'oklch(0.45 0.02 240)' }}>
          © 2026 CSHub · Todos os direitos reservados
        </p>
      </div>

      {/* ── Painel direito — formulário ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">

        {/* Logo mobile */}
        <div className="flex lg:hidden items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'oklch(0.72 0.22 40)' }}>
            <svg viewBox="0 0 24 24" className="w-4 h-4">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-xl font-black text-foreground">Cúmplice</span>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-3xl font-black text-foreground">Bem-vindo</h2>
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

            {/* Botão — laranja CSHub */}
            <button
              type="submit"
              disabled={carregando || !email || !senha}
              className="w-full h-11 rounded-xl font-bold text-sm transition-all disabled:opacity-50 hover:opacity-90 active:scale-[.98] flex items-center justify-center gap-2 mt-2 text-white"
              style={{ background: carregando ? undefined : 'oklch(0.72 0.22 40)', backgroundColor: carregando ? undefined : undefined }}
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

          <p className="text-center text-[11px] text-muted-foreground/50 mt-8">
            Cúmplice · Powered by CSHub
          </p>
        </div>
      </div>
    </div>
  )
}
