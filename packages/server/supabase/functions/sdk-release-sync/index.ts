/**
 * FILE: packages/server/supabase/functions/sdk-release-sync/index.ts
 * PURPOSE: Periodic CI/deploy status sync for active SDK upgrade jobs.
 *
 * Called by pg_cron every 5 minutes. Finds jobs in `pr_opened | ready_to_merge |
 * blocked | merged | deploying` states, polls GitHub for current check-run +
 * deployment status, and upserts results into sdk_upgrade_jobs.
 *
 * Auth: service-role only (requireServiceRoleAuth). Never callable by end users.
 */

import { Hono } from 'npm:hono@4'
import { getServiceClient } from '../_shared/db.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withSentry } from '../_shared/sentry.ts'
import { log as rootLog } from '../_shared/logger.ts'
import {
  resolveProjectGithubToken,
  type GithubRepoRef,
  fetchPullRequestDetails,
  fetchLatestCheckRun,
  fetchLatestDeploymentStatusForSha,
  normalizeDeployStatus,
} from '../_shared/github.ts'

const log = rootLog.child('sdk-release-sync')

const SYNC_STATUSES = ['pr_opened', 'ready_to_merge', 'blocked', 'merged', 'deploying']

const app = new Hono()

app.get('/sdk-release-sync/health', (c) => c.json({ ok: true }))

app.post('/sdk-release-sync', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const db = getServiceClient()

  const { data: jobs, error } = await db
    .from('sdk_upgrade_jobs')
    .select('id, project_id, pr_url, pr_state, release_status, merged_at, commit_sha')
    .in('release_status', SYNC_STATUSES)
    .not('pr_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    log.error('failed to load jobs', { err: error.message })
    return c.json({ ok: false, error: error.message }, 500)
  }

  type SyncJob = {
    id: string
    project_id: string
    pr_url: string | null
    pr_state: string | null
    release_status: string | null
    merged_at: string | null
    commit_sha: string | null
  }

  const results: Array<{ jobId: string; releaseStatus: string; error?: string }> = []

  for (const rawJob of (jobs ?? []) as unknown as SyncJob[]) {
    try {
      const token = await resolveProjectGithubToken(db, rawJob.project_id)
      if (!token) {
        results.push({ jobId: rawJob.id, releaseStatus: rawJob.release_status ?? 'pr_opened', error: 'no_token' })
        continue
      }

      // Parse PR URL: https://github.com/owner/repo/pull/123
      const prUrlMatch = (rawJob.pr_url as string).match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
      if (!prUrlMatch) {
        results.push({ jobId: rawJob.id, releaseStatus: rawJob.release_status ?? 'pr_opened', error: 'invalid_pr_url' })
        continue
      }
      const [, owner, repo, prNumberStr] = prUrlMatch
      const prNumber = parseInt(prNumberStr, 10)
      const ref: GithubRepoRef = { owner, repo }

      const [pr, checks, deploy] = await Promise.all([
        fetchPullRequestDetails(token, ref, prNumber).catch(() => null),
        rawJob.commit_sha
          ? fetchLatestCheckRun(token, ref, rawJob.commit_sha).catch(() => null)
          : Promise.resolve(null),
        rawJob.commit_sha
          ? fetchLatestDeploymentStatusForSha(token, ref, rawJob.commit_sha).catch(() => null)
          : Promise.resolve(null),
      ])

      const prState = pr?.state ?? rawJob.pr_state
      const commitSha = pr?.headSha ?? rawJob.commit_sha
      // A PR merged directly on GitHub reports state='closed' + merged=true — the
      // `merged` flag is authoritative (GitHub never returns state='merged').
      const isMerged = pr?.merged === true || prState === 'merged' || Boolean(rawJob.merged_at)
      const deployState = deploy ? normalizeDeployStatus(deploy.state) : null

      // Derive release_status from authoritative GitHub facts
      let releaseStatus: string = rawJob.release_status ?? 'pr_opened'
      if (isMerged) {
        if (deployState === 'success') releaseStatus = 'deployed'
        else if (deployState === 'failure') releaseStatus = 'failed'
        else if (checks?.conclusion === 'success') releaseStatus = 'deploying'
        else releaseStatus = 'merged'
      } else if (prState === 'closed') {
        releaseStatus = 'failed'
      } else if (prState === 'open') {
        if (checks?.conclusion === 'failure') releaseStatus = 'blocked'
        else if (pr?.mergeable === true && pr?.mergeableState === 'clean' && checks?.conclusion === 'success') {
          releaseStatus = 'ready_to_merge'
        } else {
          releaseStatus = 'pr_opened'
        }
      }

      const now = new Date().toISOString()
      // Persist only the columns whose GitHub fetch succeeded so a transient
      // 403/timeout never wipes last-known deploy state back to 'unknown'.
      const { error: updErr } = await db.from('sdk_upgrade_jobs').update({
        pr_state: isMerged ? 'merged' : prState,
        check_run_status: checks?.status ?? null,
        check_run_conclusion: checks?.conclusion ?? null,
        check_run_updated_at: now,
        release_status: releaseStatus,
        ...(isMerged && !rawJob.merged_at ? { merged_at: now } : {}),
        ...(deploy
          ? {
              deploy_status: deployState,
              deploy_url: deploy.environmentUrl ?? null,
              deploy_environment: deploy.environment ?? null,
              deploy_updated_at: now,
            }
          : {}),
        ...(commitSha && commitSha !== rawJob.commit_sha ? { commit_sha: commitSha } : {}),
      }).eq('id', rawJob.id)

      if (updErr) {
        log.error('failed to persist sync', { jobId: rawJob.id, err: updErr.message })
        results.push({ jobId: rawJob.id, releaseStatus: rawJob.release_status ?? 'pr_opened', error: updErr.message })
        continue
      }

      results.push({ jobId: rawJob.id, releaseStatus })
      log.info('synced job', { jobId: rawJob.id, releaseStatus, prState, isMerged })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('error syncing job', { jobId: rawJob.id, err: msg })
      results.push({ jobId: rawJob.id, releaseStatus: rawJob.release_status ?? 'pr_opened', error: msg })
    }
  }

  log.info('sync complete', { synced: results.length })
  return c.json({ ok: true, data: { synced: results.length, results } })
})

Deno.serve(withSentry('sdk-release-sync', app.fetch))
