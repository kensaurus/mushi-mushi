/**
 * FILE: apps/admin/src/components/Confetti.tsx
 * PURPOSE: Pure-CSS confetti burst for peak-end celebration moments. Used
 *          by the first-fix-merged trigger on the dashboard so the user
 *          gets a visible reward the first time their PDCA loop closes.
 *
 *          No third-party library: 14 absolutely-positioned squares with
 *          randomised drift/rotation via CSS custom properties. Auto-cleans
 *          after 1.5s. Gated by the `motion-safe:` Tailwind variant so
 *          users with reduced-motion preferences see nothing animated.
 */

import { useEffect, useState, type CSSProperties } from 'react'

interface Piece {
  id: number
  left: number
  delay: number
  tx: number
  ty: number
  rot: number
  bg: string
  size: number
}

const PALETTE = [
  'bg-brand',
  'bg-ok',
  'bg-info',
  'bg-warn',
  'bg-danger',
]

function makePieces(count: number): Piece[] {
  // Pseudo-random but deterministic per-mount: each piece picks a colour from
  // the palette and a small random drift so the burst feels organic without
  // pulling in a heavy `random()` per frame.
  const out: Piece[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: i,
      left: Math.round(Math.random() * 90 + 5),
      delay: Math.round(Math.random() * 120),
      tx: Math.round((Math.random() - 0.5) * 240),
      ty: Math.round(80 + Math.random() * 180),
      rot: Math.round((Math.random() - 0.5) * 720),
      bg: PALETTE[i % PALETTE.length],
      size: 6 + Math.round(Math.random() * 6),
    })
  }
  return out
}

interface Props {
  /** Bumping this key (re-)triggers the burst. Pass a string that changes
   *  exactly once per celebration (e.g. the milestone name + timestamp). */
  triggerKey: string | number | null
  /** Total burst pieces. Defaults to 16 — enough to feel celebratory without
   *  becoming a layout shift. */
  count?: number
}

export function Confetti({ triggerKey, count = 16 }: Props) {
  const [active, setActive] = useState<{ key: string | number; pieces: Piece[] } | null>(null)

  useEffect(() => {
    if (triggerKey == null) return
    setActive({ key: triggerKey, pieces: makePieces(count) })
    const t = setTimeout(() => setActive(null), 1600)
    return () => clearTimeout(t)
  }, [triggerKey, count])

  if (!active) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-16 z-[70] mx-auto h-0 w-0"
    >
      {active.pieces.map((p) => {
        const style: CSSProperties = {
          left: `${p.left - 50}vw`,
          width: `${p.size}px`,
          height: `${p.size}px`,
          animationDelay: `${p.delay}ms`,
          // Pass per-piece drift through CSS variables consumed by the
          // `mushi-confetti-fall` keyframe in index.css.
          ['--mushi-tx' as string]: `${p.tx}px`,
          ['--mushi-ty' as string]: `${p.ty}px`,
          ['--mushi-rot' as string]: `${p.rot}deg`,
        }
        return (
          <span
            key={p.id}
            className={`absolute top-0 rounded-sm ${p.bg} motion-safe:animate-mushi-confetti-fall`}
            style={style}
          />
        )
      })}
    </div>
  )
}
