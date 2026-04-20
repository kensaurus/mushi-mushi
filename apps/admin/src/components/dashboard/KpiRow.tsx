/**
 * FILE: apps/admin/src/components/dashboard/KpiRow.tsx
 * PURPOSE: Top-of-dashboard 4-tile KPI strip with the 7d-vs-prior-7d intake
 *          delta. Direction is pure math; tone reflects whether more reports
 *          is good (it isn't, hence warn).
 */

import { useMemo } from 'react'
import { KpiTile, formatTokens, type KpiTileProps } from '../charts'
import type { DashboardCounts, FixSummary, ReportDay } from './types'

interface Props {
  counts: DashboardCounts
  fixSummary: FixSummary
  reportsByDay: ReportDay[]
}

export function KpiRow({ counts, fixSummary, reportsByDay }: Props) {
  const intakeDelta = useMemo<KpiTileProps['delta']>(() => {
    if (reportsByDay.length < 14) return null
    const last7 = reportsByDay.slice(-7).reduce((a, d) => a + d.total, 0)
    const prev7 = reportsByDay.slice(0, 7).reduce((a, d) => a + d.total, 0)
    if (prev7 === 0 && last7 === 0) return null
    if (prev7 === 0) return { value: 'new', direction: 'up', tone: 'warn' }
    const pct = Math.round(((last7 - prev7) / prev7) * 100)
    if (pct === 0) return { value: '0%', direction: 'flat', tone: 'muted' }
    return {
      value: `${Math.abs(pct)}%`,
      direction: pct > 0 ? 'up' : 'down',
      tone: pct > 0 ? 'warn' : 'ok',
    }
  }, [reportsByDay])

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
      <KpiTile
        label="Reports (14d)"
        value={counts.reports14d}
        sublabel="all severities"
        to="/reports"
        accent="brand"
        delta={intakeDelta}
        meaning="Total user-reported friction events received in the last 14 days. Up = more pain reaching users; down = healthier release."
      />
      <KpiTile
        label="Triage backlog"
        value={counts.openBacklog}
        sublabel="open > 1h"
        to="/reports?status=new"
        accent={counts.openBacklog > 0 ? 'warn' : 'ok'}
        meaning="Reports that have sat untriaged for more than an hour. Aim for 0 — fresh reports are easier to act on while context is hot."
      />
      <KpiTile
        label="Auto-fix PRs"
        value={counts.openPrs}
        sublabel={`${fixSummary.inProgress} in progress · ${fixSummary.failed} failed`}
        to="/fixes"
        accent={fixSummary.failed > 0 ? 'danger' : counts.openPrs > 0 ? 'ok' : 'muted'}
        meaning="Open PRs Mushi has dispatched on your behalf. Each one closes the PDCA loop with a verifiable receipt."
      />
      <KpiTile
        label="LLM tokens (14d)"
        value={formatTokens(counts.llmTokens14d)}
        sublabel={`${counts.llmCalls14d} calls · ${counts.llmFailures14d} failed`}
        to="/health"
        accent={counts.llmFailures14d > 0 ? 'warn' : 'ok'}
        meaning="Tokens consumed by the Haiku→Sonnet classification pipeline. Compare against your Anthropic budget; spikes signal noisy intake."
      />
    </div>
  )
}
