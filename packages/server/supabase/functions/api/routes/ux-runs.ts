/**
 * FILE: packages/server/supabase/functions/api/routes/ux-runs.ts
 * PURPOSE: Console mirror of local `mushi-ux` runs (Plan 021 Phase 2, ADR 0020).
 *
 * PUT  /v1/admin/projects/:pid/ux-runs/:localRunId           — CLI: upsert a run snapshot (idempotent)
 * POST /v1/admin/projects/:pid/ux-runs/:localRunId/uploads   — CLI: signed upload URLs for screenshots
 * GET  /v1/admin/projects/:pid/ux-runs                        — list runs
 * GET  /v1/admin/projects/:pid/ux-runs/:localRunId           — one run, its screens (signed image URLs) and attempts
 * POST /v1/admin/projects/:pid/ux-runs/:localRunId/surfaces/:key/report — "File as bug"
 *
 * The CLI authenticates with a project API key (mcp:write); the console with
 * its JWT. Every route checks the caller can access the project. Writes go
 * through the service client because members only have SELECT under RLS.
 */

import type { Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { callerCanAccessProject, dbError, jsonError } from '../shared.ts'
import {
  buildUxLoopReport,
  countStatuses,
  uxCapturePath,
  uxShotPaths,
  UX_CAPTURES_BUCKET,
  type UxSurfaceForReport,
} from '../../_shared/ux-runs.ts'

const RUN_ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/
const SURFACE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,79}$/
const READ_URL_TTL_SEC = 3600

const Probe = z
  .object({
    axe: z
      .array(z.object({ id: z.string().max(80), impact: z.string().max(20).nullable(), help: z.string().max(300), count: z.number().int().min(0) }))
      .max(60),
    overflowX: z.boolean(),
    smallTargets: z.number().int().min(0),
    consoleErrors: z.number().int().min(0),
    cls: z.number().min(0),
  })
  .nullable()

const Judge = z
  .array(
    z.object({
      viewport: z.string().max(20),
      model: z.string().max(120),
      preferred: z.enum(['before', 'after', 'tie']),
      confidence: z.enum(['low', 'medium', 'high']),
      summary: z.string().max(2000),
      worse: z.array(z.object({ what: z.string().max(500), why: z.string().max(500) })).max(20).optional(),
      better: z.array(z.object({ what: z.string().max(500), why: z.string().max(500) })).max(20).optional(),
      error: z.string().max(500).optional(),
    }),
  )
  .max(4)
  .nullable()

const Snapshot = z.object({
  // 'cloud' = the run executed on the host's CI (Plan 021 Phase 4), not on a laptop.
  mode: z.enum(['local', 'cloud']).default('local'),
  status: z.enum(['running', 'done', 'failed', 'stopped']),
  agent: z.string().min(1).max(40),
  skill: z.string().max(120).nullable().default(null),
  base_ref: z.string().max(200).nullable().default(null),
  phase: z.enum(['starting', 'worktree', 'install', 'dev-server', 'mapping', 'working', 'reviewing', 'done', 'failed']).nullable().default(null),
  phase_detail: z.string().max(300).nullable().default(null),
  current_surface: z.string().regex(SURFACE_KEY_RE).nullable().default(null),
  current_attempt: z.number().int().min(1).max(20).nullable().default(null),
  // What the agent is doing now; a running mushi-ux refreshes it every 30 s.
  current_progress: z
    .object({
      steps: z.number().int().min(0).max(100_000),
      last_step: z.string().max(300).nullable(),
      files: z.array(z.string().max(300)).max(20),
      started_at: z.string().datetime(),
      timeout_ms: z.number().int().min(0).max(4 * 3_600_000).nullable(),
    })
    .nullable()
    .default(null),
  error: z.string().max(1000).nullable().default(null),
  model: z.string().max(120).nullable(),
  judge_model: z.string().max(120).nullable(),
  branch: z.string().max(200).nullable(),
  base_sha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
  cli_version: z.string().max(40).nullable(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable(),
  surfaces: z
    .array(
      z.object({
        surface_key: z.string().regex(SURFACE_KEY_RE),
        kind: z.enum(['page', 'tab', 'dialog', 'menu']),
        path: z.string().startsWith('/').max(500),
        label: z.string().max(300),
        status: z.enum(['pending', 'baseline', 'iterating', 'accepted', 'reverted', 'skipped', 'regressed', 'blocked']),
        note: z.string().max(1000).nullable(),
        penalty_before: z.number().int().nullable(),
        penalty_after: z.number().int().nullable(),
        probe_before: Probe,
        probe_after: Probe,
        judge: Judge,
        thumbs: z
          .object({ before: z.string().nullable(), after: z.string().nullable(), diff: z.string().nullable() })
          .partial()
          .optional(),
        shots: z.record(z.string().max(200)).optional(),
        // Small-steps mode: the screen's plan, one entry per step.
        plan: z
          .array(
            z.object({
              text: z.string().max(300),
              status: z.enum(['pending', 'done', 'skipped', 'failed']),
              attempt: z.number().int().min(1).max(20).nullable().optional(),
            }),
          )
          .max(8)
          .nullable()
          .optional(),
        iterations: z
          .array(
            z.object({
              n: z.number().int().min(1).max(20),
              agent: z.string().min(1).max(40),
              model: z.string().max(120).nullable(),
              duration_ms: z.number().int().min(0).nullable(),
              outcome: z.enum(['accepted', 'rejected', 'agent_failed', 'capture_failed', 'no_change']),
              reason: z.string().max(1000).nullable(),
              commit_sha: z.string().regex(/^[0-9a-f]{7,40}$/).nullable(),
              pixel_diff: z.record(z.number()).default({}),
              penalty_after: z.number().int().nullable().optional(),
              // What the agent did, one readable step per line ("[edit] app/page.tsx").
              steps: z.string().max(2000).nullable().optional(),
              // Small-steps mode: the plan step this attempt made.
              step: z.string().max(300).nullable().optional(),
              shots: z.record(z.string().max(200)).optional(),
            }),
          )
          .max(20),
      }),
    )
    .max(300),
})

export function registerUxRunsRoutes(app: Hono<{ Variables: Variables }>): void {
  // ── PUT snapshot (CLI) ────────────────────────────────────────────────────
  app.put('/v1/admin/projects/:pid/ux-runs/:runId', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    if (!RUN_ID_RE.test(localRunId)) return jsonError(c, 'VALIDATION_ERROR', 'Malformed run id.')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot sync UX runs.', 403)

    const parsed = Snapshot.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid run snapshot')
    const snap = parsed.data
    const nowIso = new Date().toISOString()

    const { data: run, error: runErr } = await db
      .from('ux_runs')
      .upsert(
        {
          project_id: projectId,
          created_by: userId,
          local_run_id: localRunId,
          mode: snap.mode,
          status: snap.status,
          agent: snap.agent,
          model: snap.model,
          judge_model: snap.judge_model,
          skill: snap.skill,
          base_ref: snap.base_ref,
          phase: snap.phase,
          phase_detail: snap.phase_detail,
          current_surface: snap.current_surface,
          current_attempt: snap.current_attempt,
          current_progress: snap.current_progress,
          error: snap.error,
          branch: snap.branch,
          base_sha: snap.base_sha,
          cli_version: snap.cli_version,
          counts: countStatuses(snap.surfaces.map((s) => s.status)),
          started_at: snap.started_at,
          finished_at: snap.finished_at,
          updated_at: nowIso,
        },
        { onConflict: 'project_id,local_run_id' },
      )
      .select('id')
      .single()
    if (runErr || !run) return dbError(c, runErr)
    const runId = (run as { id: string }).id

    const thumb = (name: string | null | undefined) => {
      if (!name) return null
      return uxCapturePath(projectId, runId, name)
    }
    if (snap.surfaces.length > 0) {
      const { data: rows, error: surfErr } = await db
        .from('ux_surfaces')
        .upsert(
          snap.surfaces.map((s) => ({
            run_id: runId,
            project_id: projectId,
            surface_key: s.surface_key,
            kind: s.kind,
            path: s.path,
            label: s.label,
            status: s.status,
            note: s.note,
            penalty_before: s.penalty_before,
            penalty_after: s.penalty_after,
            probe_before: s.probe_before,
            probe_after: s.probe_after,
            judge: s.judge,
            thumb_before: thumb(s.thumbs?.before),
            thumb_after: thumb(s.thumbs?.after),
            thumb_diff: thumb(s.thumbs?.diff),
            thumbs: uxShotPaths(projectId, runId, s.surface_key, s.shots, 'surface'),
            plan: s.plan ?? null,
            updated_at: nowIso,
          })),
          { onConflict: 'run_id,surface_key' },
        )
        .select('id, surface_key')
      if (surfErr) return dbError(c, surfErr)
      const idByKey = new Map(((rows ?? []) as Array<{ id: string; surface_key: string }>).map((r) => [r.surface_key, r.id]))
      const iterations = snap.surfaces.flatMap((s) =>
        s.iterations.map((it) => ({
          run_id: runId,
          surface_id: idByKey.get(s.surface_key),
          project_id: projectId,
          n: it.n,
          agent: it.agent,
          model: it.model,
          duration_ms: it.duration_ms,
          outcome: it.outcome,
          reason: it.reason,
          commit_sha: it.commit_sha,
          pixel_diff: it.pixel_diff,
          penalty_after: it.penalty_after ?? null,
          steps: it.steps ?? null,
          step: it.step ?? null,
          thumbs: uxShotPaths(projectId, runId, s.surface_key, it.shots, 'iteration'),
        })),
      ).filter((it) => it.surface_id)
      if (iterations.length > 0) {
        const { error: itErr } = await db.from('ux_iterations').upsert(iterations, { onConflict: 'surface_id,n' })
        if (itErr) return dbError(c, itErr)
      }
    }
    return c.json({ ok: true, data: { id: runId, local_run_id: localRunId } })
  })

  // ── POST signed upload URLs (CLI) ─────────────────────────────────────────
  app.post('/v1/admin/projects/:pid/ux-runs/:runId/uploads', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot sync UX runs.', 403)
    const body = z.object({ names: z.array(z.string()).min(1).max(60) }).safeParse(await c.req.json().catch(() => null))
    if (!body.success) return jsonError(c, 'VALIDATION_ERROR', 'Send { names: ["<surface>/<before|after|diff>-<desktop|mobile>.png", …] }')

    const { data: run, error } = await db
      .from('ux_runs')
      .select('id')
      .eq('project_id', projectId)
      .eq('local_run_id', localRunId)
      .maybeSingle()
    if (error) return dbError(c, error)
    if (!run) return jsonError(c, 'NOT_FOUND', 'Sync the run (PUT) before uploading its screenshots.', 404)

    const uploads: Array<{ name: string; path: string; signedUrl: string; token: string }> = []
    for (const name of body.data.names) {
      const path = uxCapturePath(projectId, (run as { id: string }).id, name)
      if (!path) return jsonError(c, 'VALIDATION_ERROR', `Bad screenshot name "${name.slice(0, 120)}"`)
      const { data, error: signErr } = await db.storage.from(UX_CAPTURES_BUCKET).createSignedUploadUrl(path, { upsert: true })
      if (signErr || !data) return jsonError(c, 'UPSTREAM_ERROR', 'Could not mint an upload URL. Retry in a moment.', 502)
      uploads.push({ name, path, signedUrl: data.signedUrl, token: data.token })
    }
    return c.json({ ok: true, data: { bucket: UX_CAPTURES_BUCKET, uploads } })
  })

  // ── GET list ──────────────────────────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/ux-runs', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    const { data, error } = await db
      .from('ux_runs')
      .select('id, local_run_id, mode, status, agent, model, judge_model, skill, branch, counts, started_at, finished_at, updated_at')
      .eq('project_id', projectId)
      .order('started_at', { ascending: false })
      .limit(50)
    if (error) return dbError(c, error)
    return c.json({ ok: true, data: { runs: data ?? [] } })
  })

  // ── GET one run ───────────────────────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/ux-runs/:runId', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    const { data: run, error } = await db
      .from('ux_runs')
      .select('*')
      .eq('project_id', projectId)
      .eq('local_run_id', localRunId)
      .maybeSingle()
    if (error) return dbError(c, error)
    if (!run) return jsonError(c, 'NOT_FOUND', 'No such run', 404)
    const runRow = run as { id: string }
    const [{ data: surfaces, error: sErr }, { data: iterations, error: iErr }] = await Promise.all([
      db.from('ux_surfaces').select('*').eq('run_id', runRow.id).order('updated_at', { ascending: true }),
      db.from('ux_iterations').select('*').eq('run_id', runRow.id).order('n', { ascending: true }),
    ])
    if (sErr) return dbError(c, sErr)
    if (iErr) return dbError(c, iErr)

    const rows = (surfaces ?? []) as Array<Record<string, unknown>>
    const iterRows = (iterations ?? []) as Array<Record<string, unknown>>
    const mapOf = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
    const paths = [
      ...rows.flatMap((s) => [s.thumb_before, s.thumb_after, s.thumb_diff, ...Object.values(mapOf(s.thumbs))]),
      ...iterRows.flatMap((i) => Object.values(mapOf(i.thumbs))),
    ].filter((p): p is string => typeof p === 'string')
    const signed = new Map<string, string>()
    if (paths.length > 0) {
      const { data: urls } = await db.storage.from(UX_CAPTURES_BUCKET).createSignedUrls(paths, READ_URL_TTL_SEC)
      for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl)
    }
    const urlsOf = (v: unknown) =>
      Object.fromEntries(
        Object.entries(mapOf(v))
          .map(([slot, p]) => [slot, typeof p === 'string' ? (signed.get(p) ?? null) : null])
          .filter(([, u]) => u),
      )
    const withUrls = rows.map((s) => ({
      ...s,
      thumb_before_url: signed.get(s.thumb_before as string) ?? null,
      thumb_after_url: signed.get(s.thumb_after as string) ?? null,
      thumb_diff_url: signed.get(s.thumb_diff as string) ?? null,
      thumb_urls: urlsOf(s.thumbs),
    }))
    const itersWithUrls = iterRows.map((i) => ({ ...i, thumb_urls: urlsOf(i.thumbs) }))
    return c.json({ ok: true, data: { run, surfaces: withUrls, iterations: itersWithUrls } })
  })

  // ── POST File as bug ──────────────────────────────────────────────────────
  app.post('/v1/admin/projects/:pid/ux-runs/:runId/surfaces/:key/report', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    const key = c.req.param('key')!
    if (!SURFACE_KEY_RE.test(key)) return jsonError(c, 'VALIDATION_ERROR', 'Malformed screen key.')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot file reports.', 403)

    const { data: run, error: runErr } = await db
      .from('ux_runs')
      .select('id')
      .eq('project_id', projectId)
      .eq('local_run_id', localRunId)
      .maybeSingle()
    if (runErr) return dbError(c, runErr)
    if (!run) return jsonError(c, 'NOT_FOUND', 'No such run', 404)
    const runId = (run as { id: string }).id
    const { data: surface, error: sErr } = await db
      .from('ux_surfaces')
      .select('id, surface_key, kind, path, label, status, note, penalty_before, penalty_after, probe_before, probe_after, judge, report_id')
      .eq('run_id', runId)
      .eq('surface_key', key)
      .maybeSingle()
    if (sErr) return dbError(c, sErr)
    if (!surface) return jsonError(c, 'NOT_FOUND', 'No such screen in this run', 404)
    const s = surface as UxSurfaceForReport & { id: string; report_id: string | null }
    if (s.report_id) return c.json({ ok: true, data: { report_id: s.report_id, reused: true } })

    const { data: report, error: repErr } = await db
      .from('reports')
      .insert(buildUxLoopReport(projectId, runId, s, new Date()))
      .select('id')
      .single()
    if (repErr || !report) return dbError(c, repErr)
    const reportId = (report as { id: string }).id
    const { data: linked, error: linkErr } = await db
      .from('ux_surfaces')
      .update({ report_id: reportId })
      .eq('id', s.id)
      .is('report_id', null)
      .select('id')
    if (linkErr) return dbError(c, linkErr)
    if (!linked || (linked as unknown[]).length === 0) {
      // Two clicks raced and the other linked first: drop this one's report
      // (created a moment ago, never shown) and answer with the winner's.
      await db.from('reports').delete().eq('id', reportId).eq('project_id', projectId)
      const { data: winner } = await db.from('ux_surfaces').select('report_id').eq('id', s.id).maybeSingle()
      const winnerId = (winner as { report_id: string | null } | null)?.report_id
      if (winnerId) return c.json({ ok: true, data: { report_id: winnerId, reused: true } })
      return jsonError(c, 'CONFLICT', 'The screen changed while filing; try again.', 409)
    }
    return c.json({ ok: true, data: { report_id: reportId, reused: false } }, 201)
  })
}
