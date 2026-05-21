/**
 * REPO SNAPSHOT — posture strip backed by /v1/admin/repo/stats.
 */

import { Section, StatCard } from '../ui'
import type { RepoStats } from './RepoStatsTypes'

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
      {description && <p className="mb-3 text-2xs text-fg-muted">{description}</p>}
      <div className={`grid grid-cols-2 gap-2 ${compact ? 'sm:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-6'}`}>
        {!compact ? (
          <StatCard
            label={statLabels?.branches ?? 'Branches'}
            value={stats.totalBranches}
            accent={stats.totalBranches > 0 ? 'text-brand' : undefined}
            hint="fix attempts with PRs"
          />
        ) : null}
        <StatCard
          label={statLabels?.prOpen ?? 'PRs open'}
          value={stats.prOpen}
          accent={stats.prOpen > 0 ? 'text-brand' : undefined}
          hint="awaiting review"
        />
        <StatCard
          label={statLabels?.ciPassing ?? 'CI passing'}
          value={stats.ciPassing}
          accent={stats.ciPassing > 0 ? 'text-ok' : undefined}
          hint="check-run success"
        />
        <StatCard
          label={statLabels?.ciFailed ?? 'CI failing'}
          value={stats.ciFailed}
          accent={stats.ciFailed > 0 ? 'text-danger' : undefined}
          hint="needs attention"
        />
        {compact ? (
          <StatCard
            label={statLabels?.branches ?? 'Branches'}
            value={stats.totalBranches}
            accent={stats.totalBranches > 0 ? 'text-fg' : undefined}
            hint={stats.failedToOpen > 0 ? `${stats.failedToOpen} stuck` : 'total with PRs'}
          />
        ) : (
          <>
            <StatCard
              label={statLabels?.merged ?? 'Merged'}
              value={stats.merged}
              accent={stats.merged > 0 ? 'text-ok' : undefined}
              hint="landed on main"
            />
            <StatCard
              label={statLabels?.stuck ?? 'Stuck'}
              value={stats.failedToOpen}
              accent={stats.failedToOpen > 0 ? 'text-danger' : 'text-ok'}
              hint="failed to open PR"
            />
          </>
        )}
      </div>
    </Section>
  )
}
