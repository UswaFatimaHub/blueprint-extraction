import { DraftingCompass, FileStack, FlaskConical, LayoutDashboard, Ruler, Shapes } from 'lucide-react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'

import { useMeta } from './api/hooks'
import { cn } from './lib/utils'
import Dashboard from './pages/Dashboard'
import Documents from './pages/Documents'
import PartTypes from './pages/PartTypes'
import PromptStudio from './pages/PromptStudio'
import Review from './pages/Review'
import Standards from './pages/Standards'

const NAV = [
  { to: '/documents', label: 'Documents', icon: FileStack },
  { to: '/dashboard', label: 'Learning', icon: LayoutDashboard },
  { to: '/part-types', label: 'Part Types', icon: Shapes },
  { to: '/standards', label: 'Standards', icon: Ruler },
  { to: '/prompt', label: 'Prompt Studio', icon: FlaskConical },
]

function Sidebar() {
  const { data: meta } = useMeta()
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface-1">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <DraftingCompass size={17} />
        </div>
        <div className="leading-tight">
          <p className="text-[13px] font-semibold tracking-tight">Blueprint IQ</p>
          <p className="text-[10.5px] text-ink-muted">Extraction Platform</p>
        </div>
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-2.5">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                isActive
                  ? 'bg-accent/15 text-sky-300'
                  : 'text-ink-secondary hover:bg-surface-3/60 hover:text-ink',
              )
            }
          >
            <Icon size={15.5} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line px-4 py-3">
        {meta?.mode === 'mock' ? (
          <div className="rounded-lg border border-warn/25 bg-warn/10 px-2.5 py-2">
            <p className="text-[11px] font-semibold text-amber-300">Mock pipeline</p>
            <p className="mt-0.5 text-[10.5px] leading-snug text-ink-muted">
              No Datalab API key configured — extractions are simulated.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-good" />
            Datalab connected
          </div>
        )}
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
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
