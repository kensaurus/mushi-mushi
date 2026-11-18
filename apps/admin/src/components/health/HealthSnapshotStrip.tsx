/**
 * FILE: HealthSnapshotStrip.tsx
 * PURPOSE: Mushi's own health in three numbers (PageStatus, P1): the AI
 *          calls behind diagnoses and fixes, and Mushi's background jobs.
 *          This is not the user's app (pattern P6); the one line points
 *          there. 2026-11-18: no sentence restating the numbers, and never
 *          green while a job is overdue.
 */

import { Link } from 'react-router-dom'
import { PageStatus, type PageStatusTone } from '../ui'
import type { HealthStats } from './HealthStatsTypes'
import { healthLinks } from '../../lib/statCardLinks'

interface Props {
  stats: HealthStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Jobs the page counts as overdue (the same count as its overdue card). */
  lateJobs?: number
}

/** A late job (stale or warn in the stats, or overdue by the page's count) is not healthy. */
function jobsLate(stats: HealthStats, lateJobs = 0): boolean {
  return stats.cronStaleCount + stats.cronWarnCount > 0 || lateJobs > 0
}

/** @internal Exported for tests. */
export function healthTone(stats: HealthStats, lateJobs = 0): PageStatusTone {
  if (stats.cronErrorCount > 0 || stats.errorRatePct > 5) return 'danger'
  if (stats.errorRatePct > 0 || stats.fallbackRatePct > 0 || jobsLate(stats, lateJobs)) return 'warn'
  return 'ok'
}

export function HealthSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, lateJobs = 0 }: Props) {
  return (
    <PageStatus
      ariaLabel="Mushi Mushi health status"
      tone={healthTone(stats, lateJobs)}
      sentence={
        <span className="text-fg-muted">
          Mushi Mushi’s own AI calls and jobs. Your app’s uptime and errors are on{' '}
          <Link to="/dashboard" className="underline underline-offset-2 hover:text-fg">
            Home
          </Link>
          .
        </span>
      }
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.calls ?? 'AI calls',
          value: stats.totalCalls,
          hint: 'Calls to AI models Mushi Mushi made to diagnose and fix your bugs, in this window.',
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
          tone: stats.cronErrorCount > 0 ? 'danger' : jobsLate(stats, lateJobs) ? 'warn' : 'ok',
          hint: 'Mushi Mushi’s scheduled jobs (grading, clean-up, reports) whose last run succeeded on schedule.',
          to: healthLinks.cron,
        },
      ]}
    />
  )
}
