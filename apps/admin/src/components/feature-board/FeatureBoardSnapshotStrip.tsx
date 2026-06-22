/**
 * FILE: FeatureBoardSnapshotStrip.tsx
 * PURPOSE: Community feature board KPI strip — MetricStrip layout for FeatureBoardPage.
 *
 * OVERVIEW:
 * - Four StatCards derived from loaded ticket list counts
 *
 * DEPENDENCIES:
 * - MetricStrip, Section, StatCard, SnapshotSectionHint
 * - FeatureBoardClientStats from ./FeatureBoardStatsTypes
 *
 * USAGE:
 * - Mount via PagePosture on FeatureBoardPage with clientStats from ticket useMemo hooks
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { FeatureBoardClientStats } from './FeatureBoardStatsTypes'

interface Props {
  stats: FeatureBoardClientStats
  fetchedAt: string | null
  isValidating?: boolean
  sectionTitle?: string
  hint?: string
}

export function FeatureBoardSnapshotStrip({
  stats,
  fetchedAt,
  isValidating,
  sectionTitle = 'FEATURE BOARD SNAPSHOT',
  hint,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Feature board snapshot">
        <StatCard
          label="Requests"
          value={stats.totalTickets}
          accent={stats.totalTickets > 0 ? 'text-brand' : undefined}
          detail={stats.projectId ? 'All feature-category tickets' : 'Select a project'}
        />
        <StatCard
          label="Open"
          value={stats.openCount}
          accent={stats.openCount > 0 ? 'text-warn' : undefined}
          detail="Open or in progress"
        />
        <StatCard
          label="Shipped"
          value={stats.shippedCount}
          accent={stats.shippedCount > 0 ? 'text-ok' : undefined}
          detail="Linked to a release"
        />
        <StatCard
          label="Total votes"
          value={stats.totalVotes}
          accent={stats.totalVotes > 0 ? 'text-info' : undefined}
          detail="Across all requests"
        />
      </MetricStrip>
    </Section>
  )
}
