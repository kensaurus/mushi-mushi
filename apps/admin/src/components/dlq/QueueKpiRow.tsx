/**
 * FILE: apps/admin/src/components/dlq/QueueKpiRow.tsx
 * PURPOSE: 5-tile KPI strip: pending / running / completed / failed / DLQ.
 *          Pure presentation — accepts a pre-computed QueueSummary.
 */

import { useMemo } from 'react'
import { KpiRow, KpiTile, type KpiDelta, type Tone } from '../charts'
import type { QueueSummary, ThroughputDay } from './types'

interface Props {
  summary: QueueSummary
  throughput?: ThroughputDay[]
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

export function QueueKpiRow({ summary, throughput = [] }: Props) {
  // Throughput data is per-day created/completed/failed. We project each KPI
  // to its matching daily series so the tile spark matches the row underneath.
  const createdSeries = useMemo(() => throughput.map((d) => d.created), [throughput])
  const completedSeries = useMemo(() => throughput.map((d) => d.completed), [throughput])
  const failedSeries = useMemo(() => throughput.map((d) => d.failed), [throughput])

  return (
    <KpiRow cols={5}>
      <KpiTile
        label="Pending"
        value={summary.byStatus.pending ?? 0}
        accent={(summary.byStatus.pending ?? 0) > 0 ? 'info' : 'muted'}
        sublabel="waiting for worker"
        series={createdSeries}
        delta={pctDelta(createdSeries, { invert: true })}
        seriesAriaLabel="Daily intake, last window"
        meaning="Jobs queued but not yet picked up by a worker. Healthy systems clear pending fast — sustained backlog means workers are over-subscribed."
      />
      <KpiTile
        label="Running"
        value={summary.byStatus.running ?? 0}
        accent={(summary.byStatus.running ?? 0) > 0 ? 'brand' : 'muted'}
        sublabel="in flight now"
        meaning="Jobs currently being processed. Watch for ones stuck > 5 min — usually means a hang in the LLM call or downstream API."
      />
      <KpiTile
        label="Completed"
        value={summary.byStatus.completed ?? 0}
        accent={'ok' as Tone}
        sublabel="all-time success"
        series={completedSeries}
        delta={pctDelta(completedSeries)}
        seriesAriaLabel="Daily completed jobs, last window"
        meaning="Jobs that finished successfully. The cumulative count tells you intake throughput; pair with the trend above for momentum."
      />
      <KpiTile
        label="Failed"
        value={summary.byStatus.failed ?? 0}
        accent={(summary.byStatus.failed ?? 0) > 0 ? 'warn' : 'muted'}
        sublabel="still inside retry budget"
        series={failedSeries}
        delta={pctDelta(failedSeries, { invert: true })}
        seriesAriaLabel="Daily failed jobs, last window"
        meaning="Jobs that errored but will be retried automatically. If the count keeps climbing, root-cause is upstream (model 5xx, rate limit, schema bug)."
      />
      <KpiTile
        label="Dead letter"
        value={summary.byStatus.dead_letter ?? 0}
        accent={(summary.byStatus.dead_letter ?? 0) > 0 ? 'danger' : 'muted'}
        sublabel="exhausted retries"
        meaning="Jobs that exceeded their retry budget — they will not run again without a manual replay. Always investigate before clearing."
      />
    </KpiRow>
  )
}
