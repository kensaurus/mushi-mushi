/**
 * FILE: apps/admin/src/components/qa-coverage/RunStrip.tsx
 * PURPOSE: A story's last 7 days at a glance (console journeys 2026-10-27):
 *          one square per UTC day, green when every finished run passed, red
 *          when any failed, grey with no finished run. Skipped runs never
 *          count as failures (server: buildRunStrips in qa-coverage.ts).
 */

export interface RunStripDay {
  day: string
  passed: number
  failed: number
}

type DayTone = 'pass' | 'fail' | 'none'

/** @internal Exported for tests only. */
export function dayTone(d: RunStripDay): DayTone {
  if (d.failed > 0) return 'fail'
  if (d.passed > 0) return 'pass'
  return 'none'
}

const TONE: Record<DayTone, string> = {
  pass: 'bg-ok',
  fail: 'bg-danger',
  none: 'bg-surface-overlay border border-edge-subtle',
}

function dayLabel(d: RunStripDay): string {
  const date = new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  if (d.passed + d.failed === 0) return `${date}: no runs`
  return `${date}: ${d.passed} passed, ${d.failed} failed`
}

export function RunStrip({ days }: { days: readonly RunStripDay[] }) {
  if (days.length === 0) return null
  return (
    <div className="flex items-center gap-2" data-testid="qa-run-strip">
      <span className="shrink-0 text-3xs text-fg-faint">7 days</span>
      <ol className="flex list-none gap-0.5 p-0" aria-label="Pass or fail per day, last 7 days">
        {days.map((d) => (
          <li key={d.day} title={dayLabel(d)} data-tone={dayTone(d)} className={`h-3 w-3 rounded-xs ${TONE[dayTone(d)]}`}>
            <span className="sr-only">{dayLabel(d)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
