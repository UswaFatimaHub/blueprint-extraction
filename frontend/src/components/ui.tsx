import { Loader2, X } from 'lucide-react'
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useEffect } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../lib/utils'

// ---- Button -----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'good'

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface-3 text-ink hover:bg-surface-3/70 border border-line-strong',
  ghost: 'text-ink-secondary hover:text-ink hover:bg-surface-3/60',
  danger: 'bg-crit/15 text-red-300 hover:bg-crit/25 border border-crit/30',
  good: 'bg-good/15 text-emerald-300 hover:bg-good/25 border border-good/30',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        'disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-[13px]',
        buttonStyles[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

// ---- Badge ------------------------------------------------------------------

type BadgeTone = 'good' | 'warn' | 'crit' | 'accent' | 'neutral'

const badgeStyles: Record<BadgeTone, string> = {
  good: 'bg-good/15 text-emerald-300 border-good/25',
  warn: 'bg-warn/15 text-amber-300 border-warn/25',
  crit: 'bg-crit/15 text-red-300 border-crit/30',
  accent: 'bg-accent/15 text-sky-300 border-accent/30',
  neutral: 'bg-surface-3 text-ink-secondary border-line-strong',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4',
        badgeStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

// ---- Inputs -----------------------------------------------------------------

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('input min-h-[72px] resize-y', className)} {...props} />
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        checked ? 'bg-accent' : 'bg-surface-3 border border-line-strong',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

// ---- Modal ------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div
        className={cn(
          'relative card max-h-[88vh] w-full overflow-y-auto p-5 shadow-pop animate-scale-in',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ---- Empty state / spinners ---------------------------------------------------

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-muted">
        {icon}
      </div>
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {children && <p className="max-w-sm text-xs leading-relaxed text-ink-muted">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 size={22} className="animate-spin text-ink-muted" />
    </div>
  )
}

// ---- Confidence meter ----------------------------------------------------------

export function ConfidenceMeter({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-ink-muted">—</span>
  const pct = Math.round(value * 100)
  const tone = value >= 0.9 ? 'bg-good' : value >= 0.7 ? 'bg-warn' : 'bg-crit'
  return (
    <div className="flex items-center gap-2" title={`OCR confidence ${pct}%`}>
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 font-mono text-[11px] tabular-nums text-ink-secondary">{pct}%</span>
    </div>
  )
}
