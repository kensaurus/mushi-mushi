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
}

function repoSentence(stats: RepoStats): string {
  if (stats.prOpen === 0) return stats.merged > 0 ? `No fix PRs open; ${pluralizeWithCount(stats.merged, 'fix', 'fixes')} merged.` : 'No fix PRs open.'
  if (stats.ciFailed > 0) return `${failingCiTitle(stats.ciFailed)}, of ${pluralizeWithCount(stats.prOpen, 'open fix PR')}.`
  return `${pluralizeWithCount(stats.prOpen, 'fix PR')} open, CI green on ${stats.ciPassing}.`
}

export function RepoSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Pull requests status"
      tone={stats.ciFailed > 0 ? 'danger' : stats.prOpen > 0 ? 'info' : 'ok'}
      sentence={repoSentence(stats)}
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
