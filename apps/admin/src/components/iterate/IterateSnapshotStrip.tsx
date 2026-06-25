/**
 * FILE: IterateSnapshotStrip.tsx
 * PURPOSE: PDCA iterate KPI strip using MetricStrip — replaces hand-rolled grid on IteratePage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { IterateStats } from './IterateStatsTypes'
import {
  totalRunsTooltip,
  totalRunsDetail,
  activeRunsTooltip,
  activeRunsDetail,
  succeededRunsTooltip,
  succeededRunsDetail,
  failedRunsTooltip,
  failedRunsDetail,
  avgScoreTooltip,
  avgScoreDetail,
  iterationsTooltip,
  iterationsDetail,
} from '../../lib/statTooltips/iterate'
import { iterateLinks } from '../../lib/statCardLinks'
import { usePlainStatTooltips } from '../../lib/usePlainStatTooltips'

interface Props {
  stats: IterateStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function IterateSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'PDCA SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  const plainOpts = usePlainStatTooltips()
  const sectionLabel = plainOpts.plainLanguage ? 'Improvement loop snapshot' : 'PDCA snapshot'

  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel={sectionLabel}>
        <StatCard
          label={statLabels?.total ?? 'Total runs'}
          value={stats.total}
          accent={stats.total > 0 ? 'text-brand' : undefined}
          tooltip={totalRunsTooltip(stats, plainOpts)}
          detail={totalRunsDetail(plainOpts)}
          to={iterateLinks.total}
        />
        <StatCard
          label={statLabels?.active ?? 'Active'}
          value={stats.running + stats.queued}
          accent={stats.running + stats.queued > 0 ? 'text-warn' : undefined}
          tooltip={activeRunsTooltip(stats, plainOpts)}
          detail={activeRunsDetail(stats)}
          to={iterateLinks.active}
        />
        <StatCard
          label={statLabels?.succeeded ?? 'Succeeded'}
          value={stats.succeeded}
          accent={stats.succeeded > 0 ? 'text-ok' : undefined}
          tooltip={succeededRunsTooltip(stats, plainOpts)}
          detail={succeededRunsDetail()}
          to={iterateLinks.succeeded}
        />
        <StatCard
          label={statLabels?.failed ?? 'Failed'}
          value={stats.failed}
          accent={stats.failed > 0 ? 'text-danger' : undefined}
          tooltip={failedRunsTooltip(stats, plainOpts)}
          detail={failedRunsDetail()}
          to={iterateLinks.failed}
        />
        <StatCard
          label={statLabels?.avgScore ?? 'Avg score'}
          value={stats.avgFinalScorePct != null ? `${stats.avgFinalScorePct}%` : '—'}
          accent={
            stats.avgFinalScorePct != null && stats.avgFinalScorePct >= 70
              ? 'text-ok'
              : stats.avgFinalScorePct != null
                ? 'text-warn'
                : undefined
          }
          tooltip={avgScoreTooltip(stats)}
          detail={avgScoreDetail(stats)}
          to={iterateLinks.avgScore}
        />
        <StatCard
          label={statLabels?.iterations ?? 'Iterations'}
          value={stats.totalIterations}
          accent={stats.totalIterations > 0 ? 'text-info' : undefined}
          tooltip={iterationsTooltip(stats, plainOpts)}
          detail={iterationsDetail()}
          to={iterateLinks.iterations}
        />
      </MetricStrip>
    </Section>
  )
}
