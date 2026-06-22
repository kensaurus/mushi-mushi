/**
 * FILE: ReleasesSnapshotStrip.tsx
 * PURPOSE: Releases KPI strip using MetricStrip — replaces hand-rolled 6-col grid.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { ReleasesStats } from './ReleasesStatsTypes'
import {
  contributorsDetail,
  contributorsTooltip,
  draftsDetail,
  draftsTooltip,
  feedbackDetail,
  feedbackTooltip,
  fixedReportsDetail,
  fixedReportsTooltip,
  fixesLinkedDetail,
  fixesLinkedTooltip,
  publishedDetail,
  publishedTooltip,
} from '../../lib/statTooltips/releases'
import { releasesLinks } from '../../lib/statCardLinks'

interface Props {
  stats: ReleasesStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function ReleasesSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'RELEASES SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Releases snapshot">
        <StatCard
          label={statLabels?.drafts ?? 'Drafts'}
          value={stats.draftCount}
          accent={stats.draftCount > 0 ? 'text-warn' : undefined}
          tooltip={draftsTooltip(stats)}
          detail={draftsDetail()}
          to={releasesLinks.drafts}
        />
        <StatCard
          label={statLabels?.published ?? 'Published'}
          value={stats.publishedCount}
          accent={stats.publishedCount > 0 ? 'text-ok' : undefined}
          tooltip={publishedTooltip(stats)}
          detail={publishedDetail()}
          to={releasesLinks.published}
        />
        <StatCard
          label={statLabels?.fixesLinked ?? 'Fixes linked'}
          value={stats.totalFixesLinked}
          accent={stats.totalFixesLinked > 0 ? 'text-brand' : undefined}
          tooltip={fixesLinkedTooltip(stats)}
          detail={fixesLinkedDetail()}
          to={releasesLinks.fixesLinked}
        />
        <StatCard
          label={statLabels?.contributors ?? 'Contributors'}
          value={stats.totalContributors}
          accent={stats.totalContributors > 0 ? 'text-brand' : undefined}
          tooltip={contributorsTooltip(stats)}
          detail={contributorsDetail(stats)}
          to={releasesLinks.contributors}
        />
        <StatCard
          label={statLabels?.fixedReports ?? 'Fixed reports'}
          value={stats.fixedReportsCount}
          accent={stats.fixedReportsCount > 0 ? 'text-brand' : undefined}
          tooltip={fixedReportsTooltip(stats)}
          detail={fixedReportsDetail()}
          to={releasesLinks.fixedReports}
        />
        <StatCard
          label={statLabels?.feedback ?? 'Feedback shipped'}
          value={stats.fulfilledTicketsShipped}
          accent={stats.fulfilledTicketsShipped > 0 ? 'text-ok' : undefined}
          tooltip={feedbackTooltip(stats)}
          detail={feedbackDetail(stats)}
          to={releasesLinks.feedback}
        />
      </MetricStrip>
    </Section>
  )
}
