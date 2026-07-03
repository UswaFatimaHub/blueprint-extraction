import { BookOpenCheck, FileCheck2, LayoutDashboard, ListChecks, PencilRuler, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useDashboard } from '../api/hooks'
import { Badge, EmptyState, PageSpinner } from '../components/ui'
import { formatDate, formatDateTime, formatPct } from '../lib/utils'

const SERIES_BLUE = '#3987E5'
const INK_MUTED = '#67758B'
const GRID = 'rgba(148,163,184,0.10)'

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="card flex items-start gap-3 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-sky-300">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">{label}</p>
        <p className="mt-0.5 text-[22px] font-semibold leading-7 tracking-tight">{value}</p>
        {hint && <p className="mt-0.5 truncate text-[11px] text-ink-muted">{hint}</p>}
      </div>
    </div>
  )
}

function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs shadow-pop">
      <p className="font-medium text-ink">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="mt-0.5 flex items-center gap-1.5 text-ink-secondary">
          <span className="h-2 w-2 rounded-sm" style={{ background: SERIES_BLUE }} />
          {formatter ? formatter(p.value, p.payload) : p.value}
        </p>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { data, isLoading } = useDashboard()
  if (isLoading || !data) return <PageSpinner />

  const { stats, error_patterns, version_accuracy, recent_corrections } = data
  const accuracySeries = version_accuracy.filter((v) => v.accuracy != null)

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Learning Dashboard</h1>
        <p className="mt-0.5 text-xs text-ink-muted">
          How extraction accuracy improves as corrections feed back into the prompt.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          icon={<Target size={16} />}
          label="Extraction accuracy"
          value={formatPct(stats.overall_accuracy, 1)}
          hint={`${stats.fields_verified} verified · ${stats.fields_corrected} corrected`}
        />
        <StatTile
          icon={<FileCheck2 size={16} />}
          label="Documents processed"
          value={String(stats.documents_completed)}
          hint={stats.documents_failed ? `${stats.documents_failed} failed` : 'all succeeded'}
        />
        <StatTile
          icon={<ListChecks size={16} />}
          label="Fields extracted"
          value={String(stats.fields_total)}
          hint={`${stats.fields_unverified} awaiting review`}
        />
        <StatTile
          icon={<PencilRuler size={16} />}
          label="Corrections logged"
          value={String(stats.corrections_total)}
          hint="each one improves the prompt"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* accuracy by prompt version */}
        <div className="card p-4">
          <h2 className="text-[13px] font-semibold">Accuracy by prompt version</h2>
          <p className="mt-0.5 text-[11px] text-ink-muted">verified ÷ reviewed fields, per version of the extraction prompt</p>
          {accuracySeries.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-xs text-ink-muted">
              Review extracted fields to start measuring accuracy.
            </div>
          ) : (
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={accuracySeries} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: INK_MUTED, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tickFormatter={(v) => `${Math.round(v * 100)}%`}
                    tick={{ fill: INK_MUTED, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={58}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatter={(v: number, row: any) =>
                          `${formatPct(v, 1)} accuracy · ${row.fields_reviewed} fields reviewed`
                        }
                      />
                    }
                    cursor={{ stroke: 'rgba(148,163,184,0.3)', strokeDasharray: '3 3' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="accuracy"
                    stroke={SERIES_BLUE}
                    strokeWidth={2}
                    dot={{ r: 4, fill: '#111926', stroke: SERIES_BLUE, strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: SERIES_BLUE }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* error patterns */}
        <div className="card p-4">
          <h2 className="text-[13px] font-semibold">Error patterns</h2>
          <p className="mt-0.5 text-[11px] text-ink-muted">corrections grouped by field — the next prompt fix goes to the top bar</p>
          {error_patterns.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-xs text-ink-muted">
              No corrections yet — errors you correct will cluster here.
            </div>
          ) : (
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={error_patterns.slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 0, right: 24, bottom: 0, left: 8 }}
                >
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: INK_MUTED, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="field_label"
                    width={110}
                    tick={{ fill: '#A9B6C9', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatter={(v: number, row: any) =>
                          `${v} correction${v === 1 ? '' : 's'}${row.last_reason ? ` — “${row.last_reason}”` : ''}`
                        }
                      />
                    }
                    cursor={{ fill: 'rgba(148,163,184,0.06)' }}
                  />
                  <Bar dataKey="count" fill={SERIES_BLUE} barSize={14} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* correction log */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <BookOpenCheck size={14} className="text-ink-muted" />
          <h2 className="text-[13px] font-semibold">Correction log</h2>
          <span className="text-[11px] text-ink-muted">— the raw training signal for prompt improvements</span>
        </div>
        {recent_corrections.length === 0 ? (
          <EmptyState icon={<LayoutDashboard size={20} />} title="No corrections yet">
            When the AI misreads a value, correct it in the review screen with a note on why — every note is injected
            into the next extraction prompt.
          </EmptyState>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-ink-muted">
                <th className="px-4 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">AI read</th>
                <th className="px-3 py-2 font-medium">Corrected to</th>
                <th className="px-3 py-2 font-medium">Why</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Document</th>
                <th className="hidden px-3 py-2 font-medium xl:table-cell">When</th>
              </tr>
            </thead>
            <tbody>
              {recent_corrections.map((c) => (
                <tr key={c.id} className="border-b border-line/60 align-top last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="text-[12px] font-medium">{c.field_label}</p>
                    {c.category && <Badge tone="neutral" className="mt-1">{c.category}</Badge>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11.5px] text-red-300/85 line-through decoration-red-400/40">
                    {c.original_value ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11.5px] text-emerald-300">{c.corrected_value}</td>
                  <td className="max-w-[280px] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-secondary">
                    {c.reason || <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="hidden px-3 py-2.5 text-[11.5px] text-ink-muted lg:table-cell">{c.document_name}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-[11.5px] tabular-nums text-ink-muted xl:table-cell">
                    {formatDateTime(c.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
