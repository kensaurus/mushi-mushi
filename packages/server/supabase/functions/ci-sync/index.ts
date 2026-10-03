/**
 * FILE: packages/server/supabase/functions/ci-sync/index.ts
 * PURPOSE: Backfill `fix_attempts.check_run_conclusion` for PRs the webhook
 *          path never delivered. Two invocation modes:
 *
 *          1. `{ fix_attempt_id }` — refresh exactly one attempt. Driven by
 *             the admin UI (`/v1/admin/fixes/:id/refresh-ci`) so a user can
 *             pull the latest CI state without waiting for the next cron.
 *
 *          2. `{}` — sweep `completed` attempts with an unmerged, not-closed
 *             PR, oldest-visited first (round-robin on updated_at, revisit
 *             after 15 min), then reconcile reports stuck in 'fixing'.
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
  installationIdForAttempt,
  parseGithubRepoUrl,
  resolveProjectGithubToken,
  type CheckRunSnapshot,
  type GithubRepoRef,
} from '../_shared/github.ts'
import { finalizeFixClosedUnmerged, finalizeFixMerge, reconcileStuckFixingReports } from '../_shared/fix-merge.ts'
import { prLifecycleFrom, type PrLifecycle } from '../_shared/fix-loop-status.ts'

const log = rootLog.child('ci-sync')
const app = new Hono()

/**
 * How soon the sweep re-reads an open PR. GitHub pull_request webhooks do not
 * reach Mushi today (2026-10-02: no deliveries in the function logs), so this
 * poll is the only way a merge or close is noticed. It was 1 h; report
 * 469f6962 stayed 'fixing' 47 minutes after the close-handling deploy because
 * of it.
 */
const SWEEP_REVISIT_MS = 15 * 60_000

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
): Promise<{ state: PrLifecycle; headSha: string | null } | null> {
  const prNumber = attempt.pr_number ?? Number(attempt.pr_url?.match(/\/pull\/(\d+)/)?.[1] ?? NaN)
  if (!Number.isFinite(prNumber)) return null
  const pr = await fetchPullRequest(token, ref, prNumber)
  if (!pr) return null
  const state = prLifecycleFrom(pr)
  // Cloud agents (Cursor, GitHub) report only a PR URL. Without pr_number the
  // console cannot merge, and without a commit the CI read never ran.
  if (attempt.pr_number == null || (!attempt.commit_sha && pr.headSha)) {
    await db.from('fix_attempts').update({
      pr_number: attempt.pr_number ?? prNumber,
      ...(!attempt.commit_sha && pr.headSha ? { commit_sha: pr.headSha } : {}),
    }).eq('id', attempt.id)
  }
  if (state === 'merged') {
    if (!attempt.merged_at) {
      await finalizeFixMerge(db, attempt, {
        prUrl: attempt.pr_url!,
        prNumber,
        repository: `${ref.owner}/${ref.repo}`,
        mergedAt: pr.mergedAt ?? null,
      })
    }
  } else if (state === 'closed') {
    await finalizeFixClosedUnmerged(db, attempt, { prNumber, closedAt: pr.closedAt ?? null, source: 'ci_sync' })
  } else if (attempt.pr_state !== state) {
    await db.from('fix_attempts').update({ pr_state: state }).eq('id', attempt.id)
  }
  return { state, headSha: pr.headSha ?? null }
}

async function syncOne(
  db: ReturnType<typeof getServiceClient>,
  attempt: FixAttemptRow,
): Promise<{ ok: boolean; reason?: string; snapshot?: CheckRunSnapshot; prState?: PrLifecycle | null }> {
  if (!attempt.pr_url) return { ok: false, reason: 'no_pr_url' }

  const ref = parseGithubRepoUrl(attempt.pr_url.split('/pull/')[0])
  if (!ref) return { ok: false, reason: 'unparseable_pr_url' }

  const installationId = await installationIdForAttempt(db, attempt)
  const token = await resolveProjectGithubToken(db, attempt.project_id, installationId)
  if (!token) return { ok: false, reason: 'no_github_token' }

  // Separate try: a failed PR read (403 / 5xx) must not also skip the
  // check-run backfill below, which predates the lifecycle sync.
  let prState: PrLifecycle | null = null
  let headSha: string | null = null
  try {
    const pr = await syncPrLifecycle(db, token, ref, attempt)
    prState = pr?.state ?? null
    headSha = pr?.headSha ?? null
  } catch (err) {
    log.warn('pull request fetch failed', {
      attemptId: attempt.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  try {
    // The PR head, not the first fix commit: a branch update or a pushed
    // follow-up (lockfile refresh) reruns CI on a new head.
    const sha = headSha ?? attempt.commit_sha
    if (!sha) return { ok: prState != null, reason: 'no_commit_sha', prState }
    const snapshot = await fetchLatestCheckRun(token, ref, sha)
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
    return { ok: false, reason: msg, prState }
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

  const cutoff = new Date(Date.now() - SWEEP_REVISIT_MS).toISOString()
  const batchLimit = Number(Deno.env.get('MUSHI_CI_SYNC_BATCH') ?? '20') | 0

  // One round-robin queue on updated_at: every visit stamps the row, so an
  // attempt whose PR can never be read (no token, repo gone) moves to the
  // back instead of refilling every batch. The old "never synced first" query
  // re-selected those rows each tick and starved every other open PR.
  // pr_url, not pr_number: syncPrLifecycle parses the number from the URL.
  const { data: due } = await db
    .from('fix_attempts')
    .select(ATTEMPT_COLUMNS)
    .eq('status', 'completed')
    .not('pr_url', 'is', null)
    .is('merged_at', null)
    .or('pr_state.is.null,pr_state.in.(open,draft)')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(batchLimit)
  const rows: FixAttemptRow[] = (due ?? []) as FixAttemptRow[]

  const results: Array<{ id: string; ok: boolean; reason?: string; conclusion?: string | null; prState?: PrLifecycle | null }> = []
  for (const attempt of rows) {
    const r = await syncOne(db, attempt)
    await db.from('fix_attempts').update({ updated_at: new Date().toISOString() }).eq('id', attempt.id)
    results.push({
      id: attempt.id,
      ok: r.ok,
      reason: r.reason,
      conclusion: r.snapshot?.conclusion ?? null,
      prState: r.prState ?? null,
    })
  }

  // Phase 2: no report stays in 'fixing' once nothing behind it is alive.
  const fixing = await reconcileStuckFixingReports(db)
  log.info('ci-sync sweep complete', {
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    fixing,
  })
  return c.json({ ok: true, data: { processed: results.length, results, fixing } })
})

Deno.serve(withSentry('ci-sync', app.fetch))
