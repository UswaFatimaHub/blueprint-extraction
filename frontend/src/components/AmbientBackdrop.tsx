import { useEffect, useRef } from 'react'

/**
 * Two soft accent-tinted glows that trail the cursor at different speeds,
 * sitting behind all content (and showing faintly through translucent cards).
 * Positions are written straight to the DOM from one rAF loop — no re-renders.
 * Honors prefers-reduced-motion by staying static.
 */
export default function AmbientBackdrop() {
  const primary = useRef<HTMLDivElement>(null)
  const echo = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const a = primary.current
    const b = echo.current
    if (!a || !b) return

    let tx = window.innerWidth * 0.72
    let ty = window.innerHeight * 0.22
    let ax = tx
    let ay = ty
    let bx = window.innerWidth * 0.25
    let by = window.innerHeight * 0.75
    let raf = 0
    let last = performance.now()

    const place = () => {
      a.style.transform = `translate3d(${ax - 340}px, ${ay - 340}px, 0)`
      // the echo drifts toward the mirrored position, much slower
      b.style.transform = `translate3d(${bx - 260}px, ${by - 260}px, 0)`
    }
    place()

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const onMove = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
    }

    const tick = (now: number) => {
      // frame-rate independent easing
      const dt = Math.min((now - last) / 16.7, 3)
      last = now
      ax += (tx - ax) * 0.045 * dt
      ay += (ty - ay) * 0.045 * dt
      bx += (window.innerWidth - tx - bx) * 0.018 * dt
      by += (window.innerHeight - ty - by) * 0.018 * dt
      place()
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        ref={primary}
        className="absolute left-0 top-0 h-[680px] w-[680px] rounded-full will-change-transform"
        style={{ background: 'radial-gradient(circle, rgb(var(--accent) / 0.09) 0%, rgb(var(--accent) / 0.03) 38%, transparent 62%)' }}
      />
      <div
        ref={echo}
        className="absolute left-0 top-0 h-[520px] w-[520px] rounded-full will-change-transform"
        style={{ background: 'radial-gradient(circle, rgb(var(--accent) / 0.055) 0%, transparent 60%)' }}
      />
    </div>
  )
}
