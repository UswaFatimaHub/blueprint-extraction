import { Info, Pencil, Plus, Ruler, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useCreateStandard, useDeleteStandard, useStandards, useUpdateStandard } from '../api/hooks'
import type { StandardRule } from '../api/types'
import { Badge, Button, EmptyState, Input, Modal, PageSpinner, Switch, Textarea } from '../components/ui'
import { cn } from '../lib/utils'

interface RuleForm {
  id: number | null
  title: string
  rule: string
  context: string
}

const EMPTY: RuleForm = { id: null, title: '', rule: '', context: '' }

export default function Standards() {
  const { data: rules, isLoading } = useStandards()
  const createStandard = useCreateStandard()
  const updateStandard = useUpdateStandard()
  const deleteStandard = useDeleteStandard()

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<RuleForm>(EMPTY)

  if (isLoading) return <PageSpinner />

  const activeCount = rules?.filter((r) => r.active).length ?? 0

  const openEdit = (r: StandardRule) => {
    setForm({ id: r.id, title: r.title, rule: r.rule, context: r.context })
    setModalOpen(true)
  }

  const save = () => {
    const payload = { title: form.title.trim(), rule: form.rule.trim(), context: form.context.trim() }
    if (form.id == null) {
      createStandard.mutate({ ...payload, active: true }, { onSuccess: () => setModalOpen(false) })
    } else {
      updateStandard.mutate({ id: form.id, ...payload }, { onSuccess: () => setModalOpen(false) })
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Company Standards</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Formatting rules injected into every extraction prompt. {activeCount} of {rules?.length ?? 0} active.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => { setForm(EMPTY); setModalOpen(true) }}>
          <Plus size={13} /> Add rule
        </Button>
      </div>

      {!rules?.length ? (
        <div className="card">
          <EmptyState icon={<Ruler size={20} />} title="No standards configured">
            Add company-specific formatting rules — naming conventions, unit formats, equivalences — and the AI will
            apply them to every extraction.
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r, i) => (
            <div
              key={r.id}
              className={cn(
                'card group flex items-start gap-3.5 p-4 transition-opacity',
                !r.active && 'opacity-55',
              )}
            >
              <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[11px] text-ink-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold">{r.title}</h3>
                  {!r.active && <Badge tone="neutral">disabled</Badge>}
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{r.rule}</p>
                {r.context && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-muted">
                    <Info size={11.5} className="mt-0.5 shrink-0" />
                    {r.context}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => openEdit(r)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted opacity-0 transition-all hover:bg-surface-3 hover:text-ink group-hover:opacity-100"
                  title="Edit rule"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete rule "${r.title}"?`)) deleteStandard.mutate(r.id)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted opacity-0 transition-all hover:bg-crit/20 hover:text-red-300 group-hover:opacity-100"
                  title="Delete rule"
                >
                  <Trash2 size={13} />
                </button>
                <Switch
                  checked={r.active}
                  onChange={(v) => updateStandard.mutate({ id: r.id, active: v })}
                  label={`Toggle ${r.title}`}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id == null ? 'Add formatting rule' : 'Edit formatting rule'}
        subtitle="Written as an instruction to the AI — it is injected verbatim into the extraction prompt."
      >
        <div className="space-y-3">
          <div>
            <label className="label">Title</label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Drive nomenclature"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Rule (instruction to the AI)</label>
            <Textarea
              value={form.rule}
              onChange={(e) => setForm((f) => ({ ...f, rule: e.target.value }))}
              placeholder={`Use '6 Lobe' naming, not 'Torx' (e.g. 'T30 6 Lobe', never 'T30 Torx').`}
            />
          </div>
          <div>
            <label className="label">Context (why this rule exists)</label>
            <Textarea
              value={form.context}
              onChange={(e) => setForm((f) => ({ ...f, context: e.target.value }))}
              placeholder="Blueprints mix both namings; the parts catalog standardises on 6 Lobe."
              className="min-h-[52px]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.title.trim() || !form.rule.trim()}
              loading={createStandard.isPending || updateStandard.isPending}
              onClick={save}
            >
              {form.id == null ? 'Add rule' : 'Save changes'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
