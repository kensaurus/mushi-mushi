/**
 * FILE: apps/admin/src/components/dashboard/KpiRow.tsx
 * PURPOSE: Top-of-dashboard 4-tile KPI strip with the 7d-vs-prior-7d intake
 *          delta. Direction is pure math; tone reflects whether more reports
 *          is good (it isn't, hence warn).
 */

import { useMemo } from 'react'
import { KpiTile, formatTokens, type KpiTileProps } from '../charts'
import type { DashboardCounts, FixSummary, LlmDay, PdcaStage, ReportDay } from './types'

function last7UtcDays(): string[] {
  const days: string[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

interface Props {
  counts: DashboardCounts
  fixSummary: FixSummary
  reportsByDay: ReportDay[]
  llmByDay?: LlmDay[]
  pdcaStages?: PdcaStage[]
}

function pctDelta(last: number, prev: number, opts: { invert?: boolean } = {}): KpiTileProps['delta'] {
  if (prev === 0 && last === 0) return null
  if (prev === 0) return { value: 'new', direction: 'up', tone: opts.invert ? 'warn' : 'ok' }
  const pct = Math.round(((last - prev) / prev) * 100)
  if (pct === 0) return { value: '0%', direction: 'flat', tone: 'muted' }
  const direction = pct > 0 ? 'up' : 'down'
  // `invert` flips the colour mapping for KPIs where "up" is bad (e.g. backlog,
  // intake, failures). Default treats "up" as good momentum.
  const tone = opts.invert
    ? (pct > 0 ? 'warn' : 'ok')
    : (pct > 0 ? 'ok' : 'warn')
  return { value: `${Math.abs(pct)}%`, direction, tone }
}

export function KpiRow({ counts, fixSummary, reportsByDay, llmByDay = [], pdcaStages = [] }: Props) {
  // Each KPI gets a 14d daily series so the tile shows both the current
  // snapshot and the trajectory. The deltas below compare the most recent 7d
  // window against the prior 7d so the chip mirrors what the spark shows.
  const intakeSeries = useMemo(() => reportsByDay.map((d) => d.total), [reportsByDay])
  const intakeDays = useMemo(() => reportsByDay.map((d) => d.day), [reportsByDay])
  const intakeDelta = useMemo(() => {
    if (reportsByDay.length < 14) return null
    const last7 = reportsByDay.slice(-7).reduce((a, d) => a + d.total, 0)
    const prev7 = reportsByDay.slice(0, 7).reduce((a, d) => a + d.total, 0)
    return pctDelta(last7, prev7, { invert: true })
  }, [reportsByDay])

  const llmSeries = useMemo(() => llmByDay.map((d) => d.tokens), [llmByDay])
  const llmDays = useMemo(() => llmByDay.map((d) => d.day), [llmByDay])
  const llmDelta = useMemo(() => {
    if (llmByDay.length < 14) return null
    const last7 = llmByDay.slice(-7).reduce((a, d) => a + d.tokens, 0)
    const prev7 = llmByDay.slice(0, 7).reduce((a, d) => a + d.tokens, 0)
    return pctDelta(last7, prev7, { invert: true })
  }, [llmByDay])

  const stage7d = useMemo(() => {
    const days = last7UtcDays()
    const plan = pdcaStages.find((s) => s.id === 'plan')
    const doStage = pdcaStages.find((s) => s.id === 'do')
    return {
      days,
      triage: plan?.series?.length === 7 ? plan.series : null,
      fixes: doStage?.series?.length === 7 ? doStage.series : null,
    }
  }, [pdcaStages])

  const triageDelta = useMemo(() => {
    if (!stage7d.triage) return null
    const last3 = stage7d.triage.slice(-3).reduce((a, v) => a + v, 0)
    const prev3 = stage7d.triage.slice(0, 3).reduce((a, v) => a + v, 0)
    return pctDelta(last3, prev3, { invert: true })
  }, [stage7d.triage])

  const fixDelta = useMemo(() => {
    if (!stage7d.fixes) return null
    const last3 = stage7d.fixes.slice(-3).reduce((a, v) => a + v, 0)
    const prev3 = stage7d.fixes.slice(0, 3).reduce((a, v) => a + v, 0)
    return pctDelta(last3, prev3)
  }, [stage7d.fixes])

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
      <KpiTile
        label="Reports (14d)"
        value={counts.reports14d}
        sublabel="all severities"
        to="/reports"
        accent="brand"
        delta={intakeDelta}
        series={intakeSeries}
        seriesDays={intakeDays}
        seriesAriaLabel="Reports per day, last 14 days"
        meaning="Total user-reported friction events received in the last 14 days. Up = more pain reaching users; down = healthier release."
      />
      <KpiTile
        label="Triage backlog"
        value={counts.openBacklog}
        sublabel="open > 1h"
        to="/reports?status=new"
        accent={counts.openBacklog > 0 ? 'warn' : 'ok'}
        delta={triageDelta}
        series={stage7d.triage ?? undefined}
        seriesDays={stage7d.triage ? stage7d.days : undefined}
        seriesAriaLabel="New reports per day, last 7 days"
        meaning="Reports that have sat untriaged for more than an hour. The sparkline tracks daily inbound volume — spikes usually precede backlog growth."
      />
      <KpiTile
        label="Auto-fix PRs"
        value={counts.openPrs}
        sublabel={`${fixSummary.inProgress} in progress · ${fixSummary.failed} failed`}
        to="/fixes"
        accent={fixSummary.failed > 0 ? 'danger' : counts.openPrs > 0 ? 'ok' : 'muted'}
        delta={fixDelta}
        series={stage7d.fixes ?? undefined}
        seriesDays={stage7d.fixes ? stage7d.days : undefined}
        seriesAriaLabel="Fix dispatches per day, last 7 days"
        meaning="Open PRs Mushi has dispatched on your behalf. The sparkline shows how many fixes were dispatched each day."
      />
      <KpiTile
        label="LLM tokens (14d)"
        value={formatTokens(counts.llmTokens14d)}
        sublabel={`${counts.llmCalls14d} calls · ${counts.llmFailures14d} failed`}
        to="/health"
        accent={counts.llmFailures14d > 0 ? 'warn' : 'ok'}
        delta={llmDelta}
        series={llmSeries}
        seriesDays={llmDays}
        seriesAriaLabel="LLM tokens per day, last 14 days"
        meaning="Tokens consumed by the Haiku→Sonnet classification pipeline. Compare against your Anthropic budget; spikes signal noisy intake."
      />
    </div>
  )
}
