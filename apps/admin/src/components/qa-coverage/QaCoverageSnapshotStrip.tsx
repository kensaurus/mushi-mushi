/**
 * QA COVERAGE SNAPSHOT — posture strip backed by /v1/admin/projects/:id/qa-coverage/stats.
 * Passing / Failing / No-runs counts live on the story filter chips, not here.
 */

import { Link } from 'react-router-dom'
import { Section, StatCard, SnapshotSectionHint } from '../ui'
import type { QaCoverageStats } from './QaCoverageStatsTypes'
import {
  avgPassRateDetail,
  avgPassRateTooltip,
  runs24hDetail,
  runs24hTooltip,
  totalStoriesDetail,
  totalStoriesTooltip,
} from '../../lib/statTooltips/qa-coverage'
import { qaCoverageLinks } from '../../lib/statCardLinks'

interface Props {
  stats: QaCoverageStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  description?: string
  sectionTitle?: string
  statLabels?: Record<string, string>
  hideLinks?: boolean
}

export function QaCoverageSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  description,
  sectionTitle = 'Summary',
  statLabels,
  hideLinks = false,
}: Props) {
  const avgPassValue =
    stats.avgPassRatePct != null ? `${stats.avgPassRatePct}%` : '—'

  return (
    <Section
      title={sectionTitle}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
    >
      <SnapshotSectionHint text={description} />
      {/* Three compact columns at every width (2026-11-18 sweep): the shared
          strip's 2-column phone grid left "Runs (24h)" alone on a row. */}
      <div role="group" aria-label="Scheduled tests summary" className="grid grid-cols-3 gap-2 [&>*]:min-w-0">
        <StatCard
          label={statLabels?.stories ?? 'Stories'}
          value={stats.totalStories}
          tooltip={totalStoriesTooltip(stats)}
          detail={totalStoriesDetail(stats)}
          to={qaCoverageLinks.stories}
        />
        <StatCard
          label={statLabels?.avgPassRate ?? 'Avg pass rate'}
          value={avgPassValue}
          accent={
            stats.avgPassRatePct != null && stats.avgPassRatePct >= 80
              ? 'text-ok'
              : stats.avgPassRatePct != null
                ? 'text-warn'
                : undefined
          }
          tooltip={avgPassRateTooltip(stats)}
          detail={avgPassRateDetail()}
          to={qaCoverageLinks.avgPassRate}
        />
        <StatCard
          label={statLabels?.runs24h ?? 'Runs (24h)'}
          value={stats.totalRuns24h}
          accent={stats.pendingRuns > 0 ? 'text-info' : stats.totalRuns24h > 0 ? 'text-fg' : undefined}
          tooltip={runs24hTooltip(stats)}
          detail={runs24hDetail(stats)}
          to={qaCoverageLinks.runs24h}
        />
      </div>
      {!hideLinks ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-muted">
          {stats.topFailingStoryId ? (
            <Link
              to={`/qa-coverage?story=${stats.topFailingStoryId}`}
              className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity"
            >
              Top failing story →
            </Link>
          ) : null}
          <Link to="/qa-coverage?tab=stories" className="hover:text-fg underline-offset-2 hover:underline">
            All stories →
          </Link>
          <Link to="/settings?tab=byok#key-browserbase" className="hover:text-fg underline-offset-2 hover:underline">
            Browserbase BYOK →
          </Link>
        </div>
      ) : null}
    </Section>
  )
}
