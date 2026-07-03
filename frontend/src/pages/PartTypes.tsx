import { ChevronDown, ChevronUp, GripVertical, Plus, Save, Shapes, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  useCreatePartType,
  useDeletePartType,
  usePartTypes,
  useSaveFields,
  useUpdatePartType,
} from '../api/hooks'
import type { FieldDefinitionInput, PartType } from '../api/types'
import { Badge, Button, Input, Modal, PageSpinner, Switch, Textarea } from '../components/ui'
import { cn } from '../lib/utils'

function FieldEditor({ partType }: { partType: PartType }) {
  const saveFields = useSaveFields()
  const [rows, setRows] = useState<FieldDefinitionInput[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setRows(
      partType.fields.map((f) => ({
        id: f.id,
        key: f.key,
        label: f.label,
        description: f.description,
        example: f.example,
        active: f.active,
      })),
    )
    setDirty(false)
  }, [partType])

  const update = (i: number, patch: Partial<FieldDefinitionInput>) => {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  const move = (i: number, dir: -1 | 1) => {
    setRows((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setDirty(true)
  }
  const remove = (i: number) => {
    setRows((prev) => prev.filter((_, j) => j !== i))
    setDirty(true)
  }
  const add = () => {
    setRows((prev) => [...prev, { key: '', label: '', description: '', example: '', active: true }])
    setDirty(true)
  }

  const valid = rows.every((r) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(r.key) && r.label.trim())

  return (
    <div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={row.id ?? `new-${i}`} className={cn('rounded-lg border border-line bg-surface-2/60 p-3', !row.active && 'opacity-55')}>
            <div className="flex items-start gap-2.5">
              <div className="mt-1.5 flex flex-col items-center gap-0.5 text-ink-muted">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="hover:text-ink disabled:opacity-30">
                  <ChevronUp size={13} />
                </button>
                <GripVertical size={12} className="opacity-50" />
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="hover:text-ink disabled:opacity-30">
                  <ChevronDown size={13} />
                </button>
              </div>
              <div className="grid flex-1 grid-cols-[1fr_1.2fr_1.2fr] gap-2.5">
                <div>
                  <label className="label">Key</label>
                  <Input
                    value={row.key}
                    onChange={(e) => update(i, { key: e.target.value })}
                    placeholder="threadSpec"
                    className={cn('font-mono text-xs', row.key && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(row.key) && 'border-crit')}
                  />
                </div>
                <div>
                  <label className="label">Label</label>
                  <Input value={row.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Thread Specification" />
                </div>
                <div>
                  <label className="label">Example values</label>
                  <Input value={row.example} onChange={(e) => update(i, { example: e.target.value })} placeholder="M12-1.25" />
                </div>
              </div>
              <div className="mt-6 flex items-center gap-2">
                <Switch checked={row.active} onChange={(v) => update(i, { active: v })} label="Field active" />
                <button
                  onClick={() => remove(i)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-crit/20 hover:text-red-300"
                  title="Remove field"
                >
                  <Trash2 size={13.5} />
                </button>
              </div>
            </div>
            <div className="ml-[26px] mt-2">
              <label className="label">Extraction hint for the AI</label>
              <Textarea
                value={row.description}
                onChange={(e) => update(i, { description: e.target.value })}
                className="min-h-[46px] text-xs"
                placeholder="Describe where this value appears on the drawing and how to format it…"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={add}>
          <Plus size={13} /> Add field
        </Button>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-[11px] text-amber-300">unsaved changes</span>}
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || !valid}
            loading={saveFields.isPending}
            onClick={() =>
              saveFields.mutate(
                { partTypeId: partType.id, fields: rows },
                { onSuccess: () => setDirty(false) },
              )
            }
          >
            <Save size={13} /> Save fields
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function PartTypes() {
  const { data: partTypes, isLoading } = usePartTypes()
  const createPartType = useCreatePartType()
  const updatePartType = useUpdatePartType()
  const deletePartType = useDeletePartType()

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })

  const selected = partTypes?.find((p) => p.id === selectedId) ?? partTypes?.[0]

  if (isLoading) return <PageSpinner />

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Part Types</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            Each part type defines the fields the AI extracts. The extraction prompt is assembled from this configuration at runtime.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => { setForm({ name: '', description: '' }); setModalOpen(true) }}>
          <Plus size={13} /> New part type
        </Button>
      </div>

      <div className="flex gap-4">
        {/* list */}
        <div className="w-56 shrink-0 space-y-1.5">
          {partTypes?.map((pt) => (
            <button
              key={pt.id}
              onClick={() => setSelectedId(pt.id)}
              className={cn(
                'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                selected?.id === pt.id
                  ? 'border-accent/40 bg-accent/10'
                  : 'border-line bg-surface-1 hover:bg-surface-2',
              )}
            >
              <div className="flex items-center gap-2">
                <Shapes size={13} className={selected?.id === pt.id ? 'text-sky-300' : 'text-ink-muted'} />
                <span className="text-[13px] font-medium">{pt.name}</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">
                {pt.fields.filter((f) => f.active).length} active fields
              </p>
            </button>
          ))}
        </div>

        {/* editor */}
        {selected && (
          <div className="card min-w-0 flex-1 p-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold">{selected.name}</h2>
                  <Badge tone="neutral">{selected.fields.length} fields</Badge>
                </div>
                {selected.description && <p className="mt-1 max-w-xl text-xs text-ink-muted">{selected.description}</p>}
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (confirm(`Delete part type "${selected.name}" and its field configuration?`)) {
                    deletePartType.mutate(selected.id, { onSuccess: () => setSelectedId(null) })
                  }
                }}
              >
                <Trash2 size={13} /> Delete
              </Button>
            </div>
            <FieldEditor partType={selected} />
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New part type"
        subtitle="e.g. Gasket, Bearing, Bracket — you'll define its extraction fields next."
      >
        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Gasket" autoFocus />
          </div>
          <div>
            <label className="label">Description</label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Sealing gaskets — flat, ring and profile types."
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.name.trim()}
              loading={createPartType.isPending}
              onClick={() =>
                createPartType.mutate(form, {
                  onSuccess: (pt) => {
                    setModalOpen(false)
                    setSelectedId(pt.id)
                  },
                })
              }
            >
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
