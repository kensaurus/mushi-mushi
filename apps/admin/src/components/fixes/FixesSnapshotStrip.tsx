/**
 * FIXES SNAPSHOT — posture strip backed by /v1/admin/fixes/stats.
 */

import { Link } from 'react-router-dom'
import { Section, StatCard } from '../ui'
import type { FixesStats } from './FixesStatsTypes'

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
      {description && <p className="mb-3 text-2xs text-fg-muted">{description}</p>}
      <div className={`grid grid-cols-2 gap-2 ${compact ? 'sm:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-6'}`}>
        {!compact ? (
          <StatCard
            label={statLabels?.totalAttempts ?? 'Attempts (30d)'}
            value={stats.totalAttempts}
            accent={stats.totalAttempts > 0 ? 'text-brand' : undefined}
            hint="dispatched"
          />
        ) : null}
        {!compact ? (
          <StatCard
            label={statLabels?.completed ?? 'Completed'}
            value={stats.completed}
            accent="text-ok"
            hint={
              stats.successRatePct != null ? `${stats.successRatePct}% success` : 'no finished runs'
            }
          />
        ) : null}
        <StatCard
          label={statLabels?.failed ?? 'Failed'}
          value={stats.failed}
          accent={stats.failed > 0 ? 'text-danger' : 'text-ok'}
          hint={
            stats.topFailureCategory
              ? `top: ${stats.topFailureCategory}`
              : 'needs attention'
          }
        />
        <StatCard
          label={statLabels?.inProgress ?? 'In flight'}
          value={inFlight}
          accent={inFlight > 0 ? 'text-info' : undefined}
          hint="queued or running"
        />
        <StatCard
          label={statLabels?.prsOpen ?? 'PRs open'}
          value={stats.prsOpen}
          accent={stats.prsOpen > 0 ? 'text-brand' : undefined}
          hint="awaiting review"
        />
        {compact ? (
          <StatCard
            label={statLabels?.totalAttempts ?? 'Fixes (30 days)'}
            value={stats.totalAttempts}
            accent={stats.totalAttempts > 0 ? 'text-fg' : undefined}
            hint={
              stats.successRatePct != null ? `${stats.successRatePct}% success` : 'total dispatched'
            }
          />
        ) : (
          <StatCard
            label={statLabels?.prsCiPassing ?? 'CI passing'}
            value={stats.prsCiPassing}
            accent={stats.prsCiPassing > 0 ? 'text-ok' : undefined}
            hint="check-run success"
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
