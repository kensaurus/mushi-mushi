/**
 * FILE: HealthSnapshotStrip.tsx
 * PURPOSE: Mushi Mushi's own health (PageStatus, P1): the AI calls behind diagnoses and fixes,
 *          and its background jobs. This is not the user's app (pattern P6).
 *
 *          Console UX overhaul (2026-11-19): the line leads with what is wrong and the button
 *          that fixes it ("1 scheduled job is overdue: Weekly summary · Run now"), and each number
 *          is a picture: calls as an ok / backup / failed split, failed calls against the 5%
 *          line, one status mark per job. Never green while a job is overdue (2026-11-18).
 */

import { Link } from 'react-router-dom'
import { Btn, PageStatus, type PageStatusTone } from '../ui'
import type { HealthStats, HealthTabId } from './HealthStatsTypes'
import { healthLinks } from '../../lib/statCardLinks'
import { ADMIN_ONLY_HINT } from '../../lib/orgPermissions'
import { ThresholdBar } from '../signal/BarCell'
import { StatusMark, type RunStatus } from '../signal/StatusMark'
import type { SignalTone } from '../signal/StatusGlyph'

/** Jobs the console can run on demand (POST /v1/admin/health/cron/:job/trigger). */
export const RUNNABLE_JOBS = ['judge-batch', 'intelligence-report'] as const
export type RunnableJob = (typeof RUNNABLE_JOBS)[number]

/** Scheduled jobs by what they do, not their function name. */
export const JOB_LABEL: Record<string, string> = {
  'judge-batch': 'Triage grading',
  'intelligence-report': 'Weekly summary',
  'data-retention': 'Data clean-up',
}

const jobName = (job: string) => JOB_LABEL[job] ?? job
const names = (jobs: readonly string[]) => jobs.map(jobName).join(', ')
const isRunnable = (job: string): job is RunnableJob => (RUNNABLE_JOBS as readonly string[]).includes(job)

/** Failed AI calls over this share turn the line red. */
const ERROR_CRIT_PCT = 5

export type HealthLeadAction = { kind: 'run'; job: RunnableJob; label: string } | { kind: 'tab'; tab: HealthTabId; label: string } | null

export interface HealthLead {
  sentence: string | null
  tone: PageStatusTone
  action: HealthLeadAction
}

/**
 * The worst problem first, then its one button: a failed job, a
 * high failed-call share, an overdue job, any failed calls. Null sentence when all is well (the
 * line then points at Home for the user's own app).
 */
export function healthLead(input: {
  stats: Pick<HealthStats, 'errorRatePct' | 'fallbackRatePct' | 'totalCalls'>
  failing: readonly string[]
  overdue: readonly string[]
  window: string
}): HealthLead {
  const { stats, failing, overdue, window } = input
  const jobAction = (jobs: readonly string[]): HealthLeadAction => {
    const runnable = jobs.find(isRunnable)
    return jobs.length === 1 && runnable ? { kind: 'run', job: runnable, label: 'Run now' } : { kind: 'tab', tab: 'cron', label: 'Open jobs' }
  }
  if (failing.length > 0) {
    return {
      sentence: `${failing.length === 1 ? '1 scheduled job' : `${failing.length} scheduled jobs`} failed on ${failing.length === 1 ? 'its' : 'their'} last run: ${names(failing)}.`,
      tone: 'danger',
      action: jobAction(failing),
    }
  }
  if (stats.errorRatePct > ERROR_CRIT_PCT) {
    return {
      sentence: `${stats.errorRatePct}% of AI calls failed in the last ${window}, usually a provider outage or an expired key.`,
      tone: 'danger',
      action: { kind: 'tab', tab: 'llm', label: 'See failed calls' },
    }
  }
  if (overdue.length > 0) {
    return {
      sentence: `${overdue.length === 1 ? '1 scheduled job is' : `${overdue.length} scheduled jobs are`} overdue: ${names(overdue)}.`,
      tone: 'warn',
      action: jobAction(overdue),
    }
  }
  if (stats.errorRatePct > 0) {
    return { sentence: `${stats.errorRatePct}% of AI calls failed in the last ${window}.`, tone: 'warn', action: { kind: 'tab', tab: 'llm', label: 'See failed calls' } }
  }
  if (stats.fallbackRatePct > 0) {
    return {
      sentence: `${stats.fallbackRatePct}% of AI calls switched to the backup model in the last ${window}.`,
      tone: 'warn',
      action: { kind: 'tab', tab: 'llm', label: 'See AI calls' },
    }
  }
  return { sentence: null, tone: 'ok', action: null }
}

interface Props {
  stats: HealthStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Jobs the page counts as overdue (the same count as its rows). */
  lateJobs?: number
  /** The page's own job count from its rows (cronJobState), so "on time" matches them (round 3). */
  jobs?: { ok: number; total: number; failed: number }
  /** Per job: its tone from cronJobState, for one mark each. */
  jobMarks?: ReadonlyArray<{ job: string; tone: SignalTone; label: string }>
  /** Failing and overdue job ids (cronJobState). */
  failingJobs?: readonly string[]
  overdueJobs?: readonly string[]
  window?: string
  /** Run a job now (the lead's "Run now"). */
  onRunJob?: (job: RunnableJob) => void
  runningJob?: string | null
  onTab?: (tab: HealthTabId) => void
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
  if (jobsFailed(stats, jobs) > 0 || stats.errorRatePct > ERROR_CRIT_PCT) return 'danger'
  if (stats.errorRatePct > 0 || stats.fallbackRatePct > 0 || jobsLate(stats, lateJobs, jobs)) return 'warn'
  return 'ok'
}

const MARK_OF: Record<SignalTone, RunStatus> = { ok: 'passed', warn: 'slow', danger: 'failed', info: 'running', off: 'idle' }

/** Calls as one bar: answered, answered by the backup model, failed. */
function CallSplit({ errorPct, fallbackPct }: { errorPct: number; fallbackPct: number }) {
  const failed = Math.max(0, Math.min(100, errorPct))
  const backup = Math.max(0, Math.min(100 - failed, fallbackPct))
  const ok = 100 - failed - backup
  return (
    <span className="flex h-2 w-24 overflow-hidden rounded-xs bg-surface-overlay" role="img" aria-label={`${ok}% answered, ${backup}% by the backup model, ${failed}% failed`} data-testid="health-call-split">
      <span className="ci-grow-x bg-st-passed" style={{ width: `${ok}%` }} />
      <span className="bg-st-slow" style={{ width: `${backup}%` }} />
      <span className="bg-st-failed" style={{ width: `${failed}%` }} />
    </span>
  )
}

export function HealthSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  statLabels,
  lateJobs = 0,
  jobs,
  jobMarks = [],
  failingJobs = [],
  overdueJobs = [],
  window = '24h',
  onRunJob,
  runningJob = null,
  onTab,
}: Props) {
  const lead = healthLead({ stats, failing: failingJobs, overdue: overdueJobs, window })
  const tone = healthTone(stats, lateJobs, jobs)
  const action = lead.action
  const button =
    action?.kind === 'run' && onRunJob ? (
      <Btn
        size="sm"
        variant="primary"
        loading={runningJob === action.job}
        disabled={stats.canRunJobs === false}
        title={stats.canRunJobs === false ? ADMIN_ONLY_HINT : `Runs ${jobName(action.job)} now; it spends AI budget.`}
        onClick={() => onRunJob(action.job)}
        data-testid="health-lead-action"
      >
        {action.label}
      </Btn>
    ) : action?.kind === 'tab' && onTab ? (
      <Btn size="sm" variant={tone === 'danger' ? 'primary' : 'ghost'} onClick={() => onTab(action.tab)} data-testid="health-lead-action">
        {action.label}
      </Btn>
    ) : undefined
  const errorScale = Math.max(ERROR_CRIT_PCT * 2, stats.errorRatePct)
  return (
    <PageStatus
      ariaLabel="Mushi Mushi health status"
      tone={lead.sentence ? lead.tone : tone}
      sentence={
        lead.sentence ?? (
          <span className="text-fg-muted">
            Mushi Mushi’s own AI calls and jobs are fine. Your app’s uptime and errors are on{' '}
            <Link to="/dashboard" className="underline underline-offset-2 hover:text-fg">
              Home
            </Link>
            .
          </span>
        )
      }
      action={button}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.calls ?? 'AI calls',
          value: stats.totalCalls,
          hint: 'Calls to AI models Mushi Mushi made to diagnose and fix your bugs, in this window. The bar splits them: answered, answered by the backup model, failed.',
          to: healthLinks.totalCalls,
          visual: stats.totalCalls > 0 ? <CallSplit errorPct={stats.errorRatePct} fallbackPct={stats.fallbackRatePct} /> : undefined,
        },
        {
          label: statLabels?.errors ?? 'Failed calls',
          value: `${stats.errorRatePct}%`,
          tone: stats.errorRatePct > ERROR_CRIT_PCT ? 'danger' : stats.errorRatePct > 0 ? 'warn' : 'ok',
          hint: `Share of AI calls that returned an error; the tick is the ${ERROR_CRIT_PCT}% line. A call that switched to a backup model is not counted here.`,
          to: healthLinks.errorRate,
          visual:
            stats.totalCalls > 0 ? (
              <ThresholdBar
                fill={stats.errorRatePct / errorScale}
                warn={null}
                crit={ERROR_CRIT_PCT / errorScale}
                level={stats.errorRatePct > ERROR_CRIT_PCT ? 'crit' : stats.errorRatePct > 0 ? 'warn' : 'ok'}
                label={`limit ${ERROR_CRIT_PCT}%`}
              />
            ) : undefined,
        },
        {
          label: statLabels?.cron ?? 'Background jobs on time',
          value: jobs ? `${jobs.ok}/${jobs.total}` : `${stats.cronHealthyCount}/${stats.cronJobCount}`,
          // A job that never ran is neither late nor fine: "2/3" in green beside it read as all OK (round 3).
          tone: jobsFailed(stats, jobs) > 0 ? 'danger' : jobsLate(stats, lateJobs, jobs) ? 'warn' : jobs && jobs.ok < jobs.total ? 'neutral' : 'ok',
          hint: 'Mushi Mushi’s scheduled jobs (grading, clean-up, reports) whose last run succeeded on schedule. One mark per job.',
          to: healthLinks.cron,
          visual:
            jobMarks.length > 0 ? (
              <span className="flex items-center gap-1" data-testid="health-job-marks">
                {jobMarks.map((m) => (
                  <span key={m.job} title={`${jobName(m.job)}: ${m.label}`}>
                    <StatusMark status={MARK_OF[m.tone]} label={`${jobName(m.job)}: ${m.label}`} />
                  </span>
                ))}
              </span>
            ) : undefined,
        },
      ]}
    />
  )
}
