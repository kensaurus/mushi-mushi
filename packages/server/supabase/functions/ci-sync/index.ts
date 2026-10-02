/**
 * FILE: packages/server/supabase/functions/ci-sync/index.ts
 * PURPOSE: Backfill `fix_attempts.check_run_conclusion` for PRs the webhook
 *          path never delivered. Two invocation modes:
 *
 *          1. `{ fix_attempt_id }` — refresh exactly one attempt. Driven by
 *             the admin UI (`/v1/admin/fixes/:id/refresh-ci`) so a user can
 *             pull the latest CI state without waiting for the next cron.
 *
 *          2. `{}` — sweep every `completed` attempt that has a `pr_number`
 *             and either no `check_run_updated_at` or one older than 1 h.
 *             Driven by the `mushi-ci-sync-10m` pg_cron. Small bounded batch
 *             (20 rows per tick) to keep the function well under the 150 s
 *             runtime limit and avoid GitHub rate-limit spikes.
 *
 *          Both paths also read the PR itself: merged → finalizeFixMerge,
 *          closed unmerged → finalizeFixClosedUnmerged (attempt pr_state
 *          'closed', report back out of 'fixing', timeline event). Attempts
 *          whose PR already ended drop out of the sweep.
 *
 *          Both paths go through `fetchLatestCheckRun` which collapses the
 *          matrix of check-runs into a single worst-wins conclusion, so the
 *          PDCA receipt's "Check" stage is honest (red stays red even if a
 *          later retry passed).
 *
 * SEC-1: Internal-only — `requireServiceRoleAuth` blocks public callers.
 *        The api function (/refresh-ci) proxies JWT-authorised user calls
 *        through this function using the internal caller secret.
 */

import { Hono } from 'npm:hono@4'
import { getServiceClient } from '../_shared/db.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withSentry } from '../_shared/sentry.ts'
import { log as rootLog } from '../_shared/logger.ts'
import {
  fetchLatestCheckRun,
  fetchPullRequest,
  parseGithubRepoUrl,
  resolveProjectGithubToken,
  type CheckRunSnapshot,
  type GithubRepoRef,
} from '../_shared/github.ts'
import { finalizeFixClosedUnmerged, finalizeFixMerge } from '../_shared/fix-merge.ts'
import { prLifecycleFrom, type PrLifecycle } from '../_shared/fix-loop-status.ts'

const log = rootLog.child('ci-sync')
const app = new Hono()

interface FixAttemptRow {
  id: string
  project_id: string
  report_id: string
  agent: string | null
  branch: string | null
  commit_sha: string | null
  pr_number: number | null
  pr_url: string | null
  pr_state: PrLifecycle | null
  merged_at: string | null
  repo_id: string | null
}

const ATTEMPT_COLUMNS =
  'id, project_id, report_id, agent, branch, commit_sha, pr_number, pr_url, pr_state, merged_at, repo_id'

/**
 * The webhook is the fast path for PR lifecycle, but it drops (App not
 * subscribed, URL unregistered). Without this poll a PR closed unmerged left
 * the attempt "awaiting merge" and the report in 'fixing' forever.
 */
async function syncPrLifecycle(
  db: ReturnType<typeof getServiceClient>,
  token: string,
  ref: GithubRepoRef,
  attempt: FixAttemptRow,
): Promise<PrLifecycle | null> {
  const prNumber = attempt.pr_number ?? Number(attempt.pr_url?.match(/\/pull\/(\d+)/)?.[1] ?? NaN)
  if (!Number.isFinite(prNumber)) return null
  const pr = await fetchPullRequest(token, ref, prNumber)
  if (!pr) return null
  const state = prLifecycleFrom(pr)
  if (state === 'merged') {
    if (!attempt.merged_at) {
      await finalizeFixMerge(db, attempt, {
        prUrl: attempt.pr_url!,
        prNumber,
        repository: `${ref.owner}/${ref.repo}`,
      })
    }
  } else if (state === 'closed') {
    await finalizeFixClosedUnmerged(db, attempt, { prNumber, closedAt: pr.closedAt ?? null, source: 'ci_sync' })
  } else if (attempt.pr_state !== state) {
    await db.from('fix_attempts').update({ pr_state: state }).eq('id', attempt.id)
  }
  return state
}

async function syncOne(
  db: ReturnType<typeof getServiceClient>,
  attempt: FixAttemptRow,
): Promise<{ ok: boolean; reason?: string; snapshot?: CheckRunSnapshot; prState?: PrLifecycle | null }> {
  if (!attempt.pr_url) return { ok: false, reason: 'no_pr_url' }

  const ref = parseGithubRepoUrl(attempt.pr_url.split('/pull/')[0])
  if (!ref) return { ok: false, reason: 'unparseable_pr_url' }

  let installationId: number | null = null
  if (attempt.repo_id) {
    const { data: repo } = await db
      .from('project_repos')
      .select('github_app_installation_id')
      .eq('id', attempt.repo_id)
      .maybeSingle()
    if (repo?.github_app_installation_id) installationId = Number(repo.github_app_installation_id)
  }

  const token = await resolveProjectGithubToken(db, attempt.project_id, installationId)
  if (!token) return { ok: false, reason: 'no_github_token' }

  try {
    const prState = await syncPrLifecycle(db, token, ref, attempt)
    if (!attempt.commit_sha) return { ok: prState != null, reason: 'no_commit_sha', prState }
    const snapshot = await fetchLatestCheckRun(token, ref, attempt.commit_sha)
    if (!snapshot) return { ok: prState != null, reason: 'check_runs_404', prState }
    await db.from('fix_attempts').update({
      check_run_status: snapshot.status,
      check_run_conclusion: snapshot.conclusion,
      check_run_updated_at: new Date().toISOString(),
    }).eq('id', attempt.id)
    return { ok: true, snapshot, prState }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('check-runs fetch failed', { attemptId: attempt.id, error: msg })
    return { ok: false, reason: msg }
  }
}

app.get('/ci-sync/health', (c) => c.json({ ok: true }))

app.post('/ci-sync', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const db = getServiceClient()
  let body: { fix_attempt_id?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    // Empty body is valid — sweep mode.
  }

  if (body.fix_attempt_id) {
    const { data: attempt, error } = await db
      .from('fix_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('id', body.fix_attempt_id)
      .maybeSingle()
    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }
    if (!attempt) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)
    const result = await syncOne(db, attempt as FixAttemptRow)
    return c.json({ ok: result.ok, data: result })
  }

  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString()
  const batchLimit = Number(Deno.env.get('MUSHI_CI_SYNC_BATCH') ?? '20') | 0

  // Prefer attempts that have NEVER been sync'd (check_run_updated_at IS
  // NULL) over stale ones so first-time PR backfills don't starve behind
  // hourly refreshes of already-tracked PRs.
  const { data: neverSynced } = await db
    .from('fix_attempts')
    .select(ATTEMPT_COLUMNS)
    .eq('status', 'completed')
    .not('pr_number', 'is', null)
    .is('merged_at', null)
    .or('pr_state.is.null,pr_state.in.(open,draft)')
    .is('check_run_updated_at', null)
    .limit(batchLimit)

  let rows: FixAttemptRow[] = (neverSynced ?? []) as FixAttemptRow[]
  if (rows.length < batchLimit) {
    const remaining = batchLimit - rows.length
    const { data: stale } = await db
      .from('fix_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('status', 'completed')
      .not('pr_number', 'is', null)
      .is('merged_at', null)
      .or('pr_state.is.null,pr_state.in.(open,draft)')
      .lt('check_run_updated_at', cutoff)
      .order('check_run_updated_at', { ascending: true, nullsFirst: true })
      .limit(remaining)
    rows = rows.concat((stale ?? []) as FixAttemptRow[])
  }

  const results: Array<{ id: string; ok: boolean; reason?: string; conclusion?: string | null; prState?: PrLifecycle | null }> = []
  for (const attempt of rows) {
    const r = await syncOne(db, attempt)
    results.push({
      id: attempt.id,
      ok: r.ok,
      reason: r.reason,
      conclusion: r.snapshot?.conclusion ?? null,
      prState: r.prState ?? null,
    })
  }
  log.info('ci-sync sweep complete', { processed: results.length, succeeded: results.filter((r) => r.ok).length })
  return c.json({ ok: true, data: { processed: results.length, results } })
})

Deno.serve(withSentry('ci-sync', app.fetch))
