/**
 * FILE: apps/admin/src/components/dashboard/KpiRow.tsx
 * PURPOSE: Top-of-dashboard 4-tile KPI strip with the 7d-vs-prior-7d intake
 *          delta. Direction is pure math; tone reflects whether more reports
 *          is good (it isn't, hence warn).
 */

import { useMemo } from 'react'
import { KpiTile, type KpiTileProps } from '../charts'
import { MetricStrip } from '../MetricStrip'
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
  // A near-zero prior week turns a normal week into "↑502383%"; past 10× the
  // percentage carries no information.
  if (last >= prev * 10) return { value: '>10×', direction, tone }
  return { value: `${Math.abs(pct)}%`, direction, tone }
}

export function KpiRow({ counts, fixSummary, reportsByDay, pdcaStages = [] }: Props) {
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


  const stage7d = useMemo(() => {
    const days = last7UtcDays()
    const doStage = pdcaStages.find((s) => s.id === 'do')
    return {
      days,
      fixes: doStage?.series?.length === 7 ? doStage.series : null,
    }
  }, [pdcaStages])

  const fixDelta = useMemo(() => {
    if (!stage7d.fixes) return null
    const last3 = stage7d.fixes.slice(-3).reduce((a, v) => a + v, 0)
    const prev3 = stage7d.fixes.slice(0, 3).reduce((a, v) => a + v, 0)
    return pctDelta(last3, prev3)
  }, [stage7d.fixes])

  const heroIsBacklog = counts.openBacklog > 0

  return (
    <MetricStrip cols={4} ariaLabel="Dashboard key metrics" className="mb-3" stagger panel>
      <KpiTile
        density="flat"
        label="Critical to decide"
        value={counts.openCritical14d ?? 0}
        sublabel={`${counts.openBacklog} new, not yet triaged`}
        to="/reports?status=open&severity=critical&days=14"
        accent={(counts.openCritical14d ?? 0) > 0 ? 'danger' : counts.openBacklog > 0 ? 'warn' : 'ok'}
        meaning="Open critical reports from the last 14 days that still need your decision: the same list the To-do page and the banner above count. The small number is reports no one has triaged yet."
        variant={heroIsBacklog ? 'primary' : 'default'}
      />
      <KpiTile
        density="flat"
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
        variant={heroIsBacklog ? 'default' : 'primary'}
      />
      <KpiTile
        density="flat"
        label="Fixes in flight"
        value={fixSummary.inProgress}
        sublabel={`${counts.openPrs} PR${counts.openPrs === 1 ? '' : 's'} open · ${fixSummary.failed} stopped`}
        to="/fixes"
        accent={fixSummary.failed > 0 ? 'danger' : fixSummary.inProgress > 0 || counts.openPrs > 0 ? 'ok' : 'muted'}
        delta={fixDelta}
        series={stage7d.fixes ?? undefined}
        seriesDays={stage7d.fixes ? stage7d.days : undefined}
        seriesAriaLabel="Fix dispatches per day, last 7 days"
        meaning="Fixes being drafted right now, with how many pull requests wait for your review and how many attempts stopped. The sparkline shows fixes dispatched per day."
      />
      <KpiTile
        density="flat"
        label="Fixed"
        value={fixSummary.completed}
        sublabel="reports closed by a fix"
        to="/fixes?status=merged"
        accent={fixSummary.completed > 0 ? 'ok' : 'muted'}
        meaning="Reports closed by a fix that landed. AI usage and token spend moved to Team › AI spend."
      />
    </MetricStrip>
  )
}
