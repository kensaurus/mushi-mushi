/**
 * FILE: HealthSnapshotStrip.tsx
 * PURPOSE: Mushi's own health in one sentence and three numbers (PageStatus,
 *          P1): the AI calls behind diagnoses and fixes, and Mushi's
 *          background jobs. This is not the user's app (pattern P6); the
 *          sentence points there.
 */

import { Link } from 'react-router-dom'
import { PageStatus, type PageStatusTone } from '../ui'
import type { HealthStats } from './HealthStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { healthLinks } from '../../lib/statCardLinks'

interface Props {
  stats: HealthStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function healthTone(stats: HealthStats): PageStatusTone {
  if (stats.cronErrorCount > 0 || stats.errorRatePct > 5) return 'danger'
  if (stats.errorRatePct > 0 || stats.fallbackRatePct > 0 || stats.cronStaleCount > 0) return 'warn'
  return 'ok'
}

function healthSentence(stats: HealthStats): string {
  const window = stats.window === '24h' ? 'the last 24 hours' : `the last ${stats.window}`
  const calls =
    stats.totalCalls === 0
      ? `Mushi made no AI calls in ${window}`
      : `Mushi made ${pluralizeWithCount(stats.totalCalls, 'AI call')} in ${window}, ${stats.errorRatePct}% failed`
  const jobs =
    stats.cronJobCount === 0
      ? 'no background jobs are scheduled'
      : stats.cronErrorCount > 0
        ? `${pluralizeWithCount(stats.cronErrorCount, 'background job')} failed`
        : `${stats.cronHealthyCount} of ${stats.cronJobCount} background jobs ran on time`
  return `${calls}; ${jobs}.`
}

export function HealthSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Mushi health status"
      tone={healthTone(stats)}
      sentence={
        <>
          {healthSentence(stats)}{' '}
          <span className="text-fg-muted">
            Your own app’s uptime and errors are on{' '}
            <Link to="/dashboard" className="underline underline-offset-2 hover:text-fg">
              Home
            </Link>
            .
          </span>
        </>
      }
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.calls ?? 'AI calls',
          value: stats.totalCalls,
          hint: 'Calls to AI models Mushi made to diagnose and fix your bugs, in this window.',
          to: healthLinks.totalCalls,
        },
        {
          label: statLabels?.errors ?? 'Failed calls',
          value: `${stats.errorRatePct}%`,
          tone: stats.errorRatePct > 5 ? 'danger' : stats.errorRatePct > 0 ? 'warn' : 'ok',
          hint: 'Share of AI calls that returned an error. A call that switched to a backup model is not counted here.',
          to: healthLinks.errorRate,
        },
        {
          label: statLabels?.cron ?? 'Background jobs on time',
          value: `${stats.cronHealthyCount}/${stats.cronJobCount}`,
          tone: stats.cronErrorCount > 0 ? 'danger' : stats.cronStaleCount > 0 ? 'warn' : 'ok',
          hint: 'Mushi’s scheduled jobs (grading, clean-up, reports) whose last run succeeded on schedule.',
          to: healthLinks.cron,
        },
      ]}
    />
  )
}
