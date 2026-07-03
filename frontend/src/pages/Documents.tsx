import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import {
  useDeleteDocument,
  useDocuments,
  usePartTypes,
  useProcessDocument,
  useProcessPending,
  useUploadDocuments,
} from '../api/hooks'
import type { Document } from '../api/types'
import { Badge, Button, EmptyState, PageHeader, PageSpinner } from '../components/ui'
import { cn, formatDateTime, formatPct } from '../lib/utils'

const PHASE_LABEL: Record<string, string> = {
  queued: 'Queued',
  convert: 'OCR',
  extract: 'Extracting',
  merge: 'Mapping',
  done: 'Done',
}

function StatusBadge({ doc }: { doc: Document }) {
  switch (doc.status) {
    case 'completed':
      return (
        <Badge tone="good">
          <CheckCircle2 size={13} /> Completed
        </Badge>
      )
    case 'failed':
      return (
        <Badge tone="crit">
          <AlertTriangle size={13} /> Failed
        </Badge>
      )
    case 'processing':
      return (
        <Badge tone="accent">
          <Loader2 size={13} className="animate-spin" /> {PHASE_LABEL[doc.phase] ?? 'Processing'}
        </Badge>
      )
    default:
      return (
        <Badge tone="neutral">
          <Clock size={13} /> Queued
        </Badge>
      )
  }
}

function ReviewProgress({ doc }: { doc: Document }) {
  if (doc.status !== 'completed' || doc.fields_total === 0) return <span className="text-ink-muted">—</span>
  const reviewed = doc.fields_verified + doc.fields_corrected
  const done = reviewed === doc.fields_total
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn('h-full rounded-full transition-all', done ? 'bg-good' : 'bg-accent')}
          style={{ width: `${(reviewed / doc.fields_total) * 100}%` }}
        />
      </div>
      <span className="font-mono text-[12.5px] tabular-nums text-ink-secondary">
        {reviewed}/{doc.fields_total}
      </span>
    </div>
  )
}

function RegisterStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('led', tone ?? 'bg-ink-muted', value === 0 && 'opacity-30')} />
      <span className="font-mono text-[13.5px] tabular-nums text-ink">{value}</span>
      <span className="microlabel !text-[11px]">{label}</span>
    </div>
  )
}

export default function Documents() {
  const navigate = useNavigate()
  const { data: docs, isLoading } = useDocuments()
  const { data: partTypes } = usePartTypes()
  const upload = useUploadDocuments()
  const processPending = useProcessPending()
  const processDoc = useProcessDocument()
  const deleteDoc = useDeleteDocument()

  const fileInput = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [partTypeId, setPartTypeId] = useState<number | null>(null)
  // selected files wait here for the user to confirm before the pipeline starts
  const [staged, setStaged] = useState<File[]>([])

  const effectivePartType = partTypeId ?? partTypes?.[0]?.id ?? null

  const onFiles = useCallback((list: FileList | File[]) => {
    const incoming = Array.from(list).filter((f) =>
      ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(f.type),
    )
    if (!incoming.length) return
    setStaged((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`))
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}|${f.size}|${f.lastModified}`))]
    })
  }, [])

  const startExtraction = () => {
    if (!staged.length || !effectivePartType) return
    upload.mutate(
      { files: staged, partTypeId: effectivePartType },
      { onSuccess: () => setStaged([]) },
    )
  }

  const counts = useMemo(() => {
    const c = { queued: 0, processing: 0, completed: 0, failed: 0 }
    for (const d of docs ?? []) c[d.status]++
    return c
  }, [docs])

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <PageHeader
        eyebrow="Drawing register"
        title="Documents"
        subtitle="Upload blueprints, run the extraction pipeline, and review every value against the drawing."
        actions={
          (counts.queued > 0 || counts.failed > 0) && (
            <Button variant="secondary" size="sm" loading={processPending.isPending} onClick={() => processPending.mutate()}>
              <Play size={15} /> Process pending ({counts.queued + counts.failed})
            </Button>
          )
        }
      />

      {/* upload dropzone */}
      <div
        className={cn(
          'reg-corners reg-corners-hover blueprint-grid relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border bg-surface-1/80 px-6 py-12 transition-all duration-200',
          dragOver ? 'reg-corners-active border-accent/60 bg-accent/[0.05] shadow-beam-soft' : 'border-line-strong',
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          onFiles(e.dataTransfer.files)
        }}
      >
        {/* marching-ants frame while dragging */}
        {dragOver && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <rect
              x="5"
              y="5"
              width="calc(100% - 10px)"
              height="calc(100% - 10px)"
              rx="10"
              fill="none"
              className="animate-ants stroke-accent"
              strokeWidth="1.5"
              strokeDasharray="8 8"
              opacity="0.8"
            />
          </svg>
        )}

        {staged.length === 0 ? (
          <>
            <div
              className={cn(
                'relative flex h-14 w-14 items-center justify-center rounded-2xl border transition-all duration-200',
                dragOver
                  ? 'border-accent/60 bg-accent/15 text-accent-bright shadow-beam-soft scale-110'
                  : 'border-accent/25 bg-accent/[0.07] text-accent',
              )}
            >
              <UploadCloud size={26} strokeWidth={1.8} />
            </div>

            <div className="text-center">
              <p className="font-display text-[17px] font-medium text-ink">
                {dragOver ? 'Release to add files' : 'Drop blueprints here'}
              </p>
              {!dragOver && (
                <p className="mt-1 text-xs text-ink-muted">
                  or{' '}
                  <button
                    className="font-medium text-accent underline-offset-4 transition-colors hover:text-accent-bright hover:underline"
                    onClick={() => fileInput.current?.click()}
                  >
                    browse files
                  </button>{' '}
                  — PDF, PNG, JPG or WebP, multiple at once. Nothing is processed until you confirm.
                </p>
              )}
            </div>
          </>
        ) : (
          /* review step — files wait here until the user starts the pipeline */
          <div className="w-full max-w-lg space-y-4">
            <div className="text-center">
              <p className="font-display text-[17px] font-medium text-ink">
                {staged.length} blueprint{staged.length === 1 ? '' : 's'} ready
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Check the list — you can remove files or drop in more before starting.
              </p>
            </div>

            <ul className="space-y-1.5">
              {staged.map((f) => (
                <li
                  key={`${f.name}|${f.size}|${f.lastModified}`}
                  className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/70 py-2 pl-3 pr-1.5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/20 bg-accent/[0.07] text-accent">
                    <FileText size={15} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">{f.name}</span>
                  <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-ink-muted">
                    {f.size >= 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}
                  </span>
                  <button
                    title={`Remove ${f.name}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-crit/15 hover:text-crit"
                    onClick={() => setStaged((prev) => prev.filter((s) => s !== f))}
                    disabled={upload.isPending}
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2.5 rounded-full border border-line bg-surface-2/80 py-1 pl-3.5 pr-1.5 backdrop-blur-sm">
          <span className="microlabel !text-[11px]">Part type</span>
          <select
            className="h-8 cursor-pointer rounded-full border-0 bg-surface-3 px-3 pr-7 text-xs font-medium text-ink outline-none transition-colors hover:bg-surface-3/70 focus:ring-2 focus:ring-accent/30"
            value={effectivePartType ?? ''}
            onChange={(e) => setPartTypeId(Number(e.target.value))}
            disabled={upload.isPending}
          >
            {partTypes?.map((pt) => (
              <option key={pt.id} value={pt.id}>
                {pt.name}
              </option>
            ))}
          </select>
        </div>

        {staged.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" loading={upload.isPending} onClick={startExtraction}>
              <Play size={15} /> Start extraction ({staged.length})
            </Button>
            <Button variant="secondary" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
              <Plus size={15} /> Add more
            </Button>
            <Button variant="ghost" disabled={upload.isPending} onClick={() => setStaged([])}>
              Clear
            </Button>
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {upload.isError && <p className="text-xs text-crit">{(upload.error as Error).message}</p>}
      </div>

      {/* register strip */}
      {docs && docs.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1">
          <RegisterStat label="Completed" value={counts.completed} tone="bg-good" />
          <RegisterStat label="Processing" value={counts.processing} tone="bg-accent animate-blink" />
          <RegisterStat label="Queued" value={counts.queued} tone="bg-ink-muted" />
          <RegisterStat label="Failed" value={counts.failed} tone="bg-crit" />
          <span className="microlabel ml-auto hidden !text-[11px] sm:block">
            {docs.length} sheet{docs.length === 1 ? '' : 's'} on file
          </span>
        </div>
      )}

      {/* sheet index */}
      {isLoading ? (
        <PageSpinner />
      ) : !docs?.length ? (
        <div className="card">
          <EmptyState art title="No blueprints yet">
            Upload your first blueprint above — the pipeline will OCR it, extract structured part data, and map every
            value back to its exact location on the drawing.
          </EmptyState>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line">
                  <th className="microlabel px-4 py-2.5 !text-[11px]">File</th>
                  <th className="microlabel px-3 py-2.5 !text-[11px]">Part No.</th>
                  <th className="microlabel px-3 py-2.5 !text-[11px]">Status</th>
                  <th className="microlabel hidden px-3 py-2.5 !text-[11px] lg:table-cell">OCR Conf.</th>
                  <th className="microlabel px-3 py-2.5 !text-[11px]">Reviewed</th>
                  <th className="microlabel hidden px-3 py-2.5 !text-[11px] xl:table-cell">Uploaded</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr
                    key={doc.id}
                    className={cn(
                      'group border-b border-line transition-colors last:border-0',
                      doc.status === 'completed' && 'cursor-pointer hover:bg-accent/[0.045]',
                    )}
                    onClick={() => doc.status === 'completed' && navigate(`/documents/${doc.id}`)}
                  >
                    <td className="max-w-[280px] px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors',
                            doc.status === 'completed'
                              ? 'border-accent/20 bg-accent/[0.07] text-accent group-hover:border-accent/40'
                              : 'border-line bg-surface-2 text-ink-muted',
                          )}
                        >
                          <FileText size={15} strokeWidth={1.8} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-medium text-ink">{doc.filename}</p>
                          {doc.status === 'failed' && doc.error ? (
                            <p className="mt-0.5 max-w-[230px] truncate text-[12px] text-crit/80" title={doc.error}>
                              {doc.error}
                            </p>
                          ) : (
                            doc.page_count != null && (
                              <p className="mt-0.5 font-mono text-[11.5px] text-ink-muted">
                                {doc.page_count} page{doc.page_count === 1 ? '' : 's'}
                              </p>
                            )
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-[13.5px] tracking-tight text-accent-bright/90">
                      {doc.part_number ?? <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge doc={doc} />
                    </td>
                    <td className="hidden px-3 py-3 font-mono text-[13px] tabular-nums text-ink-secondary lg:table-cell">
                      {formatPct(doc.avg_confidence)}
                    </td>
                    <td className="px-3 py-3">
                      <ReviewProgress doc={doc} />
                    </td>
                    <td className="hidden px-3 py-3 text-[13px] text-ink-muted xl:table-cell">
                      {formatDateTime(doc.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {doc.status === 'failed' && (
                          <button
                            title="Retry"
                            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted hover:bg-surface-3 hover:text-ink"
                            onClick={(e) => {
                              e.stopPropagation()
                              processDoc.mutate(doc.id)
                            }}
                          >
                            <RotateCcw size={15.5} />
                          </button>
                        )}
                        {doc.status !== 'processing' && (
                          <button
                            title="Delete"
                            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted hover:bg-crit/15 hover:text-crit"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (confirm(`Delete ${doc.filename}? This removes its extraction and corrections.`)) {
                                deleteDoc.mutate(doc.id)
                              }
                            }}
                          >
                            <Trash2 size={15.5} />
                          </button>
                        )}
                        {doc.status === 'completed' && (
                          <Link
                            to={`/documents/${doc.id}`}
                            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted hover:bg-accent/15 hover:text-accent-bright"
                            onClick={(e) => e.stopPropagation()}
                            title="Review"
                          >
                            <ArrowRight size={16} />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
