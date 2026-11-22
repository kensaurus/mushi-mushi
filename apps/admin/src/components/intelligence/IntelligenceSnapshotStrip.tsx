/**
 * FILE: IntelligenceSnapshotStrip.tsx
 * PURPOSE: Weekly insights status: when the last weekly summary was written
 *          and what it covered (PageStatus, P1).
 */

import { PageStatus } from '../ui'
import type { IntelligenceStats } from './IntelligenceStatsTypes'
import { intelligenceLinks } from '../../lib/statCardLinks'
import { formatDigestWeek, insightsTone } from '../../lib/intelligenceView'

interface Props {
  stats: IntelligenceStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function insightsSentence(stats: IntelligenceStats): string {
  if (stats.reportCount === 0) {
    return stats.activeJobCount > 0 ? 'Your first weekly summary is being written.' : 'No weekly summary yet.'
  }
  const week = formatDigestWeek(stats.latestWeekStart)
  // The bug count is the tile beside this sentence; "0 bugs reported" said it twice (round-2 sweep 2026-11-18).
  const latest = `The latest summary covers ${week ? `the week of ${week}` : 'last week'}`
  // Only the latest run counts: an old failure a later summary replaced is not
  // news, and the green banner said "up to date" beside it (2026-10-28).
  const failed = stats.topPriority === 'job_failed' ? ' The last summary run failed.' : ''
  return `${latest}.${failed}`
}

export function IntelligenceSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Weekly insights status"
      // Amber while the summary is over a week old: a green dot beside "Summary is 9 days old" contradicted it.
      tone={insightsTone(stats)}
      sentence={insightsSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.digests ?? 'Weekly summaries',
          value: stats.reportCount,
          hint: 'Plain-English summaries of a week of bugs and fixes, one per week.',
          to: intelligenceLinks.digests,
        },
        {
          label: 'Bugs in the latest week',
          value: stats.totalReportsInLatest,
          hint: 'Reports the latest summary covers.',
          to: '/reports',
        },
        {
          label: statLabels?.findings ?? 'Suggestions to review',
          value: stats.pendingFindings,
          tone: stats.pendingFindings > 0 ? 'warn' : 'neutral',
          hint: 'Library upgrades and other suggestions the summary found, waiting for your decision.',
          to: intelligenceLinks.findings,
        },
      ]}
    />
  )
}
