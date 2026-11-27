/**
 * FILE: apps/admin/src/components/timeline/TimelineRail.tsx
 * PURPOSE: The Timeline's horizontal rail (ADR 0072): one stop per release
 *          (or per UX run when the app has no releases), oldest on the left.
 *          Each stop shows what it closed, improved and cost. Pick a stop by
 *          clicking it, scrubbing the range under the rail, or the arrow keys
 *          on either; the rail keeps the picked stop in view.
 *
 *          Motion: the picked stop lifts with a transform only, and nothing
 *          moves under prefers-reduced-motion.
 */

import { useEffect, useRef } from 'react'
import { formatRelative } from '../ui/metrics'
import { formatCost, pointTone, type TimelinePoint } from '../../lib/timeline'

const DOT_TONE: Record<string, string> = {
  ok: 'bg-ok',
  info: 'bg-info',
  danger: 'bg-danger',
  brand: 'bg-brand',
  neutral: 'bg-fg-muted',
}

export function TimelineRail({ points, selected, onSelect }: { points: TimelinePoint[]; selected: number; onSelect: (i: number) => void }) {
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-rail-index="${selected}"]`)
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [selected])
  if (!points.length) return null
  const move = (key: string) => {
    if (key === 'ArrowLeft') onSelect(Math.max(0, selected - 1))
    else if (key === 'ArrowRight') onSelect(Math.min(points.length - 1, selected + 1))
    else if (key === 'Home') onSelect(0)
    else if (key === 'End') onSelect(points.length - 1)
    else return false
    return true
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-x-auto pb-1">
        {/* The line the stops sit on. */}
        <div aria-hidden className="absolute left-4 right-4 top-5.5 h-px bg-edge" />
        <ol ref={listRef} aria-label="Releases and runs, oldest first" className="relative flex min-w-full gap-2 px-1">
          {points.map((p, i) => {
            const on = i === selected
            const tone = pointTone(p)
            return (
              <li key={p.id} data-rail-index={i} className="shrink-0">
                <button
                  type="button"
                  aria-current={on ? 'step' : undefined}
                  tabIndex={on ? 0 : -1}
                  onClick={() => onSelect(i)}
                  onKeyDown={(e) => {
                    if (move(e.key)) e.preventDefault()
                  }}
                  className={`flex w-36 flex-col items-start gap-1 rounded-md border px-2.5 pb-2 pt-1.5 text-left motion-safe:transition-transform motion-safe:duration-200 ${
                    on ? 'border-brand/40 bg-surface-raised shadow-card motion-safe:-translate-y-0.5' : 'border-transparent hover:bg-surface-raised'
                  }`}
                >
                  <span aria-hidden className={`mb-1 h-3 w-3 rounded-full ring-4 ring-surface ${DOT_TONE[tone] ?? 'bg-fg-muted'}`} />
                  <span className="w-full truncate text-xs font-semibold text-fg">{p.label}</span>
                  <span className="text-2xs text-fg-muted">{formatRelative(p.at)}</span>
                  <span className="flex flex-wrap gap-x-2 text-2xs text-fg-secondary">
                    {p.reports_closed > 0 && <span>{p.reports_closed} fixed</span>}
                    {p.improved_screens > 0 && <span>{p.improved_screens} improved</span>}
                    {p.score != null && <span>{p.score}/10</span>}
                    {p.cost_usd != null && <span>{formatCost(p.cost_usd)}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
      {points.length > 1 && (
        <input
          type="range"
          min={0}
          max={points.length - 1}
          step={1}
          value={selected}
          onChange={(e) => onSelect(Number(e.target.value))}
          aria-label="Scrub through releases and runs"
          aria-valuetext={`${points[selected]?.label ?? ''}, ${selected + 1} of ${points.length}`}
          className="w-full accent-brand"
        />
      )}
    </div>
  )
}
