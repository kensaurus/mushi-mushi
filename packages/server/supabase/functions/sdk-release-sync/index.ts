/**
 * FILE: packages/server/supabase/functions/sdk-release-sync/index.ts
 * PURPOSE: Periodic CI/deploy status sync for active SDK upgrade jobs.
 *
 * Called by pg_cron every 5 minutes. Finds jobs in `pr_opened | ready_to_merge |
 * blocked | merged | deploying` states and calls `syncSdkReleaseJob`, which
 * reads checks on the PR head (not the stored bump commit) and upserts
 * sdk_upgrade_jobs. A failed GitHub read writes nothing.
 *
 * Before that, jobs in status `awaiting_lockfile` (ADR 0019) get their PR
 * opened once the host's lockfile workflow pushed, or after 30 minutes.
 *
 * Auth: service-role only (requireServiceRoleAuth). Never callable by end users.
 */

import { Hono } from 'npm:hono@4'
import { getServiceClient } from '../_shared/db.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withSentry } from '../_shared/sentry.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { logDbFailure } from '../_shared/error-codes.ts'
import { resolveProjectGithubToken } from '../_shared/github.ts'
import {
  syncSdkReleaseJob,
  type SdkReleaseJob,
} from '../_shared/sdk-release-sync.ts'
import { syncAwaitingLockfileJobs } from '../_shared/sdk-upgrade-lockfile.ts'

const log = rootLog.child('sdk-release-sync')

const SYNC_STATUSES = ['pr_opened', 'ready_to_merge', 'blocked', 'merged', 'deploying']

export const app = new Hono()

app.get('/sdk-release-sync/health', (c) => c.json({ ok: true }))

app.post('/sdk-release-sync', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const db = getServiceClient()

  const awaiting = await syncAwaitingLockfileJobs(db)

  const { data: jobs, error } = await db
    .from('sdk_upgrade_jobs')
    .select('id, project_id, pr_url, pr_state, release_status, merged_at, commit_sha')
    // Jobs that opened a PR before the runner stamped release_status (NULL)
    // are picked up too, so a PR merged on GitHub stops reading as open.
    .or(`release_status.in.(${SYNC_STATUSES.join(',')}),and(release_status.is.null,status.eq.completed)`)
    .not('pr_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    const transient = logDbFailure(log, 'failed to load jobs', error, { err: error.message })
    return c.json({ ok: false, error: error.message }, transient ? 503 : 500)
  }

  type SyncJob = SdkReleaseJob & { project_id: string }

  const results: Array<{ jobId: string; releaseStatus: string; error?: string }> = []

  for (const rawJob of (jobs ?? []) as unknown as SyncJob[]) {
    try {
      const token = await resolveProjectGithubToken(db, rawJob.project_id)
      if (!token) {
        results.push({ jobId: rawJob.id, releaseStatus: rawJob.release_status ?? 'pr_opened', error: 'no_token' })
        continue
      }

      // Checks follow the live head, so a later commit cannot keep the bump
      // commit's red result. A failed GitHub read (403 rate limit, 5xx,
      // timeout) stores nothing: the job keeps its last known CI state.
      const result = await syncSdkReleaseJob(db, token, rawJob)
      if (!result.ok) {
        if (result.code === 'GITHUB_UNAVAILABLE') {
          log.warn('sync skipped', { jobId: rawJob.id, code: 'GITHUB_UNAVAILABLE', err: result.message })
        } else if (result.code === 'SYNC_PERSIST_FAILED') {
          log.error('failed to persist sync', { jobId: rawJob.id, err: result.message })
        }
        results.push({ jobId: rawJob.id, releaseStatus: rawJob.release_status ?? 'pr_opened', error: result.message })
        continue
      }
      const { releaseStatus, prState } = result

      results.push({ jobId: rawJob.id, releaseStatus })
      log.info('synced job', { jobId: rawJob.id, releaseStatus, prState })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('error syncing job', { jobId: rawJob.id, err: msg })
      results.push({ jobId: rawJob.id, releaseStatus: rawJob.release_status ?? 'pr_opened', error: msg })
    }
  }

  log.info('sync complete', { synced: results.length, awaiting: awaiting.length })
  return c.json({ ok: true, data: { synced: results.length, results, awaiting } })
})

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(withSentry('sdk-release-sync', app.fetch))
}
