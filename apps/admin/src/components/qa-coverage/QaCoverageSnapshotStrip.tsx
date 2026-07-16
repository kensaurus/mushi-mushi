/**
 * QA COVERAGE SNAPSHOT — posture strip backed by /v1/admin/projects/:id/qa-coverage/stats.
 */

import { Link } from 'react-router-dom'
import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { QaCoverageStats } from './QaCoverageStatsTypes'
import {
  avgPassRateDetail,
  avgPassRateTooltip,
  failingStoriesDetail,
  failingStoriesTooltip,
  noDataStoriesDetail,
  noDataStoriesTooltip,
  passingStoriesDetail,
  passingStoriesTooltip,
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
  /** Quick mode: 4 headline stats instead of 6. */
  compact?: boolean
}

export function QaCoverageSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  description,
  sectionTitle = 'QA SNAPSHOT',
  statLabels,
  hideLinks = false,
  compact = false,
}: Props) {
  const avgPassValue =
    stats.avgPassRatePct != null ? `${stats.avgPassRatePct}%` : '—'

  return (
    <Section
      title={sectionTitle}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
    >
      <SnapshotSectionHint text={description} />
      <MetricStrip
        cols={compact ? 4 : 6}
        ariaLabel="QA coverage snapshot"
        className={compact ? '' : 'sm:grid-cols-3'}
      >
        <StatCard
          label={statLabels?.stories ?? 'Stories'}
          value={stats.totalStories}
          accent={stats.totalStories > 0 ? 'text-brand' : undefined}
          tooltip={totalStoriesTooltip(stats)}
          detail={totalStoriesDetail(stats)}
          to={qaCoverageLinks.stories}
        />
        {!compact ? (
          <StatCard
            label={statLabels?.passing ?? 'Passing'}
            value={stats.passingStories}
            accent={stats.passingStories > 0 ? 'text-ok' : undefined}
            tooltip={passingStoriesTooltip(stats)}
            detail={passingStoriesDetail()}
            to={qaCoverageLinks.passing}
          />
        ) : null}
        <StatCard
          label={statLabels?.failing ?? 'Failing'}
          value={stats.failingStories}
          accent={stats.failingStories > 0 ? 'text-danger' : 'text-ok'}
          tooltip={failingStoriesTooltip(stats)}
          detail={failingStoriesDetail()}
          to={qaCoverageLinks.failing}
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
        {!compact ? (
          <StatCard
            label={statLabels?.noData ?? 'No data'}
            value={stats.noDataStories}
            accent={stats.noDataStories > 0 ? 'text-warn' : undefined}
            tooltip={noDataStoriesTooltip(stats)}
            detail={noDataStoriesDetail()}
            to={qaCoverageLinks.noData}
          />
        ) : null}
      </MetricStrip>
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
          <Link to="/settings?tab=browserbase" className="hover:text-fg underline-offset-2 hover:underline">
            Browserbase BYOK →
          </Link>
        </div>
      ) : null}
    </Section>
  )
}
