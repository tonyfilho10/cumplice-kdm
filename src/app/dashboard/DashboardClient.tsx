'use client'

import { useState, useEffect } from 'react'
import type { Cliente } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import Sidebar from '@/components/Sidebar'
import VisaoGeral from '@/components/sections/VisaoGeral'
import Compras from '@/components/sections/Compras'
import NotasFiscais from '@/components/sections/NotasFiscais'
import Banco from '@/components/sections/Banco'
import Despesas from '@/components/sections/Despesas'
import Cruzamento from '@/components/sections/Cruzamento'
import Projecao from '@/components/sections/Projecao'
import Config from '@/components/sections/Config'
import Clientes from '@/components/sections/Clientes'
import { RefreshCw } from 'lucide-react'

export type Section =
  | 'visao-geral' | 'compras' | 'notas' | 'banco'
  | 'despesas' | 'cruzamento' | 'projecao' | 'config' | 'clientes'

const SECTION_TITLES: Record<Section, [string, string]> = {
  'visao-geral': ['Visão Geral', 'Painel de alertas e KPIs do mês'],
  'compras':     ['Compras', 'Registro de compras e notas de entrada'],
  'notas':       ['Notas Fiscais', 'NFs emitidas no período'],
  'banco':       ['Banco', 'Movimentações bancárias'],
  'despesas':    ['Despesas', 'Despesas operacionais do mês'],
  'cruzamento':  ['Cruzamento de Dados', 'Divergências identificadas automaticamente'],
  'projecao':    ['Projeção Tributária', 'Estimativa de impostos e recomendações'],
  'config':      ['Perfil do Cliente', 'Configurações e thresholds de alerta'],
  'clientes':    ['Gerenciar Empresas', 'Criar, editar e desativar clientes'],
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

// Detecta se sidebar está collapsed para ajustar o margin
function useSidebarWidth() {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const aside = document.querySelector('aside')
      setCollapsed(aside?.classList.contains('w-\\[64px\\]') ?? false)
    })
    const aside = document.querySelector('aside')
    if (aside) obs.observe(aside, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return collapsed
}

export default function DashboardClient({ clientes }: { clientes: Cliente[] }) {
  const [clienteAtivo, setClienteAtivo] = useState<Cliente | null>(clientes[0] || null)
  const [secao, setSecao] = useState<Section>('visao-geral')
  const [periodo, setPeriodo] = useState(PERIODOS_LISTA[0].value)
  const [refresh, setRefresh] = useState(0)
  const sidebarCollapsed = useSidebarWidth()

  function recarregar() { setRefresh(r => r + 1) }

  if (!clienteAtivo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-base font-medium mb-1">Nenhum cliente cadastrado</p>
          <p className="text-sm">Adicione um cliente para começar</p>
        </div>
      </div>
    )
  }

  const [titulo, subtitulo] = SECTION_TITLES[secao]
  const sectionProps = { clienteId: clienteAtivo.id, periodo, refresh, onRecarregar: recarregar }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        clientes={clientes}
        clienteAtivo={clienteAtivo}
        secao={secao}
        periodo={periodo}
        onCliente={setClienteAtivo}
        onSecao={setSecao}
        onPeriodo={setPeriodo}
      />

      {/* Main — offset dinâmico baseado na sidebar */}
      <main className={cn(
        'flex-1 flex flex-col min-h-screen transition-all duration-300',
        'md:ml-[240px]', // fallback; JS ajusta
      )}
        style={{ marginLeft: sidebarCollapsed ? 64 : 240 }}
      >
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3.5 bg-card border-b border-border">
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">{titulo}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {subtitulo} · {clienteAtivo.razao_social}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={recarregar} className="gap-2 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        </header>

        {/* Content */}
        <div className="flex-1 p-6">
          {secao === 'visao-geral' && <VisaoGeral {...sectionProps} cliente={clienteAtivo} />}
          {secao === 'compras'     && <Compras {...sectionProps} />}
          {secao === 'notas'       && <NotasFiscais {...sectionProps} />}
          {secao === 'banco'       && <Banco {...sectionProps} />}
          {secao === 'despesas'    && <Despesas {...sectionProps} />}
          {secao === 'cruzamento'  && <Cruzamento {...sectionProps} />}
          {secao === 'projecao'    && <Projecao {...sectionProps} cliente={clienteAtivo} />}
          {secao === 'config'      && <Config {...sectionProps} cliente={clienteAtivo} onAtualizar={recarregar} />}
          {secao === 'clientes'    && <Clientes {...sectionProps} />}
        </div>
      </main>
    </div>
  )
}
