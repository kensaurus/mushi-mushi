/**
 * REPO SNAPSHOT — posture strip backed by /v1/admin/repo/stats.
 */

import { Section, StatCard } from '../ui'
import { ContainedBlock } from '../report-detail/ReportSurface'
import type { RepoStats } from './RepoStatsTypes'
import {
  branchesDetail,
  branchesTooltip,
  ciFailedDetail,
  ciFailedTooltip,
  ciPassingDetail,
  ciPassingTooltip,
  mergedDetail,
  mergedTooltip,
  prOpenDetail,
  prOpenTooltip,
  stuckDetail,
  stuckTooltip,
} from '../../lib/statTooltips/repo'
import { repoLinks } from '../../lib/statCardLinks'

interface Props {
  stats: RepoStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  description?: string
  sectionTitle?: string
  statLabels?: Record<string, string>
  compact?: boolean
}

export function RepoSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  description,
  sectionTitle = 'REPO SNAPSHOT',
  statLabels,
  compact = false,
}: Props) {
  return (
    <Section
      title={sectionTitle}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
    >
      {description && (
        <ContainedBlock tone="muted" className="mb-3">
          <p className="text-xs leading-relaxed text-fg-muted">{description}</p>
        </ContainedBlock>
      )}
      <div className={`grid grid-cols-2 gap-2 ${compact ? 'sm:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-6'}`}>
        {!compact ? (
          <StatCard
            label={statLabels?.branches ?? 'Branches'}
            value={stats.totalBranches}
            accent={stats.totalBranches > 0 ? 'text-brand' : undefined}
            tooltip={branchesTooltip(stats)}
            detail={branchesDetail(stats)}
            to={repoLinks.branches}
          />
        ) : null}
        <StatCard
          label={statLabels?.prOpen ?? 'PRs open'}
          value={stats.prOpen}
          accent={stats.prOpen > 0 ? 'text-brand' : undefined}
          tooltip={prOpenTooltip(stats)}
          detail={prOpenDetail()}
          to={repoLinks.prOpen}
        />
        <StatCard
          label={statLabels?.ciPassing ?? 'CI passing'}
          value={stats.ciPassing}
          accent={stats.ciPassing > 0 ? 'text-ok' : undefined}
          tooltip={ciPassingTooltip(stats)}
          detail={ciPassingDetail()}
          to={repoLinks.ciPassing}
        />
        <StatCard
          label={statLabels?.ciFailed ?? 'CI failing'}
          value={stats.ciFailed}
          accent={stats.ciFailed > 0 ? 'text-danger' : undefined}
          tooltip={ciFailedTooltip(stats)}
          detail={ciFailedDetail()}
          to={repoLinks.ciFailed}
        />
        {compact ? (
          <StatCard
            label={statLabels?.branches ?? 'Branches'}
            value={stats.totalBranches}
            accent={stats.totalBranches > 0 ? 'text-fg' : undefined}
            tooltip={branchesTooltip(stats)}
            detail={branchesDetail(stats, true)}
            to={repoLinks.branches}
          />
        ) : (
          <>
            <StatCard
              label={statLabels?.merged ?? 'Merged'}
              value={stats.merged}
              accent={stats.merged > 0 ? 'text-ok' : undefined}
              tooltip={mergedTooltip(stats)}
              detail={mergedDetail()}
              to={repoLinks.merged}
            />
            <StatCard
              label={statLabels?.stuck ?? 'Stuck'}
              value={stats.failedToOpen}
              accent={stats.failedToOpen > 0 ? 'text-danger' : 'text-ok'}
              tooltip={stuckTooltip(stats)}
              detail={stuckDetail()}
              to={repoLinks.stuck}
            />
          </>
        )}
      </div>
    </Section>
  )
}
