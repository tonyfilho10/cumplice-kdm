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

import {
  LayoutDashboard, ShoppingCart, FileText, FileSpreadsheet, Landmark, CreditCard,
  ScanSearch, TrendingUp, Settings, LogOut, ChevronLeft, ChevronRight, Menu, Building2, Users, Wrench, Search,
  FileDown, BriefcaseBusiness,
} from 'lucide-react'
import MonthPicker from '@/components/MonthPicker'

type Props = {
  clienteAtivo: Cliente | null
  secao: Section
  periodo: string
  onSecao: (s: Section) => void
  onPeriodo: (p: string) => void
  collapsed?: boolean
  onCollapsedChange?: (v: boolean) => void
  /** Papel do usuário no cliente ativo — 'dono' (cliente final) não vê SPED EFD */
  papel?: string | null
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
      { id: 'compras',        icon: ShoppingCart,      label: 'Compras' },
      { id: 'notas',          icon: FileText,          label: 'Notas Fiscais' },
      { id: 'notas-servico',  icon: BriefcaseBusiness, label: 'Notas de Serviço' },
      { id: 'sped',           icon: FileSpreadsheet,   label: 'SPED EFD' },
      { id: 'banco',          icon: Landmark,          label: 'Banco' },
      { id: 'despesas',       icon: CreditCard,        label: 'Despesas' },
    ],
  },
  {
    section: 'Análise',
    items: [
      { id: 'cruzamento', icon: ScanSearch, label: 'Análise de Tendências de Contas', badge: '!' },
      { id: 'projecao',   icon: TrendingUp, label: 'Simulador de Imposto' },
      { id: 'xml-pdf',    icon: FileDown,   label: 'XML → PDF' },
    ],
  },
  {
    section: 'Config',
    items: [
      { id: 'clientes',    icon: Building2, label: 'Empresas' },
      { id: 'usuarios',    icon: Users,     label: 'Usuários' },
      { id: 'ferramentas', icon: Wrench,    label: 'Ferramentas' },
      { id: 'config',      icon: Settings,  label: 'Perfil do Cliente' },
    ],
  },
]

export default function Sidebar(props: Props) {
  const [localCollapsed, setLocalCollapsed] = useState(props.collapsed ?? false)

  // Usa estado externo se fornecido, senão usa local
  const collapsed = props.collapsed !== undefined ? props.collapsed : localCollapsed
  const setCollapsed = (v: boolean) => {
    setLocalCollapsed(v)
    props.onCollapsedChange?.(v)
  }

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          'hidden md:flex flex-col fixed left-0 top-0 h-screen z-50',
          'bg-sidebar border-r border-sidebar-border transition-[width] duration-300 overflow-hidden',
          collapsed ? 'w-16' : 'w-[240px]',
        )}
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
  clienteAtivo, secao, periodo,
  onSecao, onPeriodo, collapsed, setCollapsed, papel,
}: Props & { collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  const router = useRouter()
  const supabase = createClient()

  const ABAS_RESTRITAS = new Set<Section>(['sped', 'notas', 'notas-servico', 'compras', 'config', 'clientes'])
  const semAcessoFiscal = papel === 'dono' || papel === 'standard'
  const navItems = NAV_ITEMS
    .map(group => ({
      ...group,
      items: group.items.filter(i => {
        if (i.id === 'usuarios' && papel !== 'admin') return false
        if (semAcessoFiscal && ABAS_RESTRITAS.has(i.id)) return false
        return true
      }),
    }))

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
        {collapsed ? (
          <span className="text-lg font-black" style={{ color: 'oklch(0.72 0.22 40)' }}>C</span>
        ) : (
          <div className="flex flex-col gap-0">
            <div className="flex items-center gap-0.5 leading-none">
              <span className="text-xl font-black text-sidebar-foreground tracking-tight">CS</span>
              <span className="text-xl font-black tracking-tight" style={{ color: 'oklch(0.72 0.22 40)' }}>HUB</span>
            </div>
            <span className="text-[10px] font-semibold tracking-widest uppercase text-sidebar-foreground/40 leading-none mt-0.5">Cúmplice</span>
          </div>
        )}
      </div>

      {/* Client card — nome + regime, sem selector */}
      {!collapsed && clienteAtivo && (
        <div className="px-3 pt-3">
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

      {/* Sem cliente ativo — indicação sutil */}
      {!collapsed && !clienteAtivo && (
        <div className="mx-3 mt-3 rounded-xl border border-dashed border-border p-3 text-center">
          <p className="text-[11px] text-muted-foreground">Nenhuma empresa selecionada</p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {navItems.map(group => (
          <div key={group.section}>
            {!collapsed ? (
              <p className="text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40 px-4 pt-4 pb-1">
                {group.section}
              </p>
            ) : (
              <div className="h-2" />
            )}
            {group.items.map(item => {
              const Icon = item.icon
              const isActive = secao === item.id
              const btnCls = cn(
                'flex items-center w-full transition-colors text-left rounded-lg',
                collapsed ? 'justify-center py-2.5 px-0 mx-0' : 'gap-2.5 px-3 py-2 mx-1 w-[calc(100%-8px)]',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/10 hover:text-sidebar-foreground',
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
      <div className={cn('py-3', collapsed ? 'px-2' : 'px-3')}>
        <MonthPicker value={periodo} onChange={onPeriodo} collapsed={collapsed} />
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
