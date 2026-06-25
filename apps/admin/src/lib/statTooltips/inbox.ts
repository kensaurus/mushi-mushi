/**
 * FILE: apps/admin/src/lib/statTooltips/inbox.ts
 * PURPOSE: Human-readable StatCard tooltips for the Inbox snapshot strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { InboxStats } from '../../components/inbox/types'
import { metricTip } from '../metricTooltipBuilder'

type Opts = { plainStageLabels?: boolean }

export function openTooltip(stats: InboxStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainStageLabels ?? false
  const takeaway =
    stats.openActions > 0
      ? `${stats.openActions} inbox action${stats.openActions === 1 ? '' : 's'} need your decision — start with the highest-priority card on Actions tab.`
      : 'Inbox zero — no open actions waiting for a human decision.'

  return metricTip(
    plain ? 'Inbox actions that need your decision.' : 'PDCA inbox actions that are open and require operator input.',
    plain
      ? 'Derived from dashboard action cards across loop stages for projects you can access.'
      : 'Derived from dashboard action cards across Plan / Do / Check / Act / Ops surfaces for projects you can access.',
    takeaway,
    stats.openActions > 0
      ? { tone: 'warn', text: 'Open actions block loop progress — resolve before dispatching more work.' }
      : undefined,
  )
}

export function openDetail(stats: InboxStats): string {
  return stats.openActions > 0 ? 'Needs your decision' : 'Inbox zero'
}

export function clearTooltip(stats: InboxStats, plainStageLabels?: boolean): MetricTooltipData {
  const surfaceLabel = plainStageLabels ? 'areas' : 'PDCA surfaces'
  const takeaway =
    stats.clearStages === stats.totalSurfaces
      ? `All ${stats.totalSurfaces} ${surfaceLabel} are clear — no blocking actions in any stage.`
      : `${stats.clearStages} of ${stats.totalSurfaces} ${surfaceLabel} clear — open stages have actions or alerts.`

  return metricTip(
    `How many of the ${stats.totalSurfaces} loop ${surfaceLabel} have no blocking inbox actions.`,
    plainStageLabels
      ? 'Counts loop areas where the derived action queue is empty for the active project.'
      : 'Counts PDCA surfaces (Plan, Do, Check, Act, Ops) where the derived action queue is empty for the active project.',
    takeaway,
  )
}

export function clearDetail(stats: InboxStats, plainStageLabels?: boolean): string {
  return plainStageLabels ? `of ${stats.totalSurfaces} areas` : `of ${stats.totalSurfaces} PDCA surfaces`
}

export function backlogTooltip(stats: InboxStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainStageLabels ?? false
  const takeaway =
    stats.openBacklog > 0
      ? plain
        ? `${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} waiting over an hour in new or queued status — review before sending to auto-fix.`
        : `${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} waiting over an hour in new or queued status — triage before dispatching fixes.`
      : plain
        ? 'Bug queue is current — no reports stuck waiting longer than one hour.'
        : 'Triage queue is current — no reports stuck waiting longer than one hour.'

  return metricTip(
    plain
      ? 'Reports in new or queued status that have waited more than one hour.'
      : 'Reports in new or queued status that have waited more than one hour to be triaged.',
    'Counts reports rows in the 14-day window where status is new or queued and created_at is older than 60 minutes.',
    takeaway,
    stats.openBacklog > 0
      ? {
          tone: 'warn',
          text: plain ? 'Stale backlog — start with the oldest new report.' : 'Stale triage backlog — start with the oldest new report.',
        }
      : undefined,
  )
}

export function backlogDetail(stats: InboxStats, opts: Opts = {}): string {
  const plain = opts.plainStageLabels ?? false
  return stats.openBacklog > 0 ? (plain ? 'Reports > 1h waiting' : 'Reports > 1h untriaged') : 'Queue current'
}

export function criticalTooltip(stats: InboxStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainStageLabels ?? false
  const takeaway =
    stats.criticalReports14d > 0
      ? `${stats.criticalReports14d} critical-severity report${stats.criticalReports14d === 1 ? '' : 's'} in the last 14 days${stats.failedFixes14d > 0 ? `; ${stats.failedFixes14d} failed fix${stats.failedFixes14d === 1 ? '' : 'es'} in the same window.` : '.'}`
      : stats.failedFixes14d > 0
        ? `No critical reports in 14d, but ${stats.failedFixes14d} failed fix attempt${stats.failedFixes14d === 1 ? '' : 's'}.`
        : 'No critical-severity reports in the rolling 14-day window.'

  return metricTip(
    plain
      ? 'Critical-severity bug reports in the last 14 days.'
      : 'Critical-severity bug reports ingested in the last 14 days.',
    'Counts reports rows where severity (case-insensitive) equals critical and created_at is within 14 days. failedFixes14d counts fix_attempts with status failed in the same window.',
    takeaway,
    stats.criticalReports14d > 0
      ? {
          tone: 'warn',
          text: plain
            ? 'Critical bugs in queue — review before auto-fix dispatch.'
            : 'Critical intake in 14d — triage before auto-fix dispatch.',
        }
      : undefined,
  )
}

export function criticalDetail(stats: InboxStats): string {
  return stats.failedFixes14d > 0 ? `${stats.failedFixes14d} failed fixes` : 'Severity rollup'
}
