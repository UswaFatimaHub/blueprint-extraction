import { Braces, FileText, FlaskConical, GitBranch, Rocket, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'

import { usePartTypes, usePromptPreview, usePromptVersions, usePublishVersion } from '../api/hooks'
import { Badge, Button, Modal, PageSpinner, Textarea } from '../components/ui'
import { cn, formatDate, formatPct } from '../lib/utils'

export default function PromptStudio() {
  const { data: partTypes } = usePartTypes()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const partTypeId = selectedId ?? partTypes?.[0]?.id
  const { data: preview, isLoading } = usePromptPreview(partTypeId)
  const { data: versions } = usePromptVersions()
  const publish = usePublishVersion()

  const [view, setView] = useState<'prompt' | 'schema'>('prompt')
  const [publishOpen, setPublishOpen] = useState(false)
  const [notes, setNotes] = useState('')

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Prompt Studio</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            The extraction prompt is assembled live from part-type fields, company standards and accumulated corrections.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => { setNotes(''); setPublishOpen(true) }}>
          <Rocket size={13} /> Publish version
        </Button>
      </div>

      <div className="flex gap-4">
        {/* assembled prompt */}
        <div className="card min-w-0 flex-[1.6] overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2">
              <FlaskConical size={14} className="text-ink-muted" />
              <h2 className="text-[13px] font-semibold">Live assembled prompt</h2>
              {versions?.[0] && <Badge tone="accent">next: v{versions[0].version_number + 1}.0</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <select
                className="input h-7 w-auto py-0 text-xs"
                value={partTypeId ?? ''}
                onChange={(e) => setSelectedId(Number(e.target.value))}
              >
                {partTypes?.map((pt) => (
                  <option key={pt.id} value={pt.id}>{pt.name}</option>
                ))}
              </select>
              <div className="flex overflow-hidden rounded-lg border border-line-strong">
                <button
                  className={cn('flex items-center gap-1 px-2.5 py-1 text-[11px]', view === 'prompt' ? 'bg-accent/20 text-sky-300' : 'text-ink-muted hover:text-ink')}
                  onClick={() => setView('prompt')}
                >
                  <FileText size={11} /> Prompt
                </button>
                <button
                  className={cn('flex items-center gap-1 px-2.5 py-1 text-[11px]', view === 'schema' ? 'bg-accent/20 text-sky-300' : 'text-ink-muted hover:text-ink')}
                  onClick={() => setView('schema')}
                >
                  <Braces size={11} /> API schema
                </button>
              </div>
            </div>
          </div>
          {isLoading || !preview ? (
            <PageSpinner />
          ) : (
            <pre className="max-h-[calc(100vh-220px)] overflow-auto whitespace-pre-wrap p-4 font-mono text-[11.5px] leading-relaxed text-ink-secondary">
              {view === 'prompt' ? preview.prompt_text : JSON.stringify(preview.page_schema, null, 2)}
            </pre>
          )}
        </div>

        {/* version history */}
        <div className="w-[320px] shrink-0">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <GitBranch size={14} className="text-ink-muted" />
              <h2 className="text-[13px] font-semibold">Version history</h2>
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
              {versions?.map((v, i) => {
                const prev = versions[i + 1]
                const delta =
                  v.accuracy != null && prev?.accuracy != null ? v.accuracy - prev.accuracy : null
                return (
                  <div key={v.id} className={cn('border-b border-line/60 px-4 py-3 last:border-0', i === 0 && 'bg-accent/[0.06]')}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold">{v.label}</span>
                        {i === 0 && <Badge tone="accent">active</Badge>}
                      </div>
                      <span className="text-[11px] text-ink-muted">{formatDate(v.created_at)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-[11.5px]">
                      <span className={cn('font-mono font-semibold tabular-nums', v.accuracy == null ? 'text-ink-muted' : v.accuracy >= 0.8 ? 'text-emerald-300' : 'text-amber-300')}>
                        {v.accuracy == null ? 'no reviews yet' : formatPct(v.accuracy, 1)}
                      </span>
                      {delta != null && delta !== 0 && (
                        <span className={cn('flex items-center gap-0.5 font-mono text-[10.5px]', delta > 0 ? 'text-emerald-300' : 'text-red-300')}>
                          {delta > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          {delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)}pt
                        </span>
                      )}
                      <span className="ml-auto text-ink-muted">{v.fields_reviewed} fields reviewed</span>
                    </div>
                    {v.notes && <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">{v.notes}</p>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title="Publish prompt version"
        subtitle="Snapshots the current configuration. New extractions will be attributed to this version so accuracy can be compared across versions."
      >
        <div className="space-y-3">
          <div>
            <label className="label">What changed?</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Added E8/E18 drive-size warning from 8 corrections; standardised material class format."
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={publish.isPending}
              onClick={() => publish.mutate({ notes }, { onSuccess: () => setPublishOpen(false) })}
            >
              <Rocket size={13} /> Publish
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
