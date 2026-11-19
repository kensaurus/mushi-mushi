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
  /** The page's own job count from its rows (cronJobState), so "on time" matches them (round 3). */
  jobs?: { ok: number; total: number; failed: number }
}

type JobCount = NonNullable<Props['jobs']>

/** A late job is not healthy. With the page's rows, their count alone decides (the stats route
 *  counts a never-run job as stale); without them, stale or warn in the stats does too. */
function jobsLate(stats: HealthStats, lateJobs = 0, jobs?: JobCount): boolean {
  if (jobs) return lateJobs > 0
  return stats.cronStaleCount + stats.cronWarnCount > 0 || lateJobs > 0
}

function jobsFailed(stats: HealthStats, jobs?: JobCount): number {
  return jobs ? jobs.failed : stats.cronErrorCount
}

/** @internal Exported for tests. */
export function healthTone(stats: HealthStats, lateJobs = 0, jobs?: JobCount): PageStatusTone {
  if (jobsFailed(stats, jobs) > 0 || stats.errorRatePct > 5) return 'danger'
  if (stats.errorRatePct > 0 || stats.fallbackRatePct > 0 || jobsLate(stats, lateJobs, jobs)) return 'warn'
  return 'ok'
}

export function HealthSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, lateJobs = 0, jobs }: Props) {
  return (
    <PageStatus
      ariaLabel="Mushi Mushi health status"
      tone={healthTone(stats, lateJobs, jobs)}
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
          value: jobs ? `${jobs.ok}/${jobs.total}` : `${stats.cronHealthyCount}/${stats.cronJobCount}`,
          // A job that never ran is neither late nor fine: "2/3" in green beside it read as all OK (round 3).
          tone: jobsFailed(stats, jobs) > 0 ? 'danger' : jobsLate(stats, lateJobs, jobs) ? 'warn' : jobs && jobs.ok < jobs.total ? 'neutral' : 'ok',
          hint: 'Mushi Mushi’s scheduled jobs (grading, clean-up, reports) whose last run succeeded on schedule.',
          to: healthLinks.cron,
        },
      ]}
    />
  )
}
