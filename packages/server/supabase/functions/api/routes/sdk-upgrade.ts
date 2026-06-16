/**
 * FILE: packages/server/supabase/functions/api/routes/sdk-upgrade.ts
 * PURPOSE: One-click "Create Upgrade PR" for @mushi-mushi/* SDK packages.
 *
 * POST /v1/admin/projects/:pid/sdk-upgrade
 *   Enqueues a new sdk_upgrade_jobs row and fire-and-forgets the
 *   sdk-upgrade-worker. Gated on GitHub being connected (github_repo_url +
 *   resolvable token) — NOT on autofix_enabled (separate capability).
 *   In-flight dedupe: at most one queued/running job per project.
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

    if (!settings?.github_repo_url) {
      return c.json({
        ok: false,
        error: {
          code: 'GITHUB_NOT_CONNECTED',
          message: 'Connect a GitHub repository in Settings → Integrations first.',
        },
      }, 400)
    }
    if (!settings.github_installation_token_ref) {
      return c.json({
        ok: false,
        error: {
          code: 'GITHUB_TOKEN_MISSING',
          message: 'No GitHub token configured for this project. Add one in Settings → Integrations.',
        },
      }, 400)
    }

    // In-flight dedupe: one active job per project.
    const { data: existing } = await db
      .from('sdk_upgrade_jobs')
      .select('id, status')
      .eq('project_id', projectId)
      .in('status', ['queued', 'running'])
      .limit(1)
    if (existing?.length) {
      const staleJob = existing[0]
      // Re-kick the worker if a prior invoke was lost (fire-and-forget timeout).
      void scheduleSdkUpgradeRun(staleJob.id)
      return c.json({
        ok: false,
        error: {
          code: 'ALREADY_IN_PROGRESS',
          message: 'An SDK upgrade is already in progress for this project.',
          jobId: staleJob.id,
        },
      }, 409)
    }

    const { data: job, error: insertErr } = await db
      .from('sdk_upgrade_jobs')
      .insert({ project_id: projectId, requested_by: userId, status: 'queued' })
      .select('id, status, created_at')
      .single()
    if (insertErr || !job) {
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
      .select('id, status, pr_url, plan, error, created_at')
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
      .select('id, status, pr_url, plan, error, created_at')
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
}
