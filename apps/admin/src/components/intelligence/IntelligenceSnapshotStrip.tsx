/**
 * FILE: IntelligenceSnapshotStrip.tsx
 * PURPOSE: Weekly insights status: when the last weekly summary was written
 *          and what it covered (PageStatus, P1).
 */

import { PageStatus } from '../ui'
import type { IntelligenceStats } from './IntelligenceStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { intelligenceLinks } from '../../lib/statCardLinks'

interface Props {
  stats: IntelligenceStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function weekOf(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function insightsSentence(stats: IntelligenceStats): string {
  if (stats.reportCount === 0) {
    return stats.activeJobCount > 0 ? 'Your first weekly summary is being written.' : 'No weekly summary yet.'
  }
  const week = weekOf(stats.latestWeekStart)
  const latest = `The latest summary covers ${week ? `the week of ${week}` : 'last week'}: ${pluralizeWithCount(stats.totalReportsInLatest, 'bug')} reported`
  const failed = stats.failedJobCount > 0 ? ` The last ${stats.failedJobCount === 1 ? 'summary run' : `${stats.failedJobCount} summary runs`} failed.` : ''
  return `${latest}.${failed}`
}

export function IntelligenceSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Weekly insights status"
      tone={stats.failedJobCount > 0 ? 'danger' : stats.pendingFindings > 0 ? 'warn' : stats.reportCount > 0 ? 'ok' : 'neutral'}
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
