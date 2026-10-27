/**
 * FILE: ReleasesSnapshotStrip.tsx
 * PURPOSE: Releases status: what shipped, what is drafted, and which fixed
 *          reports have not been in release notes yet (PageStatus, P1). With
 *          nothing at all it is the page's one first step (P3).
 */

import { PageStatus } from '../ui'
import type { ReleasesStats } from './ReleasesStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { releasesLinks } from '../../lib/statCardLinks'

interface Props {
  stats: ReleasesStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Opens the draft form: the first step on a project with no releases. */
  onDraft?: () => void
}

function releasesSentence(stats: ReleasesStats): string {
  if (stats.totalReleases === 0) {
    return stats.fixedReportsCount > 0
      ? `No releases yet; ${pluralizeWithCount(stats.fixedReportsCount, 'fixed report')} can go into your first release notes.`
      : 'No releases yet.'
  }
  const published = `${pluralizeWithCount(stats.publishedCount, 'release')} published`
  const drafts = stats.draftCount > 0 ? `, ${pluralizeWithCount(stats.draftCount, 'draft')} waiting` : ''
  const told = stats.creditsPending > 0 ? `; ${pluralizeWithCount(stats.creditsPending, 'reporter')} not told yet` : ''
  return `${published}${drafts}${told}.`
}

export function ReleasesSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onDraft }: Props) {
  return (
    <PageStatus
      ariaLabel="Releases status"
      tone={stats.draftCount > 0 || stats.creditsPending > 0 ? 'warn' : stats.publishedCount > 0 ? 'ok' : 'neutral'}
      sentence={releasesSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.published ?? 'Published',
          value: stats.publishedCount,
          hint: 'Release notes your reporters and users can read.',
          to: releasesLinks.published,
        },
        {
          label: statLabels?.drafts ?? 'Drafts',
          value: stats.draftCount,
          tone: stats.draftCount > 0 ? 'warn' : 'neutral',
          hint: 'Release notes written from merged fixes, waiting for you to publish.',
          to: releasesLinks.drafts,
        },
        {
          label: statLabels?.fixedReports ?? 'Fixed reports',
          value: stats.fixedReportsCount,
          hint: 'Reports a merged fix closed. A release credits the people who reported them.',
          to: releasesLinks.fixedReports,
        },
      ]}
      empty={{
        title: 'No releases yet',
        sentence: 'Once a fix merges, Mushi drafts release notes from it and credits the people who reported the bug.',
        action: onDraft ? { label: 'Draft release notes', onClick: onDraft } : { label: 'Draft release notes', to: '/releases?tab=draft' },
      }}
    />
  )
}
