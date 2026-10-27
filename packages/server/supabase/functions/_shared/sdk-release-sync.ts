/**
 * FILE: packages/server/supabase/functions/_shared/sdk-release-sync.ts
 * PURPOSE: One GitHub → sdk_upgrade_jobs sync for an upgrade PR, shared by
 *          the console's "Check CI status" (POST /sdk-upgrade/:id/sync) and
 *          the sdk-release-sync cron.
 *
 * A GitHub read that fails (403 rate limit, 429, 5xx, timeout) fails the
 * whole sync and writes nothing. Both callers used to swallow the error as
 * "no data" and store null check-run fields, so a 403 turned "CI failing"
 * into "CI not checked yet" (Mushi report 6449a621).
 *
 * Kept small on purpose: it ships inside `api`, which is held under
 * Supabase's deployment size limit (scripts/deploy-edge-function.test.mjs).
 */

import type { getServiceClient } from './db.ts'
import {
  fetchLatestCheckRun,
  fetchLatestDeploymentStatusForSha,
  fetchLatestWorkflowRunForSha,
  fetchPullRequestDetails,
  normalizeDeployStatus,
  type CheckRunSnapshot,
  type DeploymentStatusSnapshot,
  type PullRequestDetails,
  type WorkflowRunSnapshot,
} from './github.ts'

/** The stored job columns a sync reads. */
export interface SdkReleaseJob {
  id: string
  pr_url: string | null
  pr_state: string | null
  release_status: string | null
  merged_at: string | null
  commit_sha: string | null
}

/** What GitHub said. `null` means GitHub answered "none" (or 404). `workflow` is display only. */
export interface SdkReleaseGithubState {
  pr: PullRequestDetails | null
  commitSha: string | null
  checks: CheckRunSnapshot | null
  deploy: DeploymentStatusSnapshot | null
  workflow: WorkflowRunSnapshot | null
}

type DeployState = ReturnType<typeof normalizeDeployStatus> | null

/** A plain reason for a failed GitHub read: "HTTP 403, …", "timed out", … */
export function describeGithubReadFailure(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timed out'
  const status = String(err instanceof Error ? err.message : err).match(/\b[45]\d\d\b/)?.[0]
  if (!status) return 'no answer'
  return status === '403' || status === '429' ? `HTTP ${status}, likely GitHub's rate limit` : `HTTP ${status}`
}

/** The release status and the sdk_upgrade_jobs update for what GitHub said. */
export function deriveSdkReleaseUpdate(job: SdkReleaseJob, github: SdkReleaseGithubState, now: string) {
  const { pr, checks, deploy, commitSha } = github
  const rawPrState = pr?.state ?? job.pr_state ?? null
  // A PR merged directly on GitHub reports state='closed' + merged=true — the
  // `merged` flag is authoritative (GitHub never returns state='merged').
  const isMerged = pr?.merged === true || rawPrState === 'merged' || Boolean(job.merged_at)
  const deployState: DeployState = deploy ? normalizeDeployStatus(deploy.state) : null

  let releaseStatus: string = job.release_status ?? 'pr_opened'
  if (isMerged) {
    if (deployState === 'success') releaseStatus = 'deployed'
    else if (deployState === 'failure') releaseStatus = 'failed'
    else if (checks?.conclusion === 'success') releaseStatus = 'deploying'
    else releaseStatus = 'merged'
  } else if (rawPrState === 'closed') {
    releaseStatus = 'failed'
  } else if (rawPrState === 'open') {
    if (checks?.conclusion === 'failure') releaseStatus = 'blocked'
    else if (pr?.mergeable === true && pr?.mergeableState === 'clean' && checks?.conclusion === 'success') {
      releaseStatus = 'ready_to_merge'
    } else {
      releaseStatus = 'pr_opened'
    }
  }

  const prState = isMerged ? 'merged' : rawPrState
  const update: Record<string, unknown> = {
    pr_state: prState,
    check_run_status: checks?.status ?? null,
    check_run_conclusion: checks?.conclusion ?? null,
    check_run_updated_at: now,
    release_status: releaseStatus,
    ...(isMerged && !job.merged_at ? { merged_at: now } : {}),
    // No deployment yet keeps the last known deploy columns.
    ...(deploy
      ? {
          deploy_status: deployState,
          deploy_url: deploy.environmentUrl ?? null,
          deploy_environment: deploy.environment ?? null,
          deploy_updated_at: now,
        }
      : {}),
    ...(commitSha && commitSha !== job.commit_sha ? { commit_sha: commitSha } : {}),
  }
  return { releaseStatus, prState, deployState, update }
}

/**
 * Read the PR, its checks and its deployment from GitHub and store the
 * result. Any of the three reads failing stores nothing (GITHUB_UNAVAILABLE).
 */
export async function syncSdkReleaseJob(
  db: ReturnType<typeof getServiceClient>,
  token: string,
  job: SdkReleaseJob,
  opts: { workflow?: boolean } = {},
): Promise<
  | { ok: true; releaseStatus: string; prState: string | null; deployState: DeployState; github: SdkReleaseGithubState }
  | { ok: false; code: 'INVALID_PR_URL' | 'GITHUB_UNAVAILABLE' | 'SYNC_PERSIST_FAILED'; message: string }
> {
  const m = job.pr_url?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!m) return { ok: false, code: 'INVALID_PR_URL', message: 'Could not parse PR URL' }
  const ref = { owner: m[1], repo: m[2] }

  let github: SdkReleaseGithubState
  try {
    const pr = await fetchPullRequestDetails(token, ref, parseInt(m[3], 10))
    const commitSha = pr?.headSha ?? job.commit_sha ?? null
    const [checks, deploy, workflow] = commitSha
      ? await Promise.all([
          fetchLatestCheckRun(token, ref, commitSha),
          fetchLatestDeploymentStatusForSha(token, ref, commitSha),
          opts.workflow ? fetchLatestWorkflowRunForSha(token, ref, pr?.baseRef ?? null, commitSha).catch(() => null) : null,
        ])
      : [null, null, null]
    github = { pr, commitSha, checks, deploy, workflow }
  } catch (err) {
    return { ok: false, code: 'GITHUB_UNAVAILABLE', message: `GitHub did not answer (${describeGithubReadFailure(err)})` }
  }

  const { update, ...derived } = deriveSdkReleaseUpdate(job, github, new Date().toISOString())
  const { error } = await db.from('sdk_upgrade_jobs').update(update).eq('id', job.id)
  if (error) return { ok: false, code: 'SYNC_PERSIST_FAILED', message: error.message }
  return { ok: true, ...derived, github }
}
