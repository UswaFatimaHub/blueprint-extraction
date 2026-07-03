import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileStack,
  FileUp,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  UploadCloud,
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
import { Badge, Button, EmptyState, PageSpinner } from '../components/ui'
import { cn, formatDateTime, formatPct } from '../lib/utils'

const PHASE_LABEL: Record<string, string> = {
  queued: 'Queued',
  convert: 'OCR',
  extract: 'Extracting',
  merge: 'Mapping boxes',
  done: 'Done',
}

function StatusBadge({ doc }: { doc: Document }) {
  switch (doc.status) {
    case 'completed':
      return (
        <Badge tone="good">
          <CheckCircle2 size={11} /> Completed
        </Badge>
      )
    case 'failed':
      return (
        <Badge tone="crit">
          <AlertTriangle size={11} /> Failed
        </Badge>
      )
    case 'processing':
      return (
        <Badge tone="accent">
          <Loader2 size={11} className="animate-spin" /> {PHASE_LABEL[doc.phase] ?? 'Processing'}
        </Badge>
      )
    default:
      return (
        <Badge tone="neutral">
          <Clock size={11} /> Queued
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
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn('h-full rounded-full transition-all', done ? 'bg-good' : 'bg-accent')}
          style={{ width: `${(reviewed / doc.fields_total) * 100}%` }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-ink-secondary">
        {reviewed}/{doc.fields_total}
      </span>
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

  const effectivePartType = partTypeId ?? partTypes?.[0]?.id ?? null

  const onFiles = useCallback(
    (list: FileList | File[]) => {
      const files = Array.from(list).filter((f) =>
        ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(f.type),
      )
      if (!files.length || !effectivePartType) return
      upload.mutate({ files, partTypeId: effectivePartType })
    },
    [effectivePartType, upload],
  )

  const counts = useMemo(() => {
    const c = { queued: 0, processing: 0, completed: 0, failed: 0 }
    for (const d of docs ?? []) c[d.status]++
    return c
  }, [docs])

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Documents</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Upload blueprints, run the extraction pipeline, and review the results.
          </p>
        </div>
        {(counts.queued > 0 || counts.failed > 0) && (
          <Button variant="secondary" size="sm" loading={processPending.isPending} onClick={() => processPending.mutate()}>
            <Play size={13} /> Process pending ({counts.queued + counts.failed})
          </Button>
        )}
      </div>

      {/* upload dropzone */}
      <div
        className={cn(
          'card relative flex flex-col items-center justify-center gap-3 border-dashed px-6 py-10 transition-all',
          dragOver ? 'border-accent bg-accent/[0.07] scale-[1.005]' : 'border-line-strong',
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
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
          {upload.isPending ? <Loader2 size={22} className="animate-spin" /> : <UploadCloud size={22} />}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">
            {upload.isPending ? 'Uploading…' : 'Drop blueprints here, or '}
            {!upload.isPending && (
              <button className="text-sky-300 underline-offset-2 hover:underline" onClick={() => fileInput.current?.click()}>
                browse files
              </button>
            )}
          </p>
          <p className="mt-1 text-xs text-ink-muted">PDF, PNG, JPG or WebP — multiple files supported</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-ink-muted">Part type</span>
          <select
            className="input h-8 w-auto py-0 text-xs"
            value={effectivePartType ?? ''}
            onChange={(e) => setPartTypeId(Number(e.target.value))}
          >
            {partTypes?.map((pt) => (
              <option key={pt.id} value={pt.id}>
                {pt.name}
              </option>
            ))}
          </select>
        </div>

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
        {upload.isError && (
          <p className="text-xs text-red-300">{(upload.error as Error).message}</p>
        )}
      </div>

      {/* queue table */}
      {isLoading ? (
        <PageSpinner />
      ) : !docs?.length ? (
        <div className="card">
          <EmptyState icon={<FileStack size={20} />} title="No blueprints yet">
            Upload your first blueprint above — the pipeline will OCR it, extract structured part data, and map every
            value back to its location on the drawing.
          </EmptyState>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-ink-muted">
                <th className="px-4 py-2.5 font-medium">File</th>
                <th className="px-3 py-2.5 font-medium">Part Number</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Confidence</th>
                <th className="px-3 py-2.5 font-medium">Reviewed</th>
                <th className="hidden px-3 py-2.5 font-medium xl:table-cell">Uploaded</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr
                  key={doc.id}
                  className="group cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2/70"
                  onClick={() => doc.status === 'completed' && navigate(`/documents/${doc.id}`)}
                >
                  <td className="max-w-[260px] px-4 py-2.5">
                    <p className="truncate text-[12.5px] font-medium">{doc.filename}</p>
                    {doc.status === 'failed' && doc.error && (
                      <p className="mt-0.5 max-w-[250px] truncate text-[11px] text-red-300/80" title={doc.error}>
                        {doc.error}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-ink-secondary">{doc.part_number ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge doc={doc} />
                  </td>
                  <td className="hidden px-3 py-2.5 font-mono text-[11.5px] tabular-nums text-ink-secondary lg:table-cell">
                    {formatPct(doc.avg_confidence)}
                  </td>
                  <td className="px-3 py-2.5">
                    <ReviewProgress doc={doc} />
                  </td>
                  <td className="hidden px-3 py-2.5 text-[11.5px] text-ink-muted xl:table-cell">
                    {formatDateTime(doc.created_at)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {doc.status === 'failed' && (
                        <button
                          title="Retry"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-3 hover:text-ink"
                          onClick={(e) => {
                            e.stopPropagation()
                            processDoc.mutate(doc.id)
                          }}
                        >
                          <RotateCcw size={13.5} />
                        </button>
                      )}
                      {doc.status !== 'processing' && (
                        <button
                          title="Delete"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-crit/20 hover:text-red-300"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`Delete ${doc.filename}? This removes its extraction and corrections.`)) {
                              deleteDoc.mutate(doc.id)
                            }
                          }}
                        >
                          <Trash2 size={13.5} />
                        </button>
                      )}
                      {doc.status === 'completed' && (
                        <Link
                          to={`/documents/${doc.id}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-accent/20 hover:text-sky-300"
                          onClick={(e) => e.stopPropagation()}
                          title="Review"
                        >
                          <ArrowRight size={14} />
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {docs && docs.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <FileUp size={11} />
          {counts.completed} completed · {counts.processing} processing · {counts.queued} queued · {counts.failed} failed
        </p>
      )}
    </div>
  )
}
