/**
 * FILE: packages/cli/src/runner/cost-fix.ts
 * PURPOSE: `mushi runner fix` / `fix-status` (ADR 0047): the CI cost fix job
 *          as /v1/admin/ci/cost-fixes returns it, waiting for the worker, and
 *          the lines the terminal prints.
 */

import { apiCall, die } from '../cli-shared.js'
import type { CliConfig } from '../config.js'

/** Same list as `CI_COST_FIX_KINDS` on the server (`_shared/ci-overview-types.ts`). */
export const COST_FIX_KINDS = ['add_concurrency', 'skip_drafts', 'weekly_cron', 'ignore_docs_paths'] as const

export interface CostFixJob {
  id: string
  repo: string
  workflowPath: string
  kind: string
  status: 'queued' | 'running' | 'pr_opened' | 'no_change' | 'refused' | 'failed'
  summary: string | null
  errorCode: string | null
  error: string | null
  prUrl: string | null
  prNumber: number | null
  monthSavingUsd: number | null
  baseline: { days: number; minutes: number; usd: number; jobs: number } | null
  measured: { days: number; minutes: number; usd: number; jobs: number; complete: boolean } | null
  saving: { minutesPerDay: number; usdPerMonth: number; measuredDays: number } | null
  mergedAt: string | null
  closedAt: string | null
}

export const COST_FIX_WAIT_MS = 120_000
export const COST_FIX_POLL_MS = 3_000

const inFlight = (j: CostFixJob) => j.status === 'queued' || j.status === 'running'

/** Read the job until the worker finishes it (or the wait runs out). */
export async function waitForCostFix(
  job: CostFixJob,
  config: CliConfig,
  opts: { waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<CostFixJob> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const deadline = Date.now() + (opts.waitMs ?? COST_FIX_WAIT_MS)
  let current = job
  while (inFlight(current) && Date.now() < deadline) {
    const res = await apiCall<{ job: CostFixJob }>(`/v1/admin/ci/cost-fixes/${current.id}`, config)
    if (!res.ok) die(res)
    current = res.data.job
    if (!inFlight(current)) break
    await sleep(opts.pollMs ?? COST_FIX_POLL_MS)
  }
  return current
}

export function renderCostFix(job: CostFixJob): string[] {
  const where = `${job.repo}/${job.workflowPath} (${job.kind})`
  const lines: string[] = []
  switch (job.status) {
    case 'queued':
    case 'running':
      lines.push(`Opening a draft PR for ${where}. Job ${job.id}.`, `Check it with: mushi runner fix-status ${job.id}`)
      break
    case 'pr_opened':
      lines.push(`Draft PR for ${where}: ${job.prUrl ?? '(link pending)'}`)
      if (job.summary) lines.push(job.summary)
      if (job.closedAt && !job.mergedAt) lines.push('The pull request was closed without merging.')
      else if (!job.mergedAt) lines.push('Review it, mark it ready and merge it. Nothing changes until then.')
      break
    case 'no_change':
      lines.push(`Nothing to change in ${where}: ${job.summary ?? 'the workflow already has this fix.'}`)
      break
    case 'refused':
      lines.push(`Mushi will not change ${where}: ${job.error ?? job.summary ?? 'the edit was refused.'}`)
      break
    case 'failed':
      lines.push(`Could not open the PR for ${where}: ${job.error ?? 'unknown error.'}`)
      break
  }
  if (job.baseline && job.baseline.jobs > 0) {
    lines.push(`Before: about ${job.baseline.minutes} billed minutes over ${job.baseline.days} days (estimated from job times).`)
  }
  if (job.saving && job.mergedAt) {
    const s = job.saving
    lines.push(
      s.minutesPerDay > 0
        ? `Saved ${s.minutesPerDay} billed minutes a day (about $${s.usdPerMonth.toFixed(2)} a month), measured over ${s.measuredDays} day${s.measuredDays === 1 ? '' : 's'}.`
        : `No saving measured yet over ${s.measuredDays} day${s.measuredDays === 1 ? '' : 's'}.`,
    )
  } else if (job.monthSavingUsd != null && job.monthSavingUsd > 0 && !job.mergedAt) {
    lines.push(`Estimated saving: about $${job.monthSavingUsd.toFixed(2)} a month.`)
  }
  return lines
}
