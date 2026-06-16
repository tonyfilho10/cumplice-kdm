'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Cliente } from '@/lib/supabase/types'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import Sidebar from '@/components/Sidebar'
import VisaoGeral from '@/components/sections/VisaoGeral'
import Compras from '@/components/sections/Compras'
import NotasFiscais from '@/components/sections/NotasFiscais'
import Sped from '@/components/sections/Sped'
import Banco from '@/components/sections/Banco'
import Despesas from '@/components/sections/Despesas'
import Cruzamento from '@/components/sections/Cruzamento'
import Projecao from '@/components/sections/Projecao'
import Config from '@/components/sections/Config'
import Clientes from '@/components/sections/Clientes'
import Usuarios from '@/components/sections/Usuarios'
import Ferramentas from '@/components/sections/Ferramentas'
import BuscaLancamentos from '@/components/sections/BuscaLancamentos'
import XmlParaPdf from '@/components/sections/XmlParaPdf'
import NotasServico from '@/components/sections/NotasServico'
import { RefreshCw, Building2, ArrowRight } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'

export type Section =
  | 'visao-geral' | 'compras' | 'notas' | 'notas-servico' | 'sped' | 'banco'
  | 'despesas' | 'cruzamento' | 'projecao' | 'config' | 'clientes' | 'usuarios' | 'ferramentas' | 'busca' | 'xml-pdf'

const SECTION_TITLES: Record<Section, [string, string]> = {
  'visao-geral': ['Visão Geral', 'Painel de alertas e KPIs do mês'],
  'compras':       ['Compras', 'Registro de compras e notas de entrada'],
  'notas':         ['Notas Fiscais', 'NFs emitidas no período'],
  'notas-servico': ['Notas de Serviço', 'NFS-e recebidas no período'],
  'sped':        ['SPED EFD', 'Importação e documentos da escrituração fiscal digital'],
  'banco':       ['Banco', 'Movimentações bancárias'],
  'despesas':    ['Despesas', 'Despesas operacionais do mês'],
  'cruzamento':  ['Análise de Tendências de Contas', 'Divergências identificadas automaticamente'],
  'projecao':    ['Simulador de Imposto', 'Estimativa de impostos e recomendações'],
  'config':      ['Perfil do Cliente', 'Configurações e thresholds de alerta'],
  'clientes':    ['Gerenciar Empresas', 'Criar, editar e desativar clientes'],
  'usuarios':    ['Gerenciar Usuários', 'Criar, editar e remover acessos'],
  'ferramentas': ['Ferramentas', 'Utilitários de manutenção e limpeza de dados'],
  'busca':       ['Buscar Lançamentos', 'Busca e gestão de compras e notas fiscais'],
  'xml-pdf':     ['XML → PDF', 'Converte XMLs de NF-e em PDF para análise de produtos e CFOP'],
}

// Gera lista de períodos: mês atual + 11 meses anteriores
function gerarPeriodos(): { value: string; label: string }[] {
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const periodos = []
  const hoje = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${meses[d.getMonth()]} / ${d.getFullYear()}`
    periodos.push({ value, label })
  }
  return periodos
}

export const PERIODOS_LISTA = gerarPeriodos()

export default function DashboardClient({ clientes }: { clientes: Cliente[] }) {
  const semCliente = clientes.length === 0
  const [clienteAtivo, setClienteAtivo] = useState<Cliente | null>(clientes[0] || null)
  const [secao, setSecao] = useState<Section>(semCliente ? 'clientes' : 'visao-geral')
  const [periodo, setPeriodo] = useState(PERIODOS_LISTA[0].value)
  const [refresh, setRefresh] = useState(0)
  const [atualizando, setAtualizando] = useState(false)
  // Collapsed state compartilhado entre Sidebar e main (evita hack de DOM)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Seções que precisam de um cliente ativo
  const SECOES_COM_CLIENTE: Section[] = ['visao-geral','compras','notas','notas-servico','sped','banco','despesas','cruzamento','projecao','config']
  const precisaCliente = SECOES_COM_CLIENTE.includes(secao)

  const supabase = createClient()
  const [isAdmin, setIsAdmin] = useState(false)
  const [papel, setPapel] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !clienteAtivo) return
      supabase.from('usuario_clientes')
        .select('papel').eq('usuario_id', user.id).eq('papel', 'admin').limit(1)
        .then(({ data }) => setIsAdmin((data || []).length > 0))
      supabase.from('usuario_clientes')
        .select('papel').eq('usuario_id', user.id).eq('cliente_id', clienteAtivo.id).limit(1)
        .then(({ data }) => setPapel(data?.[0]?.papel ?? null))
    })
  }, [clienteAtivo?.id])

  // Sócio/Dono e Standard não têm acesso às abas fiscais/contábeis
  useEffect(() => {
    const abasRestritas = new Set<Section>(['sped', 'notas', 'compras', 'config', 'clientes'])
    if ((papel === 'dono' || papel === 'standard') && abasRestritas.has(secao)) setSecao('visao-geral')
  }, [papel, secao])

  // Recarrega dados do cliente ativo do banco (para refletir edições do Config)
  const refetchCliente = useCallback(async () => {
    if (!clienteAtivo?.id) return
    const { data } = await supabase.from('clientes').select('*').eq('id', clienteAtivo.id).single()
    if (data) setClienteAtivo(data as Cliente)
  }, [clienteAtivo?.id])

  async function recarregar() {
    setAtualizando(true)
    setRefresh(r => r + 1)
    await refetchCliente()
    setTimeout(() => setAtualizando(false), 600)
  }

  const [titulo, subtitulo] = SECTION_TITLES[secao]
  const sectionProps = { clienteId: clienteAtivo?.id ?? '', periodo, refresh, onRecarregar: recarregar }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        clienteAtivo={clienteAtivo}
        secao={secao}
        periodo={periodo}
        onSecao={setSecao}
        onPeriodo={setPeriodo}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        papel={papel}
      />

      {/* Main — offset dinâmico baseado na sidebar */}
      <main
        className="flex-1 flex flex-col min-h-screen transition-[margin] duration-300"
        style={{ marginLeft: sidebarCollapsed ? 64 : 240 }}
      >
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3.5 bg-card border-b border-border">
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">{titulo}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {subtitulo}{clienteAtivo ? ` · ${clienteAtivo.razao_social}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={recarregar} disabled={atualizando} className="gap-2 text-xs">
              <RefreshCw className={`h-3.5 w-3.5 ${atualizando ? 'animate-spin' : ''}`} />
              {atualizando ? 'Atualizando...' : 'Atualizar'}
            </Button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 p-6">
          {/* Seções sem cliente */}
          {secao === 'clientes' && (
            <Clientes
              {...sectionProps}
              onEntrarCliente={c => {
                setClienteAtivo(c)
                setSecao('visao-geral')
              }}
            />
          )}
          {secao === 'usuarios'    && <Usuarios {...sectionProps} />}
          {secao === 'ferramentas' && <Ferramentas {...sectionProps} isAdmin={isAdmin} />}
          {secao === 'busca'       && <BuscaLancamentos {...sectionProps} />}
          {secao === 'xml-pdf'     && <XmlParaPdf clienteId={clienteAtivo?.id} />}

          {/* Seções que precisam de cliente */}
          {precisaCliente && !clienteAtivo && (
            <SemCliente onIrParaEmpresas={() => setSecao('clientes')} />
          )}
          {precisaCliente && clienteAtivo && (
            <>
              {secao === 'visao-geral' && <VisaoGeral {...sectionProps} cliente={clienteAtivo} />}
              {secao === 'compras'       && <Compras {...sectionProps} />}
              {secao === 'notas'         && <NotasFiscais {...sectionProps} />}
              {secao === 'notas-servico' && <NotasServico {...sectionProps} />}
              {secao === 'sped'        && <Sped {...sectionProps} />}
              {secao === 'banco'       && <Banco {...sectionProps} />}
              {secao === 'despesas'    && <Despesas {...sectionProps} />}
              {secao === 'cruzamento'  && <Cruzamento {...sectionProps} />}
              {secao === 'projecao'    && <Projecao {...sectionProps} cliente={clienteAtivo} />}
              {secao === 'config'      && <Config {...sectionProps} cliente={clienteAtivo} onAtualizar={recarregar} />}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

// ─── Tela de onboarding quando não há cliente selecionado ─────────────────────
function SemCliente({ onIrParaEmpresas }: { onIrParaEmpresas: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-6">
      <div className="p-5 rounded-2xl bg-primary/10 border border-primary/20">
        <Building2 className="h-12 w-12 text-primary mx-auto" />
      </div>

      <div>
        <h2 className="text-xl font-bold text-foreground mb-2">
          Bem-vindo ao Sistema Cúmplice
        </h2>
        <p className="text-muted-foreground text-sm max-w-md">
          Para começar a usar o sistema, você precisa cadastrar a primeira empresa.
          O dashboard completo ficará disponível depois disso.
        </p>
      </div>

      <Button onClick={onIrParaEmpresas} size="lg" className="gap-2">
        <Building2 className="h-4 w-4" />
        Cadastrar primeira empresa
        <ArrowRight className="h-4 w-4" />
      </Button>

      <div className="grid grid-cols-3 gap-4 mt-4 max-w-xl w-full">
        {[
          { emoji: '📊', titulo: 'Dashboard', desc: 'KPIs e alertas em tempo real' },
          { emoji: '🔍', titulo: 'Cruzamento', desc: 'NF × Banco automático' },
          { emoji: '📈', titulo: 'Projeção', desc: 'Simples × Presumido' },
        ].map(item => (
          <div key={item.titulo} className="rounded-xl border border-border bg-card p-4 text-left opacity-50">
            <p className="text-2xl mb-2">{item.emoji}</p>
            <p className="text-sm font-semibold text-foreground">{item.titulo}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
