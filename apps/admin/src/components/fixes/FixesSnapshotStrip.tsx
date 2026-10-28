/**
 * FIXES STATUS — one sentence and three numbers (PageStatus, P1): fix PRs
 * ready to merge, and from /v1/admin/fixes/stats the reports auto-fix stopped
 * on and the reports fixed. Each word is defined once in
 * lib/countDefinitions.ts, so "Stopped" here is Home's "Auto-fix stopped".
 */

import { PageStatus } from '../ui'
import type { FixesStats } from './FixesStatsTypes'
import { COUNT_HINTS, stoppedTitle } from '../../lib/countDefinitions'
import { formatFixCauseBreakdown } from '../../lib/fixReportTruth'
import { pluralizeWithCount } from '../../lib/format'
import { fixesLinks } from '../../lib/statCardLinks'

interface Props {
  stats: FixesStats
  /** Fix PRs ready to merge (countDefinitions readyToMerge), from the loaded list. */
  ready?: number
  statsFetchedAt: string | null
  statsValidating?: boolean
}

function fixesSentence(stats: FixesStats, inFlight: number, ready: number): string {
  if (stats.totalAttempts === 0 && inFlight === 0) return 'No fixes in the last 30 days.'
  const parts: string[] = []
  if (ready > 0) parts.push(`${pluralizeWithCount(ready, 'fix PR')} ready to merge`)
  // "Auto-fix stopped…" starts the sentence only when nothing comes before it.
  if (stats.failed > 0) {
    const lead = parts.length ? stoppedTitle(stats.failed).replace(/^Auto/, 'auto') : stoppedTitle(stats.failed)
    const causes = formatFixCauseBreakdown(stats.failureBreakdown ?? [])
    parts.push(causes ? `${lead} (${causes})` : lead)
  }
  if (stats.prsOpen > ready) parts.push(`${pluralizeWithCount(stats.prsOpen - ready, 'other PR')} waiting for review or CI`)
  if (inFlight > 0) parts.push(`${pluralizeWithCount(inFlight, 'fix', 'fixes')} running`)
  if (parts.length === 0) return `${pluralizeWithCount(stats.completed, 'report')} fixed in the last 30 days; nothing waiting.`
  const sentence = parts.join('; ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

export function FixesSnapshotStrip({ stats, ready = 0, statsFetchedAt, statsValidating }: Props) {
  const inFlight = stats.inProgress + stats.inflightDispatches
  return (
    <PageStatus
      ariaLabel="Fixes status"
      tone={stats.failed > 0 ? 'danger' : ready > 0 ? 'warn' : inFlight > 0 ? 'info' : 'ok'}
      sentence={fixesSentence(stats, inFlight, ready)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: 'Ready to merge',
          value: ready,
          tone: ready > 0 ? 'ok' : 'neutral',
          hint: COUNT_HINTS.readyToMerge,
          to: '/fixes#fixes-ready',
        },
        {
          label: 'Stopped',
          value: stats.failed,
          tone: stats.failed > 0 ? 'danger' : 'neutral',
          hint: COUNT_HINTS.stopped,
          to: fixesLinks.failed,
        },
        {
          label: 'Fixed',
          value: stats.completed,
          tone: stats.completed > 0 ? 'ok' : 'neutral',
          hint: COUNT_HINTS.fixed,
          to: fixesLinks.completed,
        },
      ]}
    />
  )
}
