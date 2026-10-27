/**
 * FILE: apps/admin/src/lib/ciCostFix.ts
 * PURPOSE: The CI cost "Open fix PR" job as /v1/admin/ci/cost-fixes returns
 *          it (copy of `CostFixJobView` in `_shared/ci-cost-fix-runner.ts`),
 *          and the plain words the console shows for each kind, state and
 *          error. Pure, no React.
 */

import type { CiCostFixKind } from './ciTypes'

type CiCostFixStatus = 'queued' | 'running' | 'pr_opened' | 'no_change' | 'refused' | 'failed'

interface CiMinutesSeries {
  from: string
  to: string
  days: number
  complete: boolean
  minutes: number
  usd: number
  jobs: number
  perDay: Array<{ day: string; minutes: number; usd: number; jobs: number }>
}

export interface CiCostFixJob {
  id: string
  projectId: string
  repo: string
  workflowPath: string
  workflowName: string | null
  kind: CiCostFixKind
  status: CiCostFixStatus
  summary: string | null
  errorCode: string | null
  error: string | null
  prUrl: string | null
  prNumber: number | null
  branch: string | null
  monthSavingUsd: number | null
  baseline: CiMinutesSeries | null
  measured: CiMinutesSeries | null
  saving: { minutesPerDay: number; usdPerMonth: number; measuredDays: number } | null
  mergedAt: string | null
  closedAt: string | null
  createdAt: string
  finishedAt: string | null
}

/** What the PR changes, for the confirm dialog. */
export const CI_COST_FIX_CHANGE: Record<CiCostFixKind, string> = {
  add_concurrency: 'Adds a concurrency group, so a new push to a pull request cancels the run it replaces. Pushes, manual and scheduled runs always finish. Mushi refuses on a workflow that deploys or releases.',
  skip_drafts: 'Draft pull requests stop running this workflow; it runs when a pull request is marked ready for review. A job your branch requires keeps running on drafts and fails at a first step, "Draft PRs run no CI", so a draft can never merge untested.',
  weekly_cron: 'Its schedule runs once a week instead of more often. Mushi refuses on a workflow that deploys or releases.',
  ignore_docs_paths: 'A change to only Markdown files or docs/ stops running this workflow. Mushi refuses when the workflow produces a check your branch requires.',
}

export function isCostFixInFlight(job: Pick<CiCostFixJob, 'status'> | null): boolean {
  return job?.status === 'queued' || job?.status === 'running'
}

/** Errors the POST answers with, in words a person can act on. */
export function costFixErrorText(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'REPO_NOT_IN_PROJECT':
      return 'This repository is not connected to the project any more. Connect it on the Projects page.'
    case 'RATE_LIMITED':
      return message ?? 'Mushi opened several fix pull requests in the last hour. Try again later.'
    case 'COST_FIX_IN_PROGRESS':
      return 'Mushi is already opening this fix. It shows here in a moment.'
    case 'MIGRATION_PENDING':
      return 'Fix pull requests are not set up on this server yet.'
    case 'FORBIDDEN':
      return 'Viewers cannot open pull requests. Ask an owner or admin of this project.'
    default:
      return message ?? 'Mushi could not open the fix. Try again.'
  }
}

/** One line for the job's state under the button. */
export function costFixStatusText(job: CiCostFixJob): string {
  switch (job.status) {
    case 'queued':
    case 'running':
      return 'Opening a draft pull request…'
    case 'no_change':
      return job.summary ?? 'Already applied: the workflow has this fix.'
    case 'refused':
      return job.error ?? job.summary ?? 'Mushi will not make this change to the workflow.'
    case 'failed':
      return job.error ?? 'Mushi could not open the pull request.'
    case 'pr_opened':
      if (job.closedAt && !job.mergedAt) return 'The pull request was closed without merging.'
      if (!job.mergedAt) return 'Draft pull request open. Review it, mark it ready and merge it.'
      if (!job.measured) return 'Merged. Mushi measures the saving from the first full day after the merge.'
      return 'Merged.'
  }
}

/** "Saved 12 billed minutes a day (about $2.16 a month), measured over 3 days." */
export function costFixSavingText(job: CiCostFixJob): string | null {
  const s = job.saving
  if (!s || !job.mergedAt) return null
  const days = `${s.measuredDays} day${s.measuredDays === 1 ? '' : 's'}`
  if (s.minutesPerDay <= 0) {
    return `No saving measured yet: about ${Math.abs(s.minutesPerDay)} more billed minutes a day than before, over ${days}.`
  }
  const usd = s.usdPerMonth > 0 ? ` (about $${s.usdPerMonth.toFixed(2)} a month)` : ''
  return `Saved ${s.minutesPerDay} billed minutes a day${usd}, measured over ${days} against the ${job.baseline?.days ?? 14} days before.`
}
