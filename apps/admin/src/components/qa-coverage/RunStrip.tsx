/**
 * FILE: apps/admin/src/components/qa-coverage/RunStrip.tsx
 * PURPOSE: A story's last 7 days at a glance: one heat cell per UTC day with a
 *          glyph, so colour is never the only signal (2026-11-19: seven empty
 *          boxes sat under "24 runs · 24h" with no reason).
 *            ✕ red    any run failed that day
 *            ✓ green  every finished run passed
 *            ⊘ grey   only skipped runs (the runner never ran it)
 *            ○ blank  no run at all
 *          Skipped runs never count as failures (server: buildRunStrips in
 *          qa-coverage.ts; an older server sends no `skipped`, read as 0).
 */

import { StatusMark, STATUS_SOFT } from '../signal/StatusMark'
import { stripDayStatus, type StripDayCounts } from '../../lib/qaSkipReason'

export type RunStripDay = StripDayCounts

type DayTone = 'pass' | 'fail' | 'skip' | 'none'

/** @internal Exported for tests only. */
export function dayTone(d: RunStripDay): DayTone {
  const s = stripDayStatus(d)
  return s === 'failed' ? 'fail' : s === 'passed' ? 'pass' : s === 'cancelled' ? 'skip' : 'none'
}

function dayLabel(d: RunStripDay): string {
  const date = new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const skipped = d.skipped ?? 0
  if (d.passed + d.failed === 0) return skipped > 0 ? `${date}: ${skipped} skipped, nothing checked` : `${date}: no runs`
  return `${date}: ${d.passed} passed, ${d.failed} failed${skipped > 0 ? `, ${skipped} skipped` : ''}`
}

export function RunStrip({ days }: { days: readonly RunStripDay[] }) {
  if (days.length === 0) return null
  return (
    <div className="flex items-center gap-2" data-testid="qa-run-strip">
      <span className="shrink-0 text-3xs text-fg-secondary">7 days</span>
      <ol className="flex list-none gap-0.5 p-0" aria-label="Result per day, last 7 days">
        {days.map((d) => {
          const status = stripDayStatus(d)
          return (
            <li
              key={d.day}
              title={dayLabel(d)}
              data-tone={dayTone(d)}
              className={`sig-cell flex h-4 w-4 items-center justify-center rounded-xs border ${status === 'idle' ? 'border-edge-subtle bg-surface-overlay' : STATUS_SOFT[status]}`}
            >
              {status !== 'idle' && <StatusMark status={status} size={9} />}
              <span className="sr-only">{dayLabel(d)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
