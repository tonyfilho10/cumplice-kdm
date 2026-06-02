'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { createClient } from '@/lib/supabase/client'
import type { Cliente } from '@/lib/supabase/types'
import type { Section } from '@/app/dashboard/DashboardClient'
import { PERIODOS_LISTA } from '@/app/dashboard/DashboardClient'
import {
  LayoutDashboard, ShoppingCart, FileText, Landmark, CreditCard,
  ScanSearch, TrendingUp, Settings, LogOut, ChevronLeft, ChevronRight, Menu, Building2,
} from 'lucide-react'

type Props = {
  clientes: Cliente[]
  clienteAtivo: Cliente
  secao: Section
  periodo: string
  onCliente: (c: Cliente) => void
  onSecao: (s: Section) => void
  onPeriodo: (p: string) => void
}

type NavItem = { id: Section; icon: React.ElementType; label: string; badge?: string }

const NAV_ITEMS: { section: string; items: NavItem[] }[] = [
  {
    section: 'Painel',
    items: [{ id: 'visao-geral', icon: LayoutDashboard, label: 'Visão Geral' }],
  },
  {
    section: 'Lançamentos',
    items: [
      { id: 'compras',  icon: ShoppingCart, label: 'Compras' },
      { id: 'notas',    icon: FileText,     label: 'Notas Fiscais' },
      { id: 'banco',    icon: Landmark,     label: 'Banco' },
      { id: 'despesas', icon: CreditCard,   label: 'Despesas' },
    ],
  },
  {
    section: 'Análise',
    items: [
      { id: 'cruzamento', icon: ScanSearch, label: 'Cruzamento', badge: '!' },
      { id: 'projecao',   icon: TrendingUp, label: 'Projeção Tributária' },
    ],
  },
  {
    section: 'Config',
    items: [
      { id: 'clientes', icon: Building2, label: 'Empresas' },
      { id: 'config',   icon: Settings,  label: 'Perfil do Cliente' },
    ],
  },
]

export default function Sidebar(props: Props) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          'hidden md:flex flex-col fixed left-0 top-0 h-screen z-50',
          'bg-sidebar border-r border-sidebar-border transition-[width] duration-300 overflow-hidden',
          collapsed ? 'w-16' : 'w-[240px]',
        )}
        data-collapsed={collapsed}
      >
        <SidebarContent {...props} collapsed={collapsed} setCollapsed={setCollapsed} />
      </aside>

      {/* Mobile */}
      <div className="md:hidden fixed top-3 left-3 z-50">
        <Sheet>
          <SheetTrigger render={
            <Button variant="outline" size="icon" className="bg-card border-border h-9 w-9" />
          }>
            <Menu className="h-4 w-4" />
          </SheetTrigger>
          <SheetContent className="p-0 w-[260px] bg-sidebar border-sidebar-border">
            <SidebarContent {...props} collapsed={false} setCollapsed={() => {}} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}

function SidebarContent({
  clientes, clienteAtivo, secao, periodo,
  onCliente, onSecao, onPeriodo, collapsed, setCollapsed,
}: Props & { collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Logo */}
      <div className={cn(
        'flex items-center gap-2.5 py-5 border-b border-sidebar-border',
        collapsed ? 'justify-center px-0' : 'px-4',
      )}>
        <span className="text-xl shrink-0">⚡</span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-bold text-[15px] text-sidebar-foreground leading-none">Cúmplice</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Inteligência Contábil</p>
          </div>
        )}
      </div>

      {/* Client selector */}
      {!collapsed && (
        <div className="px-3 pt-3 space-y-2">
          <select
            value={clienteAtivo.id}
            onChange={e => {
              const c = clientes.find(cl => cl.id === e.target.value)
              if (c) onCliente(c)
            }}
            className="w-full h-8 rounded-md border border-border bg-secondary text-sidebar-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            {clientes.map(c => (
              <option key={c.id} value={c.id}>{c.razao_social}</option>
            ))}
          </select>

          {/* Client card */}
          <div className="rounded-xl bg-secondary border border-border p-3 space-y-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest text-amber-900 bg-gradient-to-r from-amber-400 to-amber-600 px-2 py-0.5 rounded-full">
              ★ Prime
            </span>
            <p className="text-[13px] font-semibold text-sidebar-foreground leading-tight">{clienteAtivo.razao_social}</p>
            <p className="text-[11px] text-muted-foreground">CNPJ: {clienteAtivo.cnpj}</p>
            <span className="inline-block text-[11px] bg-primary/15 text-primary px-2 py-0.5 rounded-md">
              {clienteAtivo.regime}
            </span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {NAV_ITEMS.map(group => (
          <div key={group.section}>
            {!collapsed ? (
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-4 pt-4 pb-1">
                {group.section}
              </p>
            ) : (
              <div className="h-2" />
            )}
            {group.items.map(item => {
              const Icon = item.icon
              const isActive = secao === item.id
              const btnCls = cn(
                'flex items-center w-full transition-colors text-left',
                collapsed ? 'justify-center py-2.5 px-0' : 'gap-2.5 px-4 py-2',
                isActive
                  ? 'bg-primary/10 text-primary border-l-[3px] border-primary'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground border-l-[3px] border-transparent',
              )
              return collapsed ? (
                <Tooltip key={item.id}>
                  <TooltipTrigger render={<button className={btnCls} onClick={() => onSecao(item.id)} />}>
                    <Icon className="h-[17px] w-[17px]" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                <button key={item.id} className={btnCls} onClick={() => onSecao(item.id)}>
                  <Icon className="h-[17px] w-[17px] shrink-0" />
                  <span className="text-[13px] font-medium flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="text-[10px] font-bold bg-orange-500 text-white px-1.5 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <Separator className="bg-sidebar-border" />

      {/* Period selector */}
      <div className="px-3 py-3">
        {!collapsed ? (
          <select
            value={periodo}
            onChange={e => onPeriodo(e.target.value)}
            className="w-full h-8 rounded-md border border-border bg-secondary text-sidebar-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            {PERIODOS_LISTA.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        ) : (
          <Tooltip>
            <TooltipTrigger render={
              <button className="w-full flex justify-center text-muted-foreground hover:text-sidebar-foreground py-1 text-[11px] font-mono" />
            }>
              {periodo.substring(5)}
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {PERIODOS_LISTA.find(p => p.value === periodo)?.label}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Logout + toggle */}
      <div className={cn(
        'flex items-center border-t border-sidebar-border px-3 py-3 gap-2',
        collapsed && 'flex-col px-2',
      )}>
        <Tooltip>
          <TooltipTrigger render={
            <Button
              variant="ghost"
              size={collapsed ? 'icon' : 'sm'}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={handleLogout}
            />
          }>
            <LogOut className="h-4 w-4" />
            {!collapsed && <span className="ml-1 text-xs">Sair</span>}
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right" className="text-xs">Sair</TooltipContent>}
        </Tooltip>

        <Tooltip>
          <TooltipTrigger render={
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto text-muted-foreground hover:text-sidebar-foreground"
              onClick={() => setCollapsed(!collapsed)}
            />
          }>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {collapsed ? 'Expandir' : 'Recolher'}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
