/**
 * FILE: apps/admin/src/components/fixes/FixSummaryRow.tsx
 * PURPOSE: 5-tile KPI strip + 30-day daily-volume sparkline for the auto-fix
 *          pipeline. Pure presentation — accepts a pre-computed FixSummary.
 */

import { Card } from '../ui'
import { KpiRow, KpiTile, BarSparkline, type Tone } from '../charts'
import type { FixSummary } from './types'

interface Props {
  summary: FixSummary
  successRate: number | null
}

export function FixSummaryRow({ summary, successRate }: Props) {
  const sparkValues = summary.days.map((d) => d.total)
  const hasSparkActivity = sparkValues.some((v) => v > 0)

  return (
    <>
      <KpiRow cols={5}>
        <KpiTile
          label="Attempts (30d)"
          value={summary.total}
          sublabel="dispatched in last 30 days"
        />
        <KpiTile
          label="Completed"
          value={summary.completed}
          accent={summary.completed > 0 ? 'ok' : 'muted'}
          sublabel={successRate != null ? `${(successRate * 100).toFixed(0)}% success` : 'no finished runs'}
        />
        <KpiTile
          label="Failed"
          value={summary.failed}
          accent={summary.failed > 0 ? 'danger' : 'muted'}
          sublabel="needs prompt or scope tuning"
        />
        <KpiTile
          label="In flight"
          value={summary.inProgress}
          accent={summary.inProgress > 0 ? 'info' : 'muted'}
          sublabel="queued or running"
        />
        <KpiTile
          label="PRs open"
          value={summary.prsOpen}
          accent={(summary.prsOpen > 0 ? 'brand' : 'muted') as Tone}
          sublabel={summary.prsOpen > 0 ? 'awaiting review or merge' : 'no open PRs'}
        />
      </KpiRow>

      {hasSparkActivity && (
        <Card elevated className="p-3">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-2xs uppercase tracking-wider text-fg-muted">
              Daily fix volume · last 30d
            </h3>
            <span className="text-2xs font-mono text-fg-faint">
              {summary.days[0]?.day} → {summary.days[summary.days.length - 1]?.day}
            </span>
          </div>
          <BarSparkline values={sparkValues} accent="bg-brand/70" height={36} />
        </Card>
      )}
    </>
  )
}
