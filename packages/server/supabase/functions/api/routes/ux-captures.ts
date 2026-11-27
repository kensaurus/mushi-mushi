/**
 * FILE: packages/server/supabase/functions/api/routes/ux-captures.ts
 * PURPOSE: UX captures from any driver (ADR 0073, Plan 025 P2), served by
 *          `api-ext` (`api` forwards the path).
 *
 *   POST /v1/ux/captures — open a scorecard run for pages another driver
 *                          captured (a Maestro flow, adb, the iOS simulator,
 *                          an SDK's debug screenshot, a browser), reserve its
 *                          scoring budget, and hand back one signed upload URL
 *                          per screenshot. The caller PUTs the PNGs, then
 *                          scores each page through the scorecard's own
 *                          routes (…/ux-scorecard/:runId/score, /group), so
 *                          the rubric and judge apply unchanged.
 *
 * Auth: an mcp:write key or a console session, like the CLI's other UX
 * routes. Never the public SDK key (report:write): it ships inside app
 * bundles, and anyone holding it could fill the app's storage and spend its
 * AI budget. The app is the key's own, else `projectId` / X-Mushi-Project-Id;
 * the caller must be a non-viewer member of it.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { UX_CAPTURES_BUCKET } from '../../_shared/ux-runs.ts'
import { toPublicSupabaseUrl } from '../../_shared/public-url.ts'
import { newLocalRunId } from '../../_shared/fresh-eyes-queue.ts'
import { releaseRunBudget, reserveRunBudget, scorecardReserveUsd } from '../../_shared/llm-reservations.ts'
import { capturesPlan, capturesRunRow, capturesViewport, UX_CAPTURE_MAX_PNG_BYTES, UxCapturesBody } from '../../_shared/ux-captures.ts'
import { callerCanAccessProject, dbError, jsonError } from '../shared.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerUxCaptureRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/ux/captures', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const parsed = UxCapturesBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    const body = parsed.data

    // The app: the key's own, else the one named. A named app that is not the key's is refused.
    const bound = c.get('authMethod') === 'apiKey' ? ((c.get('projectId') as string | undefined) ?? null) : null
    const named = body.projectId ?? c.req.header('x-mushi-project-id') ?? c.req.header('x-mushi-project') ?? null
    if (named && !UUID_RE.test(named)) return jsonError(c, 'VALIDATION_ERROR', 'projectId must be a UUID.')
    if (bound && named && bound.toLowerCase() !== named.toLowerCase()) return jsonError(c, 'FORBIDDEN', 'This key belongs to another app.', 403)
    const projectId = (bound ?? named)?.toLowerCase() ?? null
    if (!projectId) return jsonError(c, 'VALIDATION_ERROR', 'Name the app: projectId in the body, or the X-Mushi-Project-Id header.')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot upload UX captures.', 403)

    const viewport = capturesViewport(body)
    if (!viewport) return jsonError(c, 'VALIDATION_ERROR', 'viewport must look like 390x844 (320–3840 wide, 320–2400 high).')
    const now = new Date()

    // A retry names its run; it must be a captures run of this app.
    let runRowId: string
    let localRunId: string
    let created = false
    if (body.runId) {
      const { data: prior, error } = await db.from('ux_runs').select('id, kind, status').eq('project_id', projectId).eq('local_run_id', body.runId).maybeSingle()
      if (error) return dbError(c, error)
      if (!prior || (prior as { kind: string }).kind !== 'scorecard') return jsonError(c, 'NOT_FOUND', 'No scorecard run with that id in this app.', 404)
      if ((prior as { status: string }).status !== 'running') return jsonError(c, 'RUN_ENDED', 'That run has ended. Upload to a new run.', 409)
      runRowId = (prior as { id: string }).id
      localRunId = body.runId
    } else {
      runRowId = crypto.randomUUID()
      localRunId = newLocalRunId(now, crypto.getRandomValues(new Uint8Array(4)))
      created = true
    }

    const plan = capturesPlan(body, { projectId, runRowId, now })
    if (!plan.ok) return jsonError(c, 'VALIDATION_ERROR', plan.message)

    // Scoring is reserved before the run exists (ADR 0073): one call a page plus the grouping, capped by maxCostUsd.
    let reservedUsd: number | null = null
    if (created) {
      const held = await reserveRunBudget(db, { projectId, uxRunId: runRowId, kind: 'scorecard', usd: scorecardReserveUsd(body.pages.length, body.maxCostUsd), createdBy: userId, now })
      if (!held.ok) return jsonError(c, held.code, held.message, held.status)
      reservedUsd = held.reservedUsd
      const { error } = await db.from('ux_runs').insert({ id: runRowId, ...capturesRunRow(body, { projectId, localRunId, userId, viewport, now }) })
      if (error) {
        await releaseRunBudget(db, runRowId)
        return dbError(c, error)
      }
    }
    // A run this request opened and could not finish setting up is ended at once and gives its
    // budget back, so nothing sits "running" holding budget for 12 hours.
    const abandon = async (code: string, message: string, status: 500 | 502) => {
      if (created) {
        await releaseRunBudget(db, runRowId)
        const at = new Date().toISOString()
        await db.from('ux_runs').update({ status: 'failed', error: message, finished_at: at, updated_at: at }).eq('id', runRowId)
        return c.json({ ok: false, error: { code, message: `${message} Start a new upload.` } }, status)
      }
      return c.json({ ok: false, error: { code, message: `${message} Retry with runId ${localRunId}.` }, data: { runId: localRunId } }, status)
    }
    const { error: sErr } = await db.from('ux_surfaces').upsert(plan.surfaces, { onConflict: 'run_id,surface_key' })
    if (sErr) return abandon('DB_ERROR', 'The pages could not be saved.', 500)

    const uploads: Array<{ page: string; name: string; signedUrl: string }> = []
    for (const u of plan.uploads) {
      const { data, error } = await db.storage.from(UX_CAPTURES_BUCKET).createSignedUploadUrl(u.path, { upsert: true })
      if (error || !data) return abandon('UPSTREAM_ERROR', 'Could not mint an upload URL.', 502)
      uploads.push({ page: u.page, name: u.name, signedUrl: toPublicSupabaseUrl(data.signedUrl) })
    }
    if (created) {
      await logAudit(db, projectId, userId, 'ux_captures.uploaded', 'ux_run', localRunId, { platform: body.platform, device: body.device ?? null, source: body.source ?? null, pages: body.pages.length, reserved_usd: reservedUsd }, { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' })
    }
    return c.json(
      {
        ok: true,
        data: {
          runId: localRunId,
          projectId,
          platform: body.platform,
          reservedUsd,
          maxPngBytes: UX_CAPTURE_MAX_PNG_BYTES,
          uploads,
          next: {
            score: `/v1/admin/projects/${projectId}/ux-scorecard/${localRunId}/score`,
            group: `/v1/admin/projects/${projectId}/ux-scorecard/${localRunId}/group`,
            finish: `/v1/admin/projects/${projectId}/ux-scorecard/${localRunId}`,
            console: `/ux-runs?view=scorecard&run=${localRunId}`,
          },
        },
      },
      created ? 201 : 200,
    )
  })
}
