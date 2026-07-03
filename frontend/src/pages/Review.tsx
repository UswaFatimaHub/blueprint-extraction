import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCheck,
  CircleDashed,
  Crosshair,
  FileWarning,
  Loader2,
  LocateFixed,
  MapPin,
  Pencil,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  useCreateCorrection,
  useDocument,
  useProcessDocument,
  useSetFieldStatus,
} from '../api/hooks'
import type { BBox, DocumentDetail, ExtractedField } from '../api/types'
import BlueprintViewer, { type ViewerHandle } from '../components/BlueprintViewer'
import { Badge, Button, ConfidenceMeter, Input, PageSpinner, Textarea } from '../components/ui'
import { cn, formatPct } from '../lib/utils'

const CATEGORY_SUGGESTIONS = [
  'ocr_misread',
  'format_mismatch',
  'wrong_location',
  'missing_value',
  'standards_violation',
]

// ---------------------------------------------------------------------------

function PipelineProgress({ doc }: { doc: DocumentDetail }) {
  const steps = [
    { key: 'queued', label: 'Queued' },
    { key: 'convert', label: 'OCR (Convert)' },
    { key: 'extract', label: 'AI Extraction' },
    { key: 'merge', label: 'Bounding Boxes' },
  ]
  const idx = steps.findIndex((s) => s.key === doc.phase)
  const current = idx === -1 ? steps.length : idx
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="flex items-center gap-0">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                  i < current
                    ? 'border-good/40 bg-good/15 text-emerald-300'
                    : i === current
                      ? 'border-accent/50 bg-accent/15 text-sky-300'
                      : 'border-line-strong bg-surface-2 text-ink-muted',
                )}
              >
                {i < current ? <Check size={15} /> : i === current ? <Loader2 size={15} className="animate-spin" /> : i + 1}
              </div>
              <span className={cn('text-[11px]', i <= current ? 'text-ink-secondary' : 'text-ink-muted')}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn('mx-2 mb-6 h-px w-14', i < current ? 'bg-good/50' : 'bg-line-strong')} />
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-muted">Datalab is reading the blueprint — this usually takes under a minute.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface CorrectionDraft {
  value: string
  reason: string
  category: string
  region: BBox | null
  picking: boolean
}

function FieldRow({
  field,
  active,
  documentId,
  onSelect,
  correcting,
  onStartCorrection,
  onCancelCorrection,
  draft,
  onDraftChange,
}: {
  field: ExtractedField
  active: boolean
  documentId: string
  onSelect: (f: ExtractedField) => void
  correcting: boolean
  onStartCorrection: (f: ExtractedField) => void
  onCancelCorrection: () => void
  draft: CorrectionDraft
  onDraftChange: (d: Partial<CorrectionDraft>) => void
}) {
  const setStatus = useSetFieldStatus(documentId)
  const createCorrection = useCreateCorrection(documentId)

  const hasLocation = field.bbox_x != null
  const sourceDiffers =
    !!field.source_text &&
    !!field.value &&
    field.source_text.replace(/\W+/g, '').toLowerCase() !== field.value.replace(/\W+/g, '').toLowerCase()
  const statusBadge =
    field.status === 'verified' ? (
      <Badge tone="good"><Check size={11} /> Verified</Badge>
    ) : field.status === 'corrected' ? (
      <Badge tone="crit"><Pencil size={11} /> Corrected</Badge>
    ) : (
      <Badge tone="warn"><CircleDashed size={11} /> Review</Badge>
    )

  const save = () => {
    if (!draft.value.trim()) return
    createCorrection.mutate(
      {
        field_id: field.id,
        corrected_value: draft.value.trim(),
        reason: draft.reason.trim(),
        category: draft.category.trim(),
        bbox: draft.region,
      },
      { onSuccess: onCancelCorrection },
    )
  }

  return (
    <div
      className={cn(
        'group border-b border-line transition-colors',
        active ? 'bg-accent/[0.07]' : 'hover:bg-surface-2/60',
        correcting && 'bg-surface-2',
      )}
    >
      <div className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5" onClick={() => onSelect(field)}>
        <div className="w-[118px] shrink-0">
          <p className="text-[12px] font-medium text-ink-secondary">{field.label}</p>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-muted">
            {field.match_quality === 'word' ? (
              <><LocateFixed size={10} /> exact match</>
            ) : field.match_quality === 'line' ? (
              <><LocateFixed size={10} /> drawing match</>
            ) : field.match_quality === 'block' ? (
              <><MapPin size={10} /> region match</>
            ) : (
              <><FileWarning size={10} /> no location</>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {field.value ? (
            <p className={cn('truncate font-mono text-[12.5px]', field.status === 'corrected' && 'text-red-300/80 line-through decoration-red-400/50')}>
              {field.value}
            </p>
          ) : (
            <p className="text-[12px] italic text-ink-muted">not found</p>
          )}
          {field.status === 'corrected' && field.corrected_value && (
            <p className="truncate font-mono text-[12.5px] text-emerald-300">{field.corrected_value}</p>
          )}
          {sourceDiffers && (
            <p className="mt-0.5 truncate text-[10.5px] text-ink-muted">
              read as <span className="font-mono text-sky-300/80">“{field.source_text}”</span>
            </p>
          )}
        </div>

        <div className="hidden shrink-0 xl:block">
          <ConfidenceMeter value={field.confidence} />
        </div>
        <div className="w-[86px] shrink-0 text-right">{statusBadge}</div>

        <div className={cn('flex shrink-0 items-center gap-1', field.status === 'unverified' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity')}>
          {field.status === 'unverified' ? (
            <>
              <button
                title="Mark as correct"
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-good/20 hover:text-emerald-300"
                onClick={(e) => {
                  e.stopPropagation()
                  setStatus.mutate({ fieldId: field.id, status: 'verified' })
                }}
              >
                <Check size={15} />
              </button>
              <button
                title="Correct this value"
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-crit/20 hover:text-red-300"
                onClick={(e) => {
                  e.stopPropagation()
                  onStartCorrection(field)
                }}
              >
                <Pencil size={13.5} />
              </button>
            </>
          ) : (
            <button
              title="Reset to unreviewed"
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
              onClick={(e) => {
                e.stopPropagation()
                setStatus.mutate({ fieldId: field.id, status: 'unverified' })
              }}
            >
              <Undo2 size={13.5} />
            </button>
          )}
        </div>
      </div>

      {/* AI reasoning / verification feedback for the selected field */}
      {active && !correcting && (field.ai_reasoning || sourceDiffers) && (
        <div className="flex items-start gap-2 border-t border-line/60 bg-surface-2/50 px-3.5 py-2.5 animate-fade-in">
          <Sparkles size={12} className="mt-0.5 shrink-0 text-sky-300/80" />
          <div className="min-w-0 text-[11.5px] leading-relaxed text-ink-secondary">
            {sourceDiffers && (
              <p>
                Found <span className="font-mono text-sky-300">“{field.source_text}”</span> printed on the
                document and interpreted it as{' '}
                <span className="font-mono text-sky-300">“{field.value}”</span>.
              </p>
            )}
            {field.ai_reasoning && <p className={cn(sourceDiffers && 'mt-1')}>{field.ai_reasoning}</p>}
          </div>
        </div>
      )}

      {/* inline correction editor */}
      {correcting && (
        <div className="space-y-3 border-t border-line bg-surface-1 px-3.5 py-3 animate-fade-in">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Correct value</label>
              <Input
                autoFocus
                value={draft.value}
                onChange={(e) => onDraftChange({ value: e.target.value })}
                placeholder="Enter the value as it should read"
                className="font-mono text-[12.5px]"
              />
            </div>
            <div>
              <label className="label">Error category</label>
              <Input
                list="category-suggestions"
                value={draft.category}
                onChange={(e) => onDraftChange({ category: e.target.value })}
                placeholder="e.g. ocr_misread"
              />
              <datalist id="category-suggestions">
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <div>
            <label className="label">Why did the AI get it wrong?</label>
            <Textarea
              value={draft.reason}
              onChange={(e) => onDraftChange({ reason: e.target.value })}
              placeholder='e.g. "AI reads E18 instead of E8 because the 1 looks like scan noise" — this feeds back into the extraction prompt.'
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant={draft.picking ? 'primary' : 'secondary'}
              onClick={() => onDraftChange({ picking: !draft.picking })}
            >
              <Crosshair size={13} />
              {draft.picking ? 'Drag on the drawing…' : draft.region ? 'Re-mark location' : 'Mark location on drawing'}
            </Button>
            <div className="flex items-center gap-2">
              {draft.region && (
                <span className="flex items-center gap-1 text-[11px] text-sky-300">
                  <MapPin size={11} /> location marked
                </span>
              )}
              <Button size="sm" variant="ghost" onClick={onCancelCorrection}>
                <X size={13} /> Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!draft.value.trim()}
                loading={createCorrection.isPending}
                onClick={save}
              >
                <Check size={13} /> Save correction
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function Review() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: doc, isLoading } = useDocument(id)
  const processDoc = useProcessDocument()
  const setStatus = useSetFieldStatus(id ?? '')

  const viewerRef = useRef<ViewerHandle>(null)
  const [activeFieldId, setActiveFieldId] = useState<number | null>(null)
  const [correctingId, setCorrectingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<CorrectionDraft>({ value: '', reason: '', category: '', region: null, picking: false })

  const fields = useMemo(() => doc?.fields ?? [], [doc])
  const reviewed = fields.filter((f) => f.status !== 'unverified').length

  // auto-select first located field once loaded
  useEffect(() => {
    if (doc?.status === 'completed' && activeFieldId === null && fields.length) {
      const first = fields.find((f) => f.bbox_x != null) ?? fields[0]
      setActiveFieldId(first.id)
    }
  }, [doc?.status, fields, activeFieldId])

  if (isLoading || !doc) return <PageSpinner />

  const selectField = (f: ExtractedField) => {
    setActiveFieldId(f.id)
    if (f.bbox_x != null) viewerRef.current?.zoomToField(f)
  }

  const startCorrection = (f: ExtractedField) => {
    setActiveFieldId(f.id)
    setCorrectingId(f.id)
    setDraft({ value: f.value ?? '', reason: '', category: '', region: null, picking: false })
    if (f.bbox_x != null) viewerRef.current?.zoomToField(f)
  }

  const verifyAllRemaining = () => {
    fields.filter((f) => f.status === 'unverified').forEach((f) =>
      setStatus.mutate({ fieldId: f.id, status: 'verified' }),
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-4 py-2.5">
        <Link
          to="/documents"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-mono text-[14px] font-semibold tracking-tight">
              {doc.part_number ?? doc.filename}
            </h1>
            {doc.status === 'completed' && reviewed === fields.length && fields.length > 0 && (
              <Badge tone="good"><CheckCheck size={11} /> fully reviewed</Badge>
            )}
          </div>
          <p className="truncate text-[11px] text-ink-muted">
            {doc.filename} · {doc.part_type_name}
            {doc.prompt_version_label && <> · prompt {doc.prompt_version_label}</>}
            {doc.avg_confidence != null && <> · avg OCR confidence {formatPct(doc.avg_confidence)}</>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {doc.status === 'completed' && fields.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${(reviewed / fields.length) * 100}%` }}
                />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-ink-secondary">
                {reviewed}/{fields.length}
              </span>
            </div>
          )}
          {doc.status === 'completed' && fields.some((f) => f.status === 'unverified') && (
            <Button size="sm" variant="good" onClick={verifyAllRemaining}>
              <CheckCheck size={13} /> Verify remaining
            </Button>
          )}
        </div>
      </header>

      {/* body */}
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <div className="min-w-0 flex-[1.35]">
          {doc.status === 'processing' || doc.status === 'queued' ? (
            <div className="card h-full">
              <PipelineProgress doc={doc} />
            </div>
          ) : doc.status === 'failed' ? (
            <div className="card flex h-full flex-col items-center justify-center gap-3 p-8">
              <AlertTriangle size={28} className="text-red-300" />
              <p className="text-sm font-medium text-red-300">Extraction failed</p>
              <p className="max-w-md text-center text-xs leading-relaxed text-ink-muted">{doc.error}</p>
              <Button variant="primary" size="sm" loading={processDoc.isPending} onClick={() => processDoc.mutate(doc.id)}>
                <RotateCcw size={13} /> Retry extraction
              </Button>
            </div>
          ) : (
            <BlueprintViewer
              ref={viewerRef}
              fileUrl={`/api/documents/${doc.id}/file`}
              fields={fields}
              activeFieldId={activeFieldId}
              onFieldClick={selectField}
              selectMode={correctingId != null && draft.picking}
              selectedRegion={correctingId != null ? draft.region : null}
              onRegionSelect={(bbox) => setDraft((d) => ({ ...d, region: bbox, picking: false }))}
            />
          )}
        </div>

        {/* field panel */}
        <div className="card flex w-[520px] shrink-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <ScanSearch size={14} className="text-ink-muted" />
              <h2 className="text-[13px] font-semibold">Extracted Data</h2>
            </div>
            <div className="flex items-center gap-1.5 text-[10.5px] text-ink-muted">
              <span className="h-2 w-2 rounded-sm bg-warn/80" /> review
              <span className="ml-1.5 h-2 w-2 rounded-sm bg-good/80" /> verified
              <span className="ml-1.5 h-2 w-2 rounded-sm bg-crit/80" /> corrected
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {doc.status !== 'completed' ? (
              <div className="flex h-40 items-center justify-center text-xs text-ink-muted">
                {doc.status === 'failed' ? 'No extraction available.' : 'Waiting for extraction to finish…'}
              </div>
            ) : (
              fields.map((f) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  active={f.id === activeFieldId}
                  documentId={doc.id}
                  onSelect={selectField}
                  correcting={f.id === correctingId}
                  onStartCorrection={startCorrection}
                  onCancelCorrection={() => setCorrectingId(null)}
                  draft={draft}
                  onDraftChange={(d) => setDraft((prev) => ({ ...prev, ...d }))}
                />
              ))
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
