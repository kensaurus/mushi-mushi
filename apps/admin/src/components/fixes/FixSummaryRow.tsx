/**
 * FILE: apps/admin/src/components/fixes/FixSummaryRow.tsx
 * PURPOSE: 5-tile KPI strip + 30-day daily-volume sparkline for the auto-fix
 *          pipeline. Pure presentation — accepts a pre-computed FixSummary.
 */

import { useMemo } from 'react'
import { KpiRow, KpiTile, type KpiDelta, type Tone } from '../charts'
import type { FixSummary } from './types'

interface Props {
  summary: FixSummary
  successRate: number | null
}

function pctDelta(values: number[], opts: { invert?: boolean } = {}): KpiDelta | null {
  if (values.length < 14) return null
  const half = Math.floor(values.length / 2)
  const last = values.slice(-half).reduce((a, n) => a + n, 0)
  const prev = values.slice(0, values.length - half).reduce((a, n) => a + n, 0)
  if (last === 0 && prev === 0) return null
  if (prev === 0) return { value: 'new', direction: 'up', tone: opts.invert ? 'warn' : 'ok' }
  const pct = Math.round(((last - prev) / prev) * 100)
  if (pct === 0) return { value: '0%', direction: 'flat', tone: 'muted' }
  return {
    value: `${Math.abs(pct)}%`,
    direction: pct > 0 ? 'up' : 'down',
    tone: opts.invert ? (pct > 0 ? 'warn' : 'ok') : (pct > 0 ? 'ok' : 'warn'),
  }
}

export function FixSummaryRow({ summary, successRate }: Props) {
  // Build per-tile sparklines from the same `days` array so each KPI shows
  // both the count and the trajectory. Completed = good when up; failed =
  // bad when up; total = neutral but informative.
  const totals = useMemo(() => summary.days.map((d) => d.total), [summary.days])
  const completed = useMemo(() => summary.days.map((d) => d.completed), [summary.days])
  const failed = useMemo(() => summary.days.map((d) => d.failed), [summary.days])

  return (
    <KpiRow cols={5}>
      <KpiTile
        label="Attempts (30d)"
        value={summary.total}
        sublabel="dispatched in last 30 days"
        series={totals}
        delta={pctDelta(totals)}
        seriesAriaLabel="Daily fix attempts, last 30 days"
        meaning="Every time Mushi handed a report to the auto-fix agent. Includes successes, failures, and runs still in flight."
      />
      <KpiTile
        label="Completed"
        value={summary.completed}
        accent={summary.completed > 0 ? 'ok' : 'muted'}
        sublabel={successRate != null ? `${(successRate * 100).toFixed(0)}% success` : 'no finished runs'}
        series={completed}
        delta={pctDelta(completed)}
        seriesAriaLabel="Daily completed fixes, last 30 days"
        meaning="Runs that produced a merged or merge-ready PR. The success-rate figure compares completed vs failed only — in-flight runs don't count yet."
      />
      <KpiTile
        label="Failed"
        value={summary.failed}
        accent={summary.failed > 0 ? 'danger' : 'muted'}
        sublabel="needs prompt or scope tuning"
        series={failed}
        delta={pctDelta(failed, { invert: true })}
        seriesAriaLabel="Daily failed fixes, last 30 days"
        meaning="Runs that hit a non-recoverable error: agent crash, CI failure, or scope rejection. Investigate before retrying."
      />
      <KpiTile
        label="In flight"
        value={summary.inProgress}
        accent={summary.inProgress > 0 ? 'info' : 'muted'}
        sublabel="queued or running"
        meaning="Runs currently being attempted or sitting in the dispatch queue. Watch for ones idling > 10 minutes."
      />
      <KpiTile
        label="PRs open"
        value={summary.prsOpen}
        accent={(summary.prsOpen > 0 ? 'brand' : 'muted') as Tone}
        sublabel={summary.prsOpen > 0 ? 'awaiting review or merge' : 'no open PRs'}
        meaning="GitHub PRs Mushi has opened that haven't been merged or closed yet. Each one is a closable PDCA loop waiting for a human reviewer."
      />
    </KpiRow>
  )
}
