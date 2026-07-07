import { FileStack, FlaskConical, Menu, Moon, Ruler, Shapes, Sun, TrendingUp, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { BASE } from './api/client'
import { useMeta } from './api/hooks'
import AmbientBackdrop from './components/AmbientBackdrop'
import { useTheme } from './lib/theme'
import { cn } from './lib/utils'
import Dashboard from './pages/Dashboard'
import Documents from './pages/Documents'
import PartTypes from './pages/PartTypes'
import PromptStudio from './pages/PromptStudio'
import Review from './pages/Review'
import Standards from './pages/Standards'

const NAV = [
  {
    section: 'Workspace',
    items: [
      { to: '/documents', label: 'Documents', icon: FileStack },
      { to: '/dashboard', label: 'Insights', icon: TrendingUp },
    ],
  },
  {
    section: 'Calibration',
    items: [
      { to: '/part-types', label: 'Part Types', icon: Shapes },
      { to: '/standards', label: 'Standards', icon: Ruler },
      // { to: '/prompt', label: 'Prompt Studio', icon: FlaskConical },
    ],
  },
]

function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0 text-accent">
      <rect
        x="0.75" y="0.75" width="30.5" height="30.5" rx="7"
        fill="currentColor" fillOpacity="0.08"
        stroke="currentColor" strokeOpacity="0.4" strokeWidth="1"
      />
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 5.5v5M16 21.5v5M5.5 16h5M21.5 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.6" fill="currentColor" />
    </svg>
  )
}

function Wordmark() {
  return (
    <div className="leading-tight">
      <p className="font-display text-[16px] font-semibold tracking-tight text-ink-hi">
        Blueprint<span className="text-accent"> IQ</span>
      </p>
      <p className="microlabel mt-px !text-[10px] !tracking-[0.22em]">Extraction Platform</p>
    </div>
  )
}

function ThemeToggle({ rail = false }: { rail?: boolean }) {
  const { theme, toggle } = useTheme()
  const Icon = theme === 'dark' ? Sun : Moon
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'flex items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink',
        rail ? 'h-9 w-9' : 'h-9 w-9',
      )}
    >
      <Icon size={rail ? 16 : 14} />
    </button>
  )
}

function DatalabStatus({ compact = false }: { compact?: boolean }) {
  const { data: meta } = useMeta()
  if (!meta) return null
  if (compact) {
    return (
      <span
        className={cn('led', meta.mode === 'mock' ? 'bg-warn' : 'bg-good')}
        title={meta.mode === 'mock' ? 'Mock pipeline — no API key' : 'Datalab connected'}
      />
    )
  }
  return meta.mode === 'mock' ? (
    <div className="rounded-lg border border-warn/25 bg-warn/[0.07] px-2.5 py-2">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-warn">
        <span className="led bg-warn animate-blink" /> Mock pipeline
      </p>
      <p className="mt-1 text-[12px] leading-snug text-ink-muted">
        No Datalab API key — extractions are simulated.
      </p>
    </div>
  ) : (
    <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
      <span className="led bg-good" /> Datalab connected
    </div>
  )
}

function NavItems({ rail = false }: { rail?: boolean }) {
  return (
    <nav className={cn('flex flex-1 flex-col', rail ? 'items-center gap-1 px-2' : 'gap-4 px-3')}>
      {NAV.map(({ section, items }) => (
        <div key={section} className={cn(!rail && 'space-y-0.5')}>
          {!rail && <p className="microlabel mb-1.5 px-2.5 !text-[11px]">{section}</p>}
          {rail && <div className="mx-auto mb-1 mt-3 h-px w-6 bg-line first:mt-0" />}
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={rail ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center rounded-lg font-medium transition-all duration-150',
                  rail ? 'h-10 w-10 justify-center' : 'gap-2.5 px-2.5 py-2 text-[14.5px]',
                  isActive
                    ? 'bg-accent/[0.09] text-accent-bright ring-1 ring-inset ring-accent/20'
                    : 'text-ink-secondary hover:bg-surface-3/60 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && !rail && (
                    <span className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-accent shadow-beam-soft" />
                  )}
                  <Icon size={rail ? 17 : 15.5} strokeWidth={2} className={cn(isActive && 'drop-shadow-[0_0_6px_rgb(var(--accent)/0.6)]')} />
                  {!rail && label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

function Sidebar() {
  return (
    <>
      {/* full sidebar ≥ lg */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface-1/70 backdrop-blur-sm lg:flex">
        <div className="flex items-center gap-2.5 px-4 pb-5 pt-4">
          <LogoMark />
          <Wordmark />
        </div>
        <NavItems />
        <div className="space-y-2 border-t border-line px-3 py-3">
          <DatalabStatus />
          <div className="flex items-center justify-between">
            <ThemeToggle />
            <span className="microlabel !text-[10px]">v1.0</span>
          </div>
        </div>
      </aside>

      {/* icon rail md..lg */}
      <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-line bg-surface-1/70 pt-3 backdrop-blur-sm md:flex lg:hidden">
        <div className="mb-4">
          <LogoMark size={28} />
        </div>
        <NavItems rail />
        <div className="flex flex-col items-center gap-1 pb-2">
          <ThemeToggle rail />
          <div className="flex h-8 items-center">
            <DatalabStatus compact />
          </div>
        </div>
      </aside>
    </>
  )
}

function MobileNav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setOpen(false), [location.pathname])

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-1/80 px-3 backdrop-blur-sm md:hidden">
        <button
          onClick={() => setOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-3 hover:text-ink"
          aria-label="Open navigation"
        >
          <Menu size={19} />
        </button>
        <LogoMark size={26} />
        <Wordmark />
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <DatalabStatus compact />
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-page/80 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line-strong bg-surface-1 shadow-pop animate-fade-in">
            <div className="flex items-center gap-2.5 px-4 pb-5 pt-4">
              <LogoMark />
              <Wordmark />
              <button
                onClick={() => setOpen(false)}
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>
            <NavItems />
            <div className="border-t border-line px-3 py-3">
              <DatalabStatus />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function App() {
  // fire-and-forget: wakes Neon's compute as early as possible so it's
  // warm by the time the user does anything that actually needs data
  useEffect(() => {
    fetch(`${BASE}/api/warmup`).catch(() => {})
  }, [])

  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      <AmbientBackdrop />
      <MobileNav />
      <Sidebar />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/documents" replace />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/documents/:id" element={<Review />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/part-types" element={<PartTypes />} />
          <Route path="/standards" element={<Standards />} />
          <Route path="/prompt" element={<PromptStudio />} />
          <Route path="*" element={<Navigate to="/documents" replace />} />
        </Routes>
      </main>
    </div>
  )
}
