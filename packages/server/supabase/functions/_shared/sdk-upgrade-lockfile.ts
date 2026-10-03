/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-lockfile.ts
 * PURPOSE: Open the PR for SDK upgrade jobs parked in `awaiting_lockfile`
 *          (ADR 0019). Called by sdk-release-sync every 5 minutes.
 *
 * OVERVIEW:
 * - The runner pushed the bump as one commit to `mushi/sdk-upgrade-*` because
 *   the host repo has `.github/workflows/mushi-sdk-lockfile.yml`.
 * - That workflow refreshes the lockfile and pushes a commit as
 *   github-actions[bot]. Once a commit like that sits on the branch after the
 *   bump, the PR opens (status completed, release_status pr_opened).
 * - After 30 minutes without one, the PR opens anyway with a note.
 * - A row that cannot reach GitHub (no token, bad repo, branch gone) fails
 *   after the same 30 minutes, so the one-active-job gate never wedges.
 */

import type { getServiceClient } from './db.ts'
import { log as rootLog } from './logger.ts'
import { parseGithubRepoUrl, resolveProjectGithubToken } from './github.ts'
import { findOpenPrByHeadPrefix, ghFetchOptional } from './github-pr.ts'
import { openSdkUpgradePr, type LockfileOutcome } from './sdk-upgrade-pr.ts'
import type { BumpEntry } from './sdk-upgrade-plan.ts'
import { upsertProjectSdkObservationAsync } from './sdk-observation.ts'

const log = rootLog.child('sdk-upgrade-lockfile')

export const LOCKFILE_WAIT_MS = 30 * 60_000
const SWEEP_BATCH = 20
const LOCKFILE_NAMES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'])
const LOCKFILE_COMMIT_PREFIX = 'chore(deps): refresh lockfile'

export interface BranchCommit {
  sha: string
  authorLogin: string | null
  message: string
  /** Only known when the commit detail was fetched. */
  files?: string[]
}

function isLockfileCommit(c: BranchCommit): boolean {
  if (c.authorLogin === 'github-actions[bot]') return true
  if (c.message.startsWith(LOCKFILE_COMMIT_PREFIX)) return true
  return (c.files ?? []).some((f) => LOCKFILE_NAMES.has(f.split('/').pop() ?? ''))
}

export type AwaitingDecision =
  | { action: 'wait' }
  | { action: 'open'; lockfile: Extract<LockfileOutcome, 'refreshed' | 'timeout'>; headSha: string }

/**
 * `commits` is the branch history newest first, as GitHub lists it. Only the
 * commits above the bump commit count: a lockfile commit there means the host
 * workflow ran.
 */
export function decideAwaitingLockfile(input: {
  bumpSha: string
  commits: BranchCommit[]
  awaitingSinceMs: number
  nowMs: number
}): AwaitingDecision {
  const { bumpSha, commits, awaitingSinceMs, nowMs } = input
  const bumpIndex = commits.findIndex((c) => c.sha === bumpSha)
  const after = bumpIndex === -1 ? [] : commits.slice(0, bumpIndex)
  const headSha = commits[0]?.sha ?? bumpSha
  if (after.some(isLockfileCommit)) return { action: 'open', lockfile: 'refreshed', headSha }
  if (nowMs - awaitingSinceMs >= LOCKFILE_WAIT_MS) return { action: 'open', lockfile: 'timeout', headSha }
  return { action: 'wait' }
}

interface AwaitingJob {
  id: string
  project_id: string
  branch: string | null
  commit_sha: string | null
  plan: BumpEntry[] | null
  started_at: string | null
  created_at: string
}

export interface AwaitingSweepResult {
  jobId: string
  outcome: 'waiting' | 'pr_opened' | 'failed' | 'error'
  lockfile?: LockfileOutcome
  prUrl?: string
  error?: string
}

const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

async function listBranchCommits(token: string, owner: string, repo: string, branch: string): Promise<BranchCommit[] | null> {
  const res = await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=20`,
    { headers: ghHeaders(token) },
  )
  if (!Array.isArray(res)) return null
  return (res as Array<{ sha: string; author?: { login?: string } | null; commit?: { message?: string } }>).map((c) => ({
    sha: c.sha,
    authorLogin: c.author?.login ?? null,
    message: c.commit?.message ?? '',
  }))
}

/** The list endpoint carries no file names; read them for the head commit only. */
async function withHeadFiles(token: string, owner: string, repo: string, commits: BranchCommit[]): Promise<BranchCommit[]> {
  const head = commits[0]
  if (!head) return commits
  const detail = await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}/commits/${head.sha}`,
    { headers: ghHeaders(token) },
  )
  const files = (detail as { files?: Array<{ filename?: string }> } | null)?.files
  if (!Array.isArray(files)) return commits
  return [{ ...head, files: files.map((f) => f.filename ?? '') }, ...commits.slice(1)]
}

export async function syncAwaitingLockfileJobs(
  db: ReturnType<typeof getServiceClient>,
  opts: { now?: Date } = {},
): Promise<AwaitingSweepResult[]> {
  const now = opts.now ?? new Date()
  const nowMs = now.getTime()

  const { data: jobs, error } = await db
    .from('sdk_upgrade_jobs')
    .select('id, project_id, branch, commit_sha, plan, started_at, created_at')
    .eq('status', 'awaiting_lockfile')
    .order('created_at', { ascending: true })
    .limit(SWEEP_BATCH)
  if (error) {
    log.error('failed to load awaiting_lockfile jobs', { err: error.message })
    return []
  }

  const results: AwaitingSweepResult[] = []
  for (const job of (jobs ?? []) as AwaitingJob[]) {
    const awaitingSinceMs = Date.parse(job.started_at ?? job.created_at)
    const timedOut = !Number.isFinite(awaitingSinceMs) || nowMs - awaitingSinceMs >= LOCKFILE_WAIT_MS

    const fail = async (reason: string): Promise<void> => {
      await db
        .from('sdk_upgrade_jobs')
        .update({ status: 'failed', finished_at: now.toISOString(), error: reason })
        .eq('id', job.id)
        .eq('status', 'awaiting_lockfile')
      results.push({ jobId: job.id, outcome: 'failed', error: reason })
    }
    // Problems that may clear (a token re-added, GitHub down) wait out the 30 minutes first.
    const waitOrFail = async (reason: string): Promise<void> => {
      if (timedOut) await fail(reason)
      else results.push({ jobId: job.id, outcome: 'waiting', error: reason })
    }

    try {
      if (!job.branch || !job.commit_sha) {
        await fail('Upgrade job is missing its branch or bump commit.')
        continue
      }
      const token = await resolveProjectGithubToken(db, job.project_id)
      const { data: settings } = await db
        .from('project_settings')
        .select('github_repo_url')
        .eq('project_id', job.project_id)
        .maybeSingle()
      const repoRef = parseGithubRepoUrl((settings as { github_repo_url?: string | null } | null)?.github_repo_url ?? null)
      if (!token || !repoRef) {
        await waitOrFail('GitHub is no longer connected for this project.')
        continue
      }
      const { owner, repo } = repoRef

      const listed = await listBranchCommits(token, owner, repo, job.branch)
      if (!listed) {
        await waitOrFail(`Upgrade branch ${job.branch} could not be read on GitHub.`)
        continue
      }
      const commits = listed[0] && listed[0].sha !== job.commit_sha
        ? await withHeadFiles(token, owner, repo, listed)
        : listed

      const decision = decideAwaitingLockfile({ bumpSha: job.commit_sha, commits, awaitingSinceMs, nowMs })
      if (decision.action === 'wait') {
        results.push({ jobId: job.id, outcome: 'waiting' })
        continue
      }

      const repoInfo = await ghFetchOptional(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: ghHeaders(token),
      })
      const base = (repoInfo as { default_branch?: string } | null)?.default_branch ?? 'main'
      const plan = job.plan ?? []

      let pr: { url: string; number: number }
      try {
        pr = await openSdkUpgradePr({ token, owner, repo, base, branch: job.branch, plan, lockfile: decision.lockfile }, {
          info: (msg, ctx) => log.info(msg, ctx as Record<string, unknown>),
          warn: (msg, ctx) => log.warn(msg, ctx as Record<string, unknown>),
        })
      } catch (err) {
        // A previous tick opened it but died before saving: adopt that PR.
        const existing = await findOpenPrByHeadPrefix(token, owner, repo, job.branch)
        if (!existing || existing.headRef !== job.branch) throw err
        pr = { url: existing.url, number: existing.number }
      }

      const finishedAt = now.toISOString()
      await db
        .from('sdk_upgrade_jobs')
        .update({
          status: 'completed',
          release_status: 'pr_opened',
          pr_state: 'open',
          pr_url: pr.url,
          pr_number: pr.number,
          commit_sha: decision.headSha,
          finished_at: finishedAt,
        })
        .eq('id', job.id)
        .eq('status', 'awaiting_lockfile')

      if (plan.length > 0) {
        upsertProjectSdkObservationAsync(db, {
          projectId: job.project_id,
          sdkPackage: plan[0].package,
          sdkVersion: plan[0].to,
          source: 'upgrade_verify',
          observedAt: finishedAt,
        })
      }
      results.push({ jobId: job.id, outcome: 'pr_opened', lockfile: decision.lockfile, prUrl: pr.url })
      log.info('opened deferred upgrade PR', { jobId: job.id, lockfile: decision.lockfile, prUrl: pr.url })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('awaiting_lockfile job errored', { jobId: job.id, err: msg })
      // A PR that will not open (repo archived, branch protection, a 422 that
      // repeats) must not hold the one-active-job slot forever.
      if (nowMs - awaitingSinceMs >= 2 * LOCKFILE_WAIT_MS) {
        await fail(`Could not open the upgrade PR: ${msg.slice(0, 300)}`)
      } else {
        results.push({ jobId: job.id, outcome: 'error', error: msg })
      }
    }
  }
  return results
}
