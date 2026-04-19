/**
 * FILE: apps/admin/src/components/dlq/QueueKpiRow.tsx
 * PURPOSE: 5-tile KPI strip: pending / running / completed / failed / DLQ.
 *          Pure presentation — accepts a pre-computed QueueSummary.
 */

import { KpiRow, KpiTile, type Tone } from '../charts'
import type { QueueSummary } from './types'

interface Props {
  summary: QueueSummary
}

export function QueueKpiRow({ summary }: Props) {
  return (
    <KpiRow cols={5}>
      <KpiTile
        label="Pending"
        value={summary.byStatus.pending ?? 0}
        accent={(summary.byStatus.pending ?? 0) > 0 ? 'info' : 'muted'}
        sublabel="waiting for worker"
      />
      <KpiTile
        label="Running"
        value={summary.byStatus.running ?? 0}
        accent={(summary.byStatus.running ?? 0) > 0 ? 'brand' : 'muted'}
        sublabel="in flight now"
      />
      <KpiTile
        label="Completed"
        value={summary.byStatus.completed ?? 0}
        accent={'ok' as Tone}
        sublabel="all-time success"
      />
      <KpiTile
        label="Failed"
        value={summary.byStatus.failed ?? 0}
        accent={(summary.byStatus.failed ?? 0) > 0 ? 'warn' : 'muted'}
        sublabel="still inside retry budget"
      />
      <KpiTile
        label="Dead letter"
        value={summary.byStatus.dead_letter ?? 0}
        accent={(summary.byStatus.dead_letter ?? 0) > 0 ? 'danger' : 'muted'}
        sublabel="exhausted retries"
      />
    </KpiRow>
  )
}
