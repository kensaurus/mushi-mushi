/**
 * FIXES SNAPSHOT — posture strip backed by /v1/admin/fixes/stats.
 */

import { Link } from 'react-router-dom'
import { Section, StatCard, SnapshotSectionHint } from '../ui'
import type { FixesStats } from './FixesStatsTypes'
import {
  completedDetail,
  completedTooltip,
  failedDetail,
  failedTooltip,
  inProgressDetail,
  inProgressTooltip,
  prsCiPassingDetail,
  prsCiPassingTooltip,
  prsOpenDetail,
  prsOpenTooltip,
  totalAttemptsDetail,
  totalAttemptsTooltip,
} from '../../lib/statTooltips/fixes'
import { fixesLinks } from '../../lib/statCardLinks'

interface Props {
  stats: FixesStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  description?: string
  sectionTitle?: string
  statLabels?: Record<string, string>
  hideLinks?: boolean
  /** Quick mode: show 4 headline stats instead of 6. */
  compact?: boolean
}

export function FixesSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  description,
  sectionTitle = 'FIXES SNAPSHOT',
  statLabels,
  hideLinks = false,
  compact = false,
}: Props) {
  const inFlight = stats.inProgress + stats.inflightDispatches

  return (
    <Section
      title={sectionTitle}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
    >
      <SnapshotSectionHint text={description} />
      <div className={`grid grid-cols-2 gap-2 ${compact ? 'sm:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-6'}`}>
        {!compact ? (
          <StatCard
            label={statLabels?.totalAttempts ?? 'Attempts (30d)'}
            value={stats.totalAttempts}
            accent={stats.totalAttempts > 0 ? 'text-brand' : undefined}
            tooltip={totalAttemptsTooltip(stats)}
            detail={totalAttemptsDetail(stats)}
            to={fixesLinks.totalAttempts}
          />
        ) : null}
        {!compact ? (
          <StatCard
            label={statLabels?.completed ?? 'Completed'}
            value={stats.completed}
            accent="text-ok"
            tooltip={completedTooltip(stats)}
            detail={completedDetail(stats)}
            to={fixesLinks.completed}
          />
        ) : null}
        <StatCard
          label={statLabels?.failed ?? 'Failed'}
          value={stats.failed}
          accent={stats.failed > 0 ? 'text-danger' : 'text-ok'}
          tooltip={failedTooltip(stats)}
          detail={failedDetail(stats)}
          to={fixesLinks.failed}
        />
        <StatCard
          label={statLabels?.inProgress ?? 'In flight'}
          value={inFlight}
          accent={inFlight > 0 ? 'text-info' : undefined}
          tooltip={inProgressTooltip(stats)}
          detail={inProgressDetail()}
          to={fixesLinks.inProgress}
        />
        <StatCard
          label={statLabels?.prsOpen ?? 'PRs open'}
          value={stats.prsOpen}
          accent={stats.prsOpen > 0 ? 'text-brand' : undefined}
          tooltip={prsOpenTooltip(stats)}
          detail={prsOpenDetail()}
          to={fixesLinks.prsOpen}
        />
        {compact ? (
          <StatCard
            label={statLabels?.totalAttempts ?? 'Fixes (30 days)'}
            value={stats.totalAttempts}
            accent={stats.totalAttempts > 0 ? 'text-fg' : undefined}
            tooltip={totalAttemptsTooltip(stats)}
            detail={totalAttemptsDetail(stats)}
            to={fixesLinks.totalAttempts}
          />
        ) : (
          <StatCard
            label={statLabels?.prsCiPassing ?? 'CI passing'}
            value={stats.prsCiPassing}
            accent={stats.prsCiPassing > 0 ? 'text-ok' : undefined}
            tooltip={prsCiPassingTooltip(stats)}
            detail={prsCiPassingDetail()}
            to={fixesLinks.prsCiPassing}
          />
        )}
      </div>
      {!hideLinks ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-muted">
          <Link to="/reports" className="text-brand hover:underline">
            Source reports →
          </Link>
          <Link to="/judge" className="hover:text-fg underline-offset-2 hover:underline">
            Judge scores →
          </Link>
          <Link to="/releases" className="hover:text-fg underline-offset-2 hover:underline">
            Releases →
          </Link>
          <Link to="/integrations/config" className="hover:text-fg underline-offset-2 hover:underline">
            Integrations →
          </Link>
        </div>
      ) : null}
    </Section>
  )
}
