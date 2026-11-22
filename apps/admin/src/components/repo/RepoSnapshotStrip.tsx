/**
 * REPO STATUS — one sentence and three numbers (PageStatus, P1), from
 * /v1/admin/repo/stats. Six tiles (branches, PRs open, CI passing, CI
 * failing, merged, stuck) used to sit above the list; the words are the
 * ones lib/countDefinitions.ts defines, so "failing CI" is the same count
 * here and on Home.
 */

import { PageStatus } from '../ui'
import type { RepoStats } from './RepoStatsTypes'
import { COUNT_HINTS, failingCiTitle } from '../../lib/countDefinitions'
import { pluralizeWithCount } from '../../lib/format'
import { repoLinks } from '../../lib/statCardLinks'

interface Props {
  stats: RepoStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Open PRs (fix or not) whose checks passed, from the open-PR list; null until it loads. */
  readyToMerge?: number | null
}

/**
 * @internal Exported for tests. A PR ready to merge leads: "No fix PRs open" above a list
 * that offers Merge read as a contradiction (fresh-eyes sweep 2026-11-18).
 */
export function repoSentence(stats: RepoStats, readyToMerge: number | null = null): string {
  const ready = readyToMerge && readyToMerge > 0 ? `${pluralizeWithCount(readyToMerge, 'PR')} ready to merge` : null
  if (stats.prOpen === 0) {
    if (ready) return `${ready}.`
    return stats.merged > 0 ? `No fix PRs open; ${pluralizeWithCount(stats.merged, 'fix', 'fixes')} merged.` : 'No fix PRs open.'
  }
  const fixes =
    stats.ciFailed > 0
      ? `${failingCiTitle(stats.ciFailed)}, of ${pluralizeWithCount(stats.prOpen, 'open fix PR')}`
      : `${pluralizeWithCount(stats.prOpen, 'fix PR')} open, CI green on ${stats.ciPassing}`
  return ready ? `${ready}; ${fixes}.` : `${fixes.charAt(0).toUpperCase()}${fixes.slice(1)}.`
}

export function RepoSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, readyToMerge = null }: Props) {
  return (
    <PageStatus
      ariaLabel="Pull requests status"
      tone={stats.ciFailed > 0 ? 'danger' : stats.prOpen > 0 || (readyToMerge ?? 0) > 0 ? 'info' : 'ok'}
      sentence={repoSentence(stats, readyToMerge)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.prOpen ?? 'PRs open',
          value: stats.prOpen,
          hint: 'Open fix pull requests, whatever their CI says.',
          to: repoLinks.prOpen,
        },
        {
          label: statLabels?.ciFailed ?? 'Failing CI',
          value: stats.ciFailed,
          tone: stats.ciFailed > 0 ? 'danger' : 'neutral',
          hint: COUNT_HINTS.failingCi,
          to: repoLinks.ciFailed,
        },
        {
          label: statLabels?.merged ?? 'Merged',
          value: stats.merged,
          tone: stats.merged > 0 ? 'ok' : 'neutral',
          hint: 'Fix pull requests merged.',
          to: repoLinks.merged,
        },
      ]}
    />
  )
}
