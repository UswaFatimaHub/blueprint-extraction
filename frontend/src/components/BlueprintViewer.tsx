import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Loader2,
  Maximize,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { BBox, ExtractedField } from '../api/types'
import { cn } from '../lib/utils'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// ---------------------------------------------------------------------------
// Types & math helpers
// ---------------------------------------------------------------------------

interface View {
  s: number
  tx: number
  ty: number
  r: 0 | 90 | 180 | 270
}

export interface ViewerHandle {
  zoomToField: (field: ExtractedField) => void
  zoomToBBox: (bbox: BBox, page: number) => void
}

/** rotate page-space point about origin by r degrees */
const rot = (x: number, y: number, r: number): [number, number] => {
  switch (((r % 360) + 360) % 360) {
    case 90:
      return [-y, x]
    case 180:
      return [-x, -y]
    case 270:
      return [y, -x]
    default:
      return [x, y]
  }
}

const unrot = (x: number, y: number, r: number): [number, number] => rot(x, y, (360 - r) % 360)

const fieldTone = {
  verified: { border: '#0CA30C', fill: 'rgba(12,163,12,0.14)', chip: 'bg-[#0CA30C]' },
  corrected: { border: '#D03B3B', fill: 'rgba(208,59,59,0.14)', chip: 'bg-[#D03B3B]' },
  unverified: { border: '#FAB219', fill: 'rgba(250,178,25,0.13)', chip: 'bg-[#B97F05]' },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  fileUrl: string
  fields: ExtractedField[]
  activeFieldId: number | null
  onFieldClick: (field: ExtractedField) => void
  selectMode: boolean
  onRegionSelect: (bbox: BBox) => void
  selectedRegion: BBox | null
}

const BlueprintViewer = forwardRef<ViewerHandle, Props>(function BlueprintViewer(
  { fileUrl, fields, activeFieldId, onFieldClick, selectMode, onRegionSelect, selectedRegion },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null)

  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0, r: 0 })
  const [animate, setAnimate] = useState(false)
  const [rendering, setRendering] = useState(true)
  const [showBoxes, setShowBoxes] = useState(true)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [renderScale, setRenderScale] = useState(2)
  const [dragSel, setDragSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  const pendingZoom = useRef<{ bbox: BBox; page: number } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const pageSizeRef = useRef(pageSize)
  pageSizeRef.current = pageSize

  // ---- document loading ----------------------------------------------------

  useEffect(() => {
    let cancelled = false
    setPdf(null)
    setError(null)
    const task = pdfjs.getDocument(fileUrl)
    task.promise
      .then((doc) => !cancelled && setPdf(doc))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)))
    return () => {
      cancelled = true
      task.destroy().catch(() => {})
    }
  }, [fileUrl])

  // ---- page rendering --------------------------------------------------------

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    setRendering(true)
    pdf
      .getPage(page)
      .then((p) => {
        if (cancelled) return
        const vp1 = p.getViewport({ scale: 1 })
        setPageSize((prev) =>
          prev && prev.w === vp1.width && prev.h === vp1.height ? prev : { w: vp1.width, h: vp1.height },
        )
        const dpr = window.devicePixelRatio || 1
        const vp = p.getViewport({ scale: renderScale * dpr })
        const canvas = canvasRef.current
        if (!canvas) return // canvas mounts once pageSize is known; the pageSize dep re-runs this effect
        renderTaskRef.current?.cancel()
        const ctx = canvas.getContext('2d')!
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        const task = p.render({ canvasContext: ctx, viewport: vp })
        renderTaskRef.current = task
        task.promise
          .then(() => !cancelled && setRendering(false))
          .catch(() => {}) // cancelled renders are fine
      })
      .catch(() => !cancelled && setRendering(false))
    return () => {
      cancelled = true
    }
  }, [pdf, page, renderScale, pageSize])

  // ---- fit / view helpers ------------------------------------------------------

  const fitView = useCallback((r: View['r'] = viewRef.current.r, doAnimate = false) => {
    const el = containerRef.current
    const ps = pageSizeRef.current
    if (!el || !ps) return
    const cw = el.clientWidth
    const ch = el.clientHeight
    const rotated = r === 90 || r === 270
    const pw = rotated ? ps.h : ps.w
    const ph = rotated ? ps.w : ps.h
    const s = Math.min((cw - 48) / pw, (ch - 48) / ph)
    // bounding box of rotated page starts at negative offsets; compute min corner
    const corners: [number, number][] = [
      rot(0, 0, r),
      rot(ps.w, 0, r),
      rot(0, ps.h, r),
      rot(ps.w, ps.h, r),
    ]
    const minX = Math.min(...corners.map((c) => c[0]))
    const minY = Math.min(...corners.map((c) => c[1]))
    const tx = (cw - pw * s) / 2 - minX * s
    const ty = (ch - ph * s) / 2 - minY * s
    setAnimate(doAnimate)
    setView({ s, tx, ty, r })
  }, [])

  // refit when page geometry first becomes known or page changes
  useEffect(() => {
    if (pageSize) fitView(viewRef.current.r, false)
  }, [pageSize, page, fitView])

  // execute pending zoom-to-bbox once the right page is mounted
  useEffect(() => {
    if (!pendingZoom.current || !pageSize) return
    const { bbox, page: targetPage } = pendingZoom.current
    if (targetPage !== page - 1) return
    pendingZoom.current = null
    zoomToBBoxInternal(bbox)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, page])

  const zoomToBBoxInternal = useCallback((bbox: BBox) => {
    const el = containerRef.current
    const ps = pageSizeRef.current
    if (!el || !ps) return
    const { r } = viewRef.current
    const bw = Math.max(bbox.w * ps.w, 8)
    const bh = Math.max(bbox.h * ps.h, 8)
    const rotated = r === 90 || r === 270
    const targetW = rotated ? bh : bw
    const targetH = rotated ? bw : bh
    const cw = el.clientWidth
    const ch = el.clientHeight
    const s = Math.min(Math.min((cw * 0.55) / targetW, (ch * 0.45) / targetH), 9)
    const cx = (bbox.x + bbox.w / 2) * ps.w
    const cy = (bbox.y + bbox.h / 2) * ps.h
    const [rx, ry] = rot(cx, cy, r)
    setAnimate(true)
    setView({ s, tx: cw / 2 - rx * s, ty: ch / 2 - ry * s, r })
  }, [])

  const zoomToBBox = useCallback(
    (bbox: BBox, targetPage: number) => {
      if (targetPage !== page - 1) {
        pendingZoom.current = { bbox, page: targetPage }
        setPage(targetPage + 1)
      } else {
        zoomToBBoxInternal(bbox)
      }
    },
    [page, zoomToBBoxInternal],
  )

  useImperativeHandle(ref, () => ({
    zoomToBBox,
    zoomToField: (field: ExtractedField) => {
      if (field.bbox_x == null || field.page == null) return
      zoomToBBox(
        { x: field.bbox_x, y: field.bbox_y!, w: field.bbox_w!, h: field.bbox_h! },
        field.page,
      )
    },
  }))

  // ---- adaptive render quality ---------------------------------------------------

  useEffect(() => {
    const t = setTimeout(() => {
      const target = Math.min(4, Math.max(2, Math.ceil(view.s)))
      setRenderScale((prev) => (target > prev ? target : prev))
    }, 350)
    return () => clearTimeout(t)
  }, [view.s])

  // ---- interaction: wheel zoom (native listener for preventDefault) ---------------

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const { s, tx, ty, r } = viewRef.current
      const factor = Math.exp(-e.deltaY * 0.0016)
      const ns = Math.min(Math.max(s * factor, 0.05), 12)
      setAnimate(false)
      setView({
        s: ns,
        tx: px - ((px - tx) * ns) / s,
        ty: py - ((py - ty) * ns) / s,
        r,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- interaction: pan & region select --------------------------------------------

  const screenToPage = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const el = containerRef.current
    const ps = pageSizeRef.current
    if (!el || !ps) return null
    const rect = el.getBoundingClientRect()
    const { s, tx, ty, r } = viewRef.current
    const sx = (clientX - rect.left - tx) / s
    const sy = (clientY - rect.top - ty) / s
    const [x, y] = unrot(sx, sy, r)
    return [x, y]
  }, [])

  const dragState = useRef<{ mode: 'pan' | 'select'; startX: number; startY: number; tx0: number; ty0: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    if (selectMode) {
      const pt = screenToPage(e.clientX, e.clientY)
      if (!pt) return
      dragState.current = { mode: 'select', startX: pt[0], startY: pt[1], tx0: 0, ty0: 0 }
      setDragSel({ x0: pt[0], y0: pt[1], x1: pt[0], y1: pt[1] })
    } else {
      dragState.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        tx0: viewRef.current.tx,
        ty0: viewRef.current.ty,
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragState.current
    if (!d) return
    if (d.mode === 'pan') {
      setAnimate(false)
      setView((v) => ({ ...v, tx: d.tx0 + (e.clientX - d.startX), ty: d.ty0 + (e.clientY - d.startY) }))
    } else {
      const pt = screenToPage(e.clientX, e.clientY)
      if (pt) setDragSel({ x0: d.startX, y0: d.startY, x1: pt[0], y1: pt[1] })
    }
  }

  const onPointerUp = () => {
    const d = dragState.current
    dragState.current = null
    if (d?.mode === 'select' && dragSel && pageSize) {
      const x = Math.min(dragSel.x0, dragSel.x1)
      const y = Math.min(dragSel.y0, dragSel.y1)
      const w = Math.abs(dragSel.x1 - dragSel.x0)
      const h = Math.abs(dragSel.y1 - dragSel.y0)
      setDragSel(null)
      if (w > 6 && h > 6) {
        onRegionSelect({
          x: Math.max(0, x / pageSize.w),
          y: Math.max(0, y / pageSize.h),
          w: Math.min(1, w / pageSize.w),
          h: Math.min(1, h / pageSize.h),
          page: page - 1,
        })
      }
    }
  }

  // ---- derived -------------------------------------------------------------------

  const pageFields = useMemo(
    () => fields.filter((f) => f.bbox_x != null && f.page === page - 1),
    [fields, page],
  )
  const pageCount = pdf?.numPages ?? 1

  const zoomBy = (factor: number) => {
    const el = containerRef.current
    if (!el) return
    const { s, tx, ty, r } = viewRef.current
    const cx = el.clientWidth / 2
    const cy = el.clientHeight / 2
    const ns = Math.min(Math.max(s * factor, 0.05), 12)
    setAnimate(true)
    setView({ s: ns, tx: cx - ((cx - tx) * ns) / s, ty: cy - ((cy - ty) * ns) / s, r })
  }

  const rotate = () => {
    const next = ((view.r + 90) % 360) as View['r']
    fitView(next, true)
  }

  // ---- render ---------------------------------------------------------------------

  const toolBtn =
    'flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:pointer-events-none'

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-[#0D1420]">
      {/* toolbar */}
      <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line bg-surface-1/95 px-1.5 py-1 shadow-pop backdrop-blur">
        <button className={toolBtn} onClick={() => zoomBy(1.4)} title="Zoom in">
          <ZoomIn size={14.5} />
        </button>
        <button className={toolBtn} onClick={() => zoomBy(1 / 1.4)} title="Zoom out">
          <ZoomOut size={14.5} />
        </button>
        <button className={toolBtn} onClick={() => fitView(view.r, true)} title="Fit to screen">
          <Maximize size={13.5} />
        </button>
        <button className={toolBtn} onClick={rotate} title="Rotate 90°">
          <RotateCw size={13.5} />
        </button>
        <div className="mx-1 h-4 w-px bg-line-strong" />
        <button
          className={cn(toolBtn, showBoxes && 'bg-accent/15 text-sky-300')}
          onClick={() => setShowBoxes((v) => !v)}
          title={showBoxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
        >
          {showBoxes ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        {pageCount > 1 && (
          <>
            <div className="mx-1 h-4 w-px bg-line-strong" />
            <button className={toolBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} title="Previous page">
              <ChevronLeft size={15} />
            </button>
            <span className="px-1 font-mono text-[11px] tabular-nums text-ink-secondary">
              {page}/{pageCount}
            </span>
            <button
              className={toolBtn}
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              title="Next page"
            >
              <ChevronRight size={15} />
            </button>
          </>
        )}
        <div className="mx-1 h-4 w-px bg-line-strong" />
        <span className="px-1 font-mono text-[11px] tabular-nums text-ink-muted">{Math.round(view.s * 100)}%</span>
      </div>

      {/* select-mode hint */}
      {selectMode && (
        <div className="absolute left-1/2 top-14 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs text-sky-200 shadow-pop backdrop-blur animate-fade-in">
          <Crosshair size={13} />
          Drag a box around the correct value on the drawing
        </div>
      )}

      {/* canvas stage */}
      <div
        ref={containerRef}
        className={cn(
          'blueprint-grid relative flex-1 touch-none overflow-hidden',
          selectMode ? 'cursor-crosshair' : dragState.current ? 'cursor-grabbing' : 'cursor-grab',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={(e) => {
          if (!selectMode) {
            const rect = containerRef.current!.getBoundingClientRect()
            const px = e.clientX - rect.left
            const py = e.clientY - rect.top
            const { s, tx, ty, r } = viewRef.current
            const ns = Math.min(s * 2, 12)
            setAnimate(true)
            setView({ s: ns, tx: px - ((px - tx) * ns) / s, ty: py - ((py - ty) * ns) / s, r })
          }
        }}
      >
        {error ? (
          <div className="flex h-full items-center justify-center text-sm text-red-300">{error}</div>
        ) : !pdf || !pageSize ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-muted">
            <Loader2 size={16} className="animate-spin" /> Loading blueprint…
          </div>
        ) : null}

        {pageSize && (
          <div
            className="absolute left-0 top-0"
            style={{
              width: pageSize.w,
              height: pageSize.h,
              transformOrigin: '0 0',
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s}) rotate(${view.r}deg)`,
              transition: animate ? 'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
            }}
          >
            <canvas
              ref={canvasRef}
              className="block bg-white shadow-[0_0_0_1px_rgba(148,163,184,0.25),0_24px_80px_-24px_rgba(0,0,0,0.9)]"
              style={{ width: pageSize.w, height: pageSize.h }}
            />
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/40">
                <Loader2 size={18} className="animate-spin text-slate-500" />
              </div>
            )}

            {/* field bounding boxes */}
            {showBoxes &&
              pageFields.map((f) => {
                const tone = fieldTone[f.status]
                const active = f.id === activeFieldId
                const hovered = f.id === hoveredId
                const pad = 3 / view.s
                return (
                  <div
                    key={f.id}
                    className={cn('absolute cursor-pointer', active && 'bbox-pulse z-10')}
                    style={{
                      left: f.bbox_x! * pageSize.w - pad,
                      top: f.bbox_y! * pageSize.h - pad,
                      width: f.bbox_w! * pageSize.w + pad * 2,
                      height: f.bbox_h! * pageSize.h + pad * 2,
                      border: `${Math.max(1.2 / view.s, 0.4)}px solid ${tone.border}`,
                      borderWidth: active || hovered ? Math.max(2.2 / view.s, 0.6) : Math.max(1.2 / view.s, 0.4),
                      background: active || hovered ? tone.fill : 'transparent',
                      borderRadius: 3 / view.s,
                    }}
                    onPointerDown={(e) => {
                      if (!selectMode) {
                        e.stopPropagation()
                        onFieldClick(f)
                      }
                    }}
                    onMouseEnter={() => setHoveredId(f.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {(active || hovered) && (
                      <span
                        className={cn(
                          'absolute left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow',
                          tone.chip,
                        )}
                        style={{
                          bottom: '100%',
                          marginBottom: 4 / view.s,
                          transformOrigin: 'bottom left',
                          transform: `rotate(${-view.r}deg) scale(${1 / view.s})`,
                        }}
                      >
                        {f.label}
                        {f.confidence != null && (
                          <span className="ml-1.5 opacity-75">{Math.round(f.confidence * 100)}%</span>
                        )}
                      </span>
                    )}
                  </div>
                )
              })}

            {/* saved corrected-location region */}
            {selectedRegion && selectedRegion.page === page - 1 && (
              <div
                className="absolute border-dashed"
                style={{
                  left: selectedRegion.x * pageSize.w,
                  top: selectedRegion.y * pageSize.h,
                  width: selectedRegion.w * pageSize.w,
                  height: selectedRegion.h * pageSize.h,
                  border: `${Math.max(1.5 / view.s, 0.5)}px dashed #3987E5`,
                  background: 'rgba(57,135,229,0.12)',
                  borderRadius: 3 / view.s,
                }}
              />
            )}

            {/* live drag selection */}
            {dragSel && (
              <div
                className="absolute"
                style={{
                  left: Math.min(dragSel.x0, dragSel.x1),
                  top: Math.min(dragSel.y0, dragSel.y1),
                  width: Math.abs(dragSel.x1 - dragSel.x0),
                  height: Math.abs(dragSel.y1 - dragSel.y0),
                  border: `${Math.max(1.5 / view.s, 0.5)}px solid #3987E5`,
                  background: 'rgba(57,135,229,0.15)',
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
})

export default BlueprintViewer
