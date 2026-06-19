/**
 * FILE: packages/server/supabase/functions/api/routes/sdk-upgrade.ts
 * PURPOSE: One-click "Create Upgrade PR" for @mushi-mushi/* SDK packages.
 *
 * POST /v1/admin/projects/:pid/sdk-upgrade
 *   Enqueues a new sdk_upgrade_jobs row and fire-and-forgets the
 *   sdk-upgrade-worker. Gated on GitHub being connected (github_repo_url +
 *   resolvable token) — NOT on autofix_enabled (separate capability).
 *   In-flight dedupe: at most one queued/running job per project (DB unique index).
 *   Open-PR reuse: POST returns 200 { reused: true } when mushi/sdk-upgrade* is
 *   already open unless body.refresh / body.force is set.
 *
 * GET /v1/admin/projects/:pid/sdk-upgrade/:id
 *   Poll current job status.
 *
 * GET /v1/admin/projects/:pid/sdk-upgrade/:id/stream
 *   SSE stream — same polling pattern as fix-dispatch so the UI hook
 *   (`useSdkUpgrade`) can be a thin wrapper around the same SSE client.
 *
 * DELETE /v1/admin/projects/:pid/sdk-upgrade/:id
 *   Cancel a queued or running job (CAS guard).
 */

import type { Hono } from 'npm:hono@4'
import { streamSSE } from 'npm:hono@4/streaming'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { toSseEvent, sanitizeSseString, sseHeartbeat } from '../../_shared/sse.ts'
import { dbError, userCanAccessProject } from '../shared.ts'
import { runSdkUpgradeJob } from '../../_shared/sdk-upgrade-runner.ts'
import { log } from '../../_shared/logger.ts'
import { findOpenPrByHeadPrefix } from '../../_shared/github-pr.ts'
import {
  evaluateSdkUpgradePostGate,
  type SdkUpgradePostBody,
  UPGRADE_BRANCH_PREFIX,
} from '../../_shared/sdk-upgrade-gates.ts'
import { parseGithubRepoUrl } from '../../_shared/github.ts'
import { mergeGithubPullRequest, type MergeMethod } from '../../_shared/fix-merge.ts'
import {
  resolveProjectGithubToken,
  type GithubRepoRef,
  fetchPullRequestDetails,
  fetchLatestCheckRun,
  fetchLatestWorkflowRunForSha,
  fetchLatestDeploymentStatusForSha,
  normalizeDeployStatus,
} from '../../_shared/github.ts'

function scheduleSdkUpgradeRun(jobId: string): void {
  const run = runSdkUpgradeJob(jobId).catch((err) => {
    log.warn('inline runner failed', { scope: 'sdk-upgrade', jobId, err: String(err) })
  })
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime
  if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
    edgeRuntime.waitUntil(run)
  }
}

export function registerSdkUpgradeRoutes(app: Hono<{ Variables: Variables }>): void {
  // -------------------------------------------------------------------------
  // POST — enqueue an upgrade job
  // -------------------------------------------------------------------------
  app.post('/v1/admin/projects/:pid/sdk-upgrade', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const db = getServiceClient()

    const body = await c.req.json().catch(() => ({} as SdkUpgradePostBody)) as SdkUpgradePostBody

    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
    }

    // Gate: GitHub must be connected (repo URL + token ref set).
    const { data: settings, error: settingsErr } = await db
      .from('project_settings')
      .select('github_repo_url, github_installation_token_ref')
      .eq('project_id', projectId)
      .maybeSingle()
    if (settingsErr) return dbError(c, settingsErr)

    // In-flight dedupe: one active job per project (DB unique index is the backstop).
    const { data: existing } = await db
      .from('sdk_upgrade_jobs')
      .select('id, status')
      .eq('project_id', projectId)
      .in('status', ['queued', 'running'])
      .limit(1)

    // Open-PR reuse guard — skip when operator explicitly asked to refresh.
    let openPr = null
    const token = await resolveProjectGithubToken(db, projectId)
    const repoRef = parseGithubRepoUrl(settings?.github_repo_url ?? null)
    if (token && repoRef) {
      openPr = await findOpenPrByHeadPrefix(token, repoRef.owner, repoRef.repo, UPGRADE_BRANCH_PREFIX)
    }

    const decision = evaluateSdkUpgradePostGate(
      settings ?? null,
      existing ?? [],
      openPr,
      body,
    )

    if (decision.action === 'reject') {
      if (decision.code === 'ALREADY_IN_PROGRESS' && decision.jobId) {
        void scheduleSdkUpgradeRun(decision.jobId)
      }
      return c.json({
        ok: false,
        error: {
          code: decision.code,
          message: decision.message,
          ...(decision.jobId ? { jobId: decision.jobId } : {}),
        },
      }, decision.status as 400 | 409)
    }

    if (decision.action === 'reuse') {
      // Surface the most recent job tied to this PR when available (cockpit resume).
      const { data: priorJob } = await db
        .from('sdk_upgrade_jobs')
        .select('id, status, pr_url, plan, release_status, pr_state, check_run_conclusion, deploy_status, deploy_url')
        .eq('project_id', projectId)
        .eq('pr_url', decision.prUrl)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      return c.json({
        ok: true,
        data: {
          reused: true,
          prUrl: decision.prUrl,
          prNumber: decision.prNumber,
          branch: decision.branch,
          jobId: priorJob?.id ?? null,
          message: decision.message,
          priorJob: priorJob ?? null,
        },
      })
    }

    const { data: job, error: insertErr } = await db
      .from('sdk_upgrade_jobs')
      .insert({ project_id: projectId, requested_by: userId, status: 'queued' })
      .select('id, status, created_at')
      .single()

    if (insertErr || !job) {
      // Unique partial index race — another request won the active slot.
      if (insertErr?.code === '23505') {
        const { data: raced } = await db
          .from('sdk_upgrade_jobs')
          .select('id, status')
          .eq('project_id', projectId)
          .in('status', ['queued', 'running'])
          .limit(1)
          .maybeSingle()
        if (raced?.id) {
          void scheduleSdkUpgradeRun(raced.id)
          return c.json({
            ok: false,
            error: {
              code: 'ALREADY_IN_PROGRESS',
              message: 'An SDK upgrade is already in progress for this project.',
              jobId: raced.id,
            },
          }, 409)
        }
      }
      return c.json({ ok: false, error: { code: 'INSERT_FAILED', message: insertErr?.message ?? 'Could not enqueue' } }, 500)
    }

    // Run inline in the same isolate (reliable vs edge-to-edge HTTP invoke).
    scheduleSdkUpgradeRun(job.id)

    return c.json({ ok: true, data: { jobId: job.id, status: job.status, createdAt: job.created_at } })
  })

  // -------------------------------------------------------------------------
  // GET — in-flight job for resume-on-mount (Connect page)
  // -------------------------------------------------------------------------
  app.get('/v1/admin/projects/:pid/sdk-upgrade/in-flight', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const db = getServiceClient()

    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

    const { data: active } = await db
      .from('sdk_upgrade_jobs')
      .select('id, status, pr_url, plan, error, created_at, pr_state, release_status, check_run_status, check_run_conclusion, deploy_status, deploy_url, merged_at')
      .eq('project_id', projectId)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (active?.status === 'queued') {
      void scheduleSdkUpgradeRun(active.id)
    }

    if (active) {
      return c.json({ ok: true, data: active })
    }

    // No in-flight job — return the latest terminal job so reload/HMR still shows
    // "PR opened" / error state (Connect page resume-on-mount).
    const { data: recent } = await db
      .from('sdk_upgrade_jobs')
      .select('id, status, pr_url, plan, error, created_at, pr_state, release_status, check_run_status, check_run_conclusion, deploy_status, deploy_url, merged_at')
      .eq('project_id', projectId)
      .in('status', ['completed', 'completed_no_pr', 'failed', 'cancelled'])
      .gte('finished_at', new Date(Date.now() - 2 * 60 * 60_000).toISOString())
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return c.json({ ok: true, data: recent ?? null })
  })

  // -------------------------------------------------------------------------
  // GET — poll job status
  // -------------------------------------------------------------------------
  app.get('/v1/admin/projects/:pid/sdk-upgrade/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const jobId = c.req.param('id')!
    const db = getServiceClient()

    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

    const { data: job } = await db
      .from('sdk_upgrade_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('project_id', projectId)
      .single()
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

    return c.json({ ok: true, data: job })
  })

  // -------------------------------------------------------------------------
  // GET /stream — SSE status stream (mirrors fix-dispatch stream)
  // -------------------------------------------------------------------------
  app.get(
    '/v1/admin/projects/:pid/sdk-upgrade/:id/stream',
    adminOrApiKey({ scope: 'mcp:read' }),
    async (c) => {
      const userId = c.get('userId') as string
      const projectId = c.req.param('pid')!
      const jobId = c.req.param('id')!
      const db = getServiceClient()

      const access = await userCanAccessProject(db, userId, projectId)
      if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

      const { data: job } = await db
        .from('sdk_upgrade_jobs')
        .select('id, project_id, status, pr_url, plan, error')
        .eq('id', jobId)
        .eq('project_id', projectId)
        .single()
      if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

      // Ensure the runner is scheduled when the UI opens SSE on a queued job.
      if (job.status === 'queued') {
        scheduleSdkUpgradeRun(jobId)
      }

      return streamSSE(c, async (stream) => {
        const POLL_MS = 1_500
        const HEARTBEAT_MS = 15_000
        const MAX_MS = 10 * 60_000
        let elapsed = 0
        let lastStatus = ''

        while (elapsed < MAX_MS && !stream.aborted) {
          const { data: latest } = await db
            .from('sdk_upgrade_jobs')
            .select('status, pr_url, plan, error, started_at, finished_at')
            .eq('id', jobId)
            .single()

          if (!latest) {
            await stream.write(toSseEvent({ code: 'NOT_FOUND' }, { event: 'error' }))
            break
          }

          if (latest.status !== lastStatus) {
            lastStatus = latest.status
            const sanitizedError = latest.error
              ? sanitizeSseString(latest.error).slice(0, 500)
              : null
            await stream.write(
              toSseEvent(
                {
                  status: latest.status,
                  prUrl: latest.pr_url,
                  plan: latest.plan,
                  startedAt: latest.started_at,
                  finishedAt: latest.finished_at,
                  error: sanitizedError,
                },
                { event: 'status', id: `${jobId}:${Date.now()}` },
              ),
            )
          }

          if (['completed', 'completed_no_pr', 'failed', 'cancelled'].includes(latest.status)) {
            await stream.write(toSseEvent({ done: true }, { event: 'done' }))
            break
          }

          if (elapsed % HEARTBEAT_MS < POLL_MS) {
            await stream.write(sseHeartbeat())
          }

          await stream.sleep(POLL_MS)
          elapsed += POLL_MS
        }

        if (elapsed >= MAX_MS) {
          await stream.write(
            toSseEvent(
              { code: 'STREAM_TIMEOUT', message: 'Reconnect to keep watching' },
              { event: 'error' },
            ),
          )
        }
      }) as unknown as Promise<void>
    },
  )

  // -------------------------------------------------------------------------
  // DELETE — cancel a queued/running job
  // -------------------------------------------------------------------------
  app.delete('/v1/admin/projects/:pid/sdk-upgrade/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const jobId = c.req.param('id')!
    const db = getServiceClient()

    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

    const { data: job } = await db
      .from('sdk_upgrade_jobs')
      .select('id, status')
      .eq('id', jobId)
      .eq('project_id', projectId)
      .single()
    if (!job) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

    if (job.status !== 'queued' && job.status !== 'running') {
      return c.json({
        ok: false,
        error: { code: 'INVALID_STATE', message: `Job is already ${job.status}; cannot cancel.` },
      }, 409)
    }

    const { data: updated, error: updErr } = await db
      .from('sdk_upgrade_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString(), error: 'Cancelled by operator.' })
      .eq('id', jobId)
      .in('status', ['queued', 'running'])
      .select('id, status')
      .single()

    if (updErr || !updated) {
      return c.json({ ok: false, error: { code: 'INVALID_STATE', message: 'Job finished before cancel.' } }, 409)
    }

    return c.json({ ok: true, data: { id: updated.id, status: updated.status } })
  })

  // -------------------------------------------------------------------------
  // POST /:id/merge — merge the upgrade PR on GitHub and record the lifecycle
  // -------------------------------------------------------------------------
  app.post('/v1/admin/projects/:pid/sdk-upgrade/:id/merge', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const jobId = c.req.param('id')!
    const db = getServiceClient()

    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>))
    const mergeMethod: MergeMethod = (['squash', 'merge', 'rebase'].includes(body.method as string)
      ? (body.method as MergeMethod)
      : 'squash')

    const { data: rawJob, error: jobErr } = await db
      .from('sdk_upgrade_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (jobErr || !rawJob) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)

    // New release-cockpit columns added by migration 20260618124500
    const job = rawJob as Record<string, unknown> & typeof rawJob
    const prUrl = job.pr_url as string | null
    const prState = job['pr_state'] as string | null
    const commitSha = job.commit_sha as string | null

    if (!prUrl) return c.json({ ok: false, error: { code: 'NO_PR', message: 'This job has no PR to merge' } }, 400)
    if (prState === 'merged') {
      return c.json({ ok: true, alreadyMerged: true, sha: commitSha ?? null })
    }

    const token = await resolveProjectGithubToken(db, projectId)
    if (!token) return c.json({ ok: false, error: { code: 'GH_NOT_CONNECTED', message: 'GitHub is not connected for this project' } }, 422)

    // Parse PR URL: https://github.com/owner/repo/pull/123
    const prUrlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!prUrlMatch) return c.json({ ok: false, error: { code: 'INVALID_PR_URL', message: 'Could not parse PR URL' } }, 400)
    const [, owner, repo, prNumberStr] = prUrlMatch
    const prNumber = parseInt(prNumberStr, 10)
    const ref: GithubRepoRef = { owner, repo }

    await db.from('sdk_upgrade_jobs').update({ release_status: 'merging' }).eq('id', jobId)

    const result = await mergeGithubPullRequest(token, ref, prNumber, { mergeMethod })

    if (!result.merged) {
      await db.from('sdk_upgrade_jobs')
        .update({ release_status: 'pr_opened', merge_error: result.message ?? 'Merge failed' })
        .eq('id', jobId)
      return c.json({ ok: false, error: { code: 'MERGE_FAILED', message: result.message ?? 'Merge failed' } }, 422)
    }

    const now = new Date().toISOString()
    await db.from('sdk_upgrade_jobs')
      .update({
        pr_state: 'merged',
        merged_at: now,
        merge_method: mergeMethod,
        merge_error: null,
        release_status: 'merged',
        ...(result.sha ? { commit_sha: result.sha } : {}),
      })
      .eq('id', jobId)

    return c.json({ ok: true, alreadyMerged: result.alreadyMerged, sha: result.sha ?? null })
  })

  // -------------------------------------------------------------------------
  // POST /:id/sync — poll GitHub for PR/CI/deploy state and persist results
  // -------------------------------------------------------------------------
  app.post('/v1/admin/projects/:pid/sdk-upgrade/:id/sync', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const jobId = c.req.param('id')!
    const db = getServiceClient()

    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)

    const { data: rawJob, error: jobErr } = await db
      .from('sdk_upgrade_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (jobErr || !rawJob) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)

    // New release-cockpit columns added by migration 20260618124500
    const job = rawJob as Record<string, unknown> & typeof rawJob
    const prUrl = job.pr_url as string | null
    const existingPrState = job['pr_state'] as string | null
    const existingReleaseStatus = job['release_status'] as string | null
    const existingMergedAt = job['merged_at'] as string | null
    const existingCommitSha = job.commit_sha as string | null

    if (!prUrl) return c.json({ ok: false, error: { code: 'NO_PR', message: 'Nothing to sync (no PR)' } }, 400)

    const token = await resolveProjectGithubToken(db, projectId)
    if (!token) return c.json({ ok: false, error: { code: 'GH_NOT_CONNECTED', message: 'GitHub not connected' } }, 422)

    // Parse PR URL: https://github.com/owner/repo/pull/123
    const prUrlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!prUrlMatch) return c.json({ ok: false, error: { code: 'INVALID_PR_URL', message: 'Could not parse PR URL' } }, 400)
    const [, owner, repo, prNumberStr] = prUrlMatch
    const prNumber = parseInt(prNumberStr, 10)
    const ref: GithubRepoRef = { owner, repo }

    const pr = await fetchPullRequestDetails(token, ref, prNumber).catch(() => null)
    const prState = pr?.state ?? existingPrState ?? null
    const commitSha = pr?.headSha ?? existingCommitSha ?? null

    const [checks, workflow, deploy] = await Promise.all([
      commitSha ? fetchLatestCheckRun(token, ref, commitSha).catch(() => null) : Promise.resolve(null),
      commitSha ? fetchLatestWorkflowRunForSha(token, ref, pr?.baseRef ?? null, commitSha).catch(() => null) : Promise.resolve(null),
      commitSha ? fetchLatestDeploymentStatusForSha(token, ref, commitSha).catch(() => null) : Promise.resolve(null),
    ])

    // A PR merged directly on GitHub reports state='closed' + merged=true — the
    // `merged` flag is authoritative (GitHub never returns state='merged').
    const isMerged = pr?.merged === true || prState === 'merged' || Boolean(existingMergedAt)
    const deployState = deploy ? normalizeDeployStatus(deploy.state) : null

    // Derive release_status from authoritative GitHub facts
    let releaseStatus: string = existingReleaseStatus ?? 'pr_opened'
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
    // failure never wipes last-known deploy state back to 'unknown'.
    const { error: updErr } = await db.from('sdk_upgrade_jobs').update({
      pr_state: isMerged ? 'merged' : prState,
      check_run_status: checks?.status ?? null,
      check_run_conclusion: checks?.conclusion ?? null,
      check_run_updated_at: now,
      release_status: releaseStatus,
      ...(isMerged && !existingMergedAt ? { merged_at: now } : {}),
      ...(deploy
        ? {
            deploy_status: deployState,
            deploy_url: deploy.environmentUrl ?? null,
            deploy_environment: deploy.environment ?? null,
            deploy_updated_at: now,
          }
        : {}),
      ...(commitSha && commitSha !== existingCommitSha ? { commit_sha: commitSha } : {}),
    }).eq('id', jobId)
    if (updErr) {
      return c.json({ ok: false, error: { code: 'SYNC_PERSIST_FAILED', message: updErr.message } }, 500)
    }

    return c.json({
      ok: true,
      data: {
        jobId,
        releaseStatus,
        prState: isMerged ? 'merged' : prState,
        prMergeable: pr?.mergeable ?? null,
        prMergeableState: pr?.mergeableState ?? null,
        checkRunStatus: checks?.status ?? null,
        checkRunConclusion: checks?.conclusion ?? null,
        workflowStatus: workflow?.status ?? null,
        workflowConclusion: workflow?.conclusion ?? null,
        workflowUrl: workflow?.htmlUrl ?? null,
        deployStatus: deployState,
        deployUrl: deploy?.environmentUrl ?? null,
        deployEnvironment: deploy?.environment ?? null,
      },
    })
  })
}
