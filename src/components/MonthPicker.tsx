'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

const MESES_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

type Props = {
  value: string           // "YYYY-MM"
  onChange: (v: string) => void
  collapsed?: boolean     // modo sidebar recolhida
}

export default function MonthPicker({ value, onChange, collapsed = false }: Props) {
  const [ano, setAno] = useState(() => {
    const y = parseInt(value?.substring(0, 4) || '0')
    return isNaN(y) ? new Date().getFullYear() : y
  })
  const [open, setOpen] = useState(false)

  const mesAtual  = parseInt(value?.substring(5, 7) || '0') - 1   // 0-indexed
  const anoAtual  = parseInt(value?.substring(0, 4) || '0')

  const hoje      = new Date()
  const anoHoje   = hoje.getFullYear()
  const mesHoje   = hoje.getMonth() // 0-indexed

  function selecionar(mes: number) {
    const mm = String(mes + 1).padStart(2, '0')
    onChange(`${ano}-${mm}`)
    setOpen(false)
  }

  const label = value
    ? `${MESES_FULL[parseInt(value.substring(5, 7)) - 1]} / ${value.substring(0, 4)}`
    : 'Selecionar período'

  const trigger = collapsed ? (
    // Modo colapsado: apenas ícone
    <PopoverTrigger render={
      <button className="w-full flex justify-center text-muted-foreground hover:text-sidebar-foreground py-1" />
    }>
      <CalendarDays className="h-4 w-4" />
    </PopoverTrigger>
  ) : (
    // Modo expandido: botão com label
    <PopoverTrigger render={
      <Button
        variant="outline"
        className="w-full h-8 justify-between text-xs font-normal bg-secondary border-border text-sidebar-foreground hover:bg-muted gap-2"
      />
    }>
      <span className="flex items-center gap-1.5">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {label}
      </span>
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
    </PopoverTrigger>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}

      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-64 p-3"
      >
        {/* Navegação de ano */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setAno(a => a - 1)}
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="text-sm font-semibold text-foreground">{ano}</span>

          <button
            onClick={() => setAno(a => a + 1)}
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Grid de meses — 3 colunas × 4 linhas */}
        <div className="grid grid-cols-3 gap-1">
          {MESES.map((m, i) => {
            const isSelecionado = i === mesAtual && ano === anoAtual
            const isHoje        = ano === anoHoje && i === mesHoje

            return (
              <button
                key={m}
                onClick={() => selecionar(i)}
                className={cn(
                  'rounded-lg py-1.5 text-xs font-medium transition-all',
                  isSelecionado
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : isHoje
                    ? 'bg-primary/15 text-primary ring-1 ring-primary/30 hover:bg-primary/25'
                    : 'text-foreground hover:bg-muted',
                )}
              >
                {m}
              </button>
            )
          })}
        </div>

        {/* Indicador do mês atual */}
        <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Selecionado: <strong className="text-foreground">{label}</strong>
          </span>
          {value !== `${anoHoje}-${String(mesHoje + 1).padStart(2, '0')}` && (
            <button
              onClick={() => {
                const mm = String(mesHoje + 1).padStart(2, '0')
                onChange(`${anoHoje}-${mm}`)
                setAno(anoHoje)
                setOpen(false)
              }}
              className="text-[11px] text-primary hover:underline"
            >
              Mês atual
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
