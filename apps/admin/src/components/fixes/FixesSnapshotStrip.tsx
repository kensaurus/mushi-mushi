/**
 * FIXES STATUS — one sentence and three numbers from /v1/admin/fixes/stats
 * (PageStatus, P1). Every number counts REPORTS from their current state
 * (lib/countDefinitions.ts), so "Stopped" here is Home's "Auto-fix stopped".
 */

import { PageStatus } from '../ui'
import type { FixesStats } from './FixesStatsTypes'
import { COUNT_HINTS, stoppedTitle } from '../../lib/countDefinitions'
import { pluralizeWithCount } from '../../lib/format'
import { fixesLinks } from '../../lib/statCardLinks'

interface Props {
  stats: FixesStats
  statsFetchedAt: string | null
  statsValidating?: boolean
}

function fixesSentence(stats: FixesStats, inFlight: number): string {
  if (stats.totalAttempts === 0 && inFlight === 0) return 'No fixes in the last 30 days.'
  const parts: string[] = []
  if (stats.failed > 0) parts.push(stoppedTitle(stats.failed))
  if (stats.prsOpen > 0) parts.push(`${pluralizeWithCount(stats.prsOpen, 'PR')} waiting for review or merge`)
  if (inFlight > 0) parts.push(`${pluralizeWithCount(inFlight, 'fix', 'fixes')} running`)
  if (parts.length === 0) return `${pluralizeWithCount(stats.completed, 'report')} fixed in the last 30 days; nothing waiting.`
  const sentence = parts.join('; ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

export function FixesSnapshotStrip({ stats, statsFetchedAt, statsValidating }: Props) {
  const inFlight = stats.inProgress + stats.inflightDispatches
  return (
    <PageStatus
      ariaLabel="Fixes status"
      tone={stats.failed > 0 ? 'danger' : inFlight > 0 ? 'info' : stats.prsOpen > 0 ? 'warn' : 'ok'}
      sentence={fixesSentence(stats, inFlight)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: 'Stopped',
          value: stats.failed,
          tone: stats.failed > 0 ? 'danger' : 'neutral',
          hint: COUNT_HINTS.stopped,
          to: fixesLinks.failed,
        },
        {
          label: 'PRs open',
          value: stats.prsOpen,
          hint: COUNT_HINTS.prOpen,
          to: fixesLinks.prsOpen,
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
