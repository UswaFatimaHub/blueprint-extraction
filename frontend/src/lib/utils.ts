import { clsx, type ClassValue } from 'clsx'

export const cn = (...args: ClassValue[]) => clsx(...args)

export const formatPct = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : `${(v * 100).toFixed(digits)}%`

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export const confidenceTone = (c: number | null | undefined): 'good' | 'warn' | 'crit' | 'none' => {
  if (c == null) return 'none'
  if (c >= 0.9) return 'good'
  if (c >= 0.7) return 'warn'
  return 'crit'
}
