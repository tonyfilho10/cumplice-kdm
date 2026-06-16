// Componentes UI do Cúmplice — usa shadcn/ui como base
'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { Button as ShadButton } from '@/components/ui/button'
import { Badge as ShadBadge } from '@/components/ui/badge'
import { Input as ShadInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table as ShadTable, TableBody, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { toast as sonnerToast } from 'sonner'
import { Pencil, Trash2, Upload } from 'lucide-react'

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, className, style }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-5 shadow-sm', className)} style={style}>
      {children}
    </div>
  )
}

export function CardTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <span className="text-sm font-bold text-foreground">{children}</span>
      {sub && <span className="text-xs text-muted-foreground font-normal">{sub}</span>}
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
export function KpiCard({ label, value, delta, deltaType, topColor }: {
  label: string; value: string; delta?: string
  deltaType?: 'up' | 'down' | 'warn'; topColor?: string
}) {
  const deltaColor = deltaType === 'up' ? 'text-green-500' : deltaType === 'down' ? 'text-red-400' : 'text-orange-400'
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm overflow-hidden relative">
      {/* Accent top bar — elemento separado evita conflito border/borderTop */}
      {topColor && (
        <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl"
          style={{ background: topColor }} />
      )}
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-1">{label}</p>
      <p className="text-2xl font-bold text-foreground my-1.5">{value}</p>
      {delta && <p className={cn('text-xs', deltaType ? deltaColor : 'text-muted-foreground')}>{delta}</p>}
    </div>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────
export function Btn({ children, onClick, variant = 'primary', style, disabled, className }: {
  children: React.ReactNode; onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'; style?: React.CSSProperties
  disabled?: boolean; className?: string
}) {
  const variantMap = {
    primary: 'default',
    ghost: 'outline',
    danger: 'destructive',
  } as const
  return (
    <ShadButton
      variant={variantMap[variant]}
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={cn('gap-1.5 text-xs h-9', className)}
    >
      {children}
    </ShadButton>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ children, variant = 'ok' }: {
  children: React.ReactNode; variant?: 'ok' | 'warn' | 'err' | 'pending'
}) {
  const cls = {
    ok:      'bg-green-500/15 text-green-400 border-green-500/20',
    warn:    'bg-orange-500/15 text-orange-400 border-orange-500/20',
    err:     'bg-red-500/15 text-red-400 border-red-500/20',
    pending: 'bg-muted text-muted-foreground border-border',
  }
  return (
    <ShadBadge variant="outline" className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full', cls[variant])}>
      {children}
    </ShadBadge>
  )
}

export function Tag({ children, variant = 'red' }: {
  children: React.ReactNode; variant?: 'red' | 'orange' | 'yellow' | 'green' | 'purple'
}) {
  const cls = {
    red:    'bg-red-500/15 text-red-300',
    orange: 'bg-orange-500/15 text-orange-300',
    yellow: 'bg-yellow-500/15 text-yellow-300',
    green:  'bg-green-500/15 text-green-400',
    purple: 'bg-primary/15 text-primary',
  }
  return (
    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap', cls[variant])}>
      {children}
    </span>
  )
}

// ─── Input / Select ───────────────────────────────────────────────────────────
export function Input({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = `input-${label.replace(/\s/g, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <ShadInput id={id} {...props} className={cn('h-9 text-sm bg-secondary border-border', className)} />
    </div>
  )
}

export function Select({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      <select
        {...props}
        className="h-9 rounded-md border border-border bg-secondary text-foreground text-sm px-3 focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
      >
        {children}
      </select>
    </div>
  )
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────
export function UploadZone({ icon, label, sub, onFiles, accept }: {
  icon: string; label: string; sub: string; onFiles: (f: File[]) => void; accept?: string
}) {
  const inputId = `upload-${label.replace(/\s/g, '-').toLowerCase()}`
  return (
    <label htmlFor={inputId}
      className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-7 cursor-pointer text-muted-foreground transition-colors hover:border-primary hover:text-primary hover:bg-primary/5">
      <Upload className="h-6 w-6" />
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-xs">{sub}</span>
      <input id={inputId} type="file" className="hidden" multiple accept={accept}
        onChange={e => e.target.files && onFiles(Array.from(e.target.files))} />
    </label>
  )
}

// ─── Alert Bar ────────────────────────────────────────────────────────────────
export function AlertBar({ children, variant = 'error' }: { children: React.ReactNode; variant?: 'error' | 'warn' }) {
  return (
    <div className={cn(
      'flex items-start gap-3 rounded-xl border p-3.5 text-sm mb-5',
      variant === 'error'
        ? 'bg-red-500/10 border-red-500/25 text-red-300'
        : 'bg-orange-500/10 border-orange-500/25 text-orange-300',
    )}>
      {children}
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <ShadTable>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            {headers.map(h => (
              <TableHead key={h} className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground py-2.5">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </ShadTable>
    </div>
  )
}

export function Tr({ children }: { children: React.ReactNode }) {
  return <TableRow className="border-border hover:bg-secondary/50 transition-colors">{children}</TableRow>
}

export function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={cn(
      'px-4 py-2.5 text-sm text-foreground align-middle',
      mono && 'font-mono text-xs',
    )}>
      {children}
    </td>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ title, children, onClose, className }: {
  title: string; children: React.ReactNode; onClose: () => void; className?: string
}) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className={`bg-card border-border max-w-lg ${className ?? ''}`}>
        <DialogHeader>
          <DialogTitle className="text-foreground">{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

// ─── Confirm Delete ───────────────────────────────────────────────────────────
export function ConfirmDelete({ msg, onConfirm, onCancel }: {
  msg?: string; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <AlertDialog open onOpenChange={open => !open && onCancel()}>
      <AlertDialogContent className="bg-card border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">Confirmar exclusão</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            {msg || 'Excluir este registro? Esta ação não pode ser desfeita.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} className="bg-secondary border-border text-foreground hover:bg-muted">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── Row Actions ──────────────────────────────────────────────────────────────
export function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-1.5">
      <ShadButton variant="ghost" size="icon" className="h-7 w-7 text-primary/70 hover:text-primary hover:bg-primary/10" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </ShadButton>
      <ShadButton variant="ghost" size="icon" className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </ShadButton>
    </div>
  )
}

// ─── Toast (wraps sonner) ────────────────────────────────────────────────────
export function Toast({ msg, onHide }: { msg: string; onHide: () => void }) {
  React.useEffect(() => {
    const isError = msg.toLowerCase().startsWith('erro')
    if (isError) {
      sonnerToast.error(msg.replace(/^erro:\s*/i, ''))
    } else {
      sonnerToast.success(msg)
    }
    onHide()
  }, [])
  return null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Converte "YYYY-MM-DD" ou ISO string para "DD/MM/AAAA" */
export function fmtData(data: string | null | undefined): string {
  if (!data) return '—'
  const s = data.substring(0, 10) // pega só "YYYY-MM-DD"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return data
  return `${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)}`
}

export function brl(valor: number | null | undefined): string {
  if (valor == null || !isFinite(valor) || isNaN(valor)) return 'R$ —'
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Formata com centavos (R$ 1.234.567,89) */
export function brlC(valor: number | null | undefined): string {
  if (valor == null || !isFinite(valor) || isNaN(valor)) return 'R$ —'
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function pct(valor: number | null | undefined, casas = 1): string {
  if (valor == null || !isFinite(valor) || isNaN(valor)) return '—%'
  return `${valor.toFixed(casas)}%`
}
