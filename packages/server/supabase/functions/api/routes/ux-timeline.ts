/**
 * FILE: packages/server/supabase/functions/api/routes/ux-timeline.ts
 * PURPOSE: The app's iteration timeline (Plan 025 P1, ADR 0072), served by
 *          `api-ext` (deploy size limit; `api` forwards these paths).
 *
 *   GET   /v1/admin/projects/:pid/timeline[?compact=1]          — the rail (releases, else UX runs), the screens, the last 30 days
 *   GET   /v1/admin/projects/:pid/timeline/surfaces/:key        — one screen: every pinned shot (signed URLs), its scores, its kept changes
 *   POST  /v1/admin/projects/:pid/timeline/baselines            — pin each screen's current screenshot to a release or version
 *   PATCH /v1/admin/projects/:pid/timeline/baselines/:id        — { pinned }: keep one shot forever
 *   PATCH /v1/admin/projects/:pid/timeline/settings             — { keep_releases?, auto_pin? }: retention, and pin on release publish (opt-in)
 *   GET   /v1/admin/projects/:pid/timeline/run-plan?kind=        — how to start a UX run (MCP start_ux_run); starts nothing (ADR 0017/0020)
 *
 * No model call: the timeline is images and numbers. Reads take an
 * mcp:read key or the console JWT; writes an mcp:write key or the console,
 * never a viewer. Every route checks the caller can access the project.
 * Writes go through the service client (members only SELECT under RLS).
 */

import type { Context, Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { log } from '../../_shared/logger.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { toPublicSupabaseUrl } from '../../_shared/public-url.ts'
import { UX_CAPTURES_BUCKET } from '../../_shared/ux-runs.ts'
import { pinBaselines } from '../../_shared/ux-baseline-pin.ts'
import {
  buildTimeline,
  meanScore,
  timelineSurfaceKey,
  UX_BASELINE_DEFAULT_KEEP,
  validVersion,
  type PageScoreRow,
  type TimelineBaselineRow,
  type TimelineReleaseRow,
  type TimelineReportRow,
  type TimelineRunRow,
} from '../../_shared/ux-timeline.ts'
import { callerCanAccessProject, dbError, jsonError } from '../shared.ts'

const tlog = log.child('ux-timeline')
const READ_URL_TTL_SEC = 3600
const SURFACE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,119}$/
/** Runs the rail reads (newest first). */
const RUNS_READ = 120
/** Scorecard runs whose page scores feed the month's movers. */
const SCORECARD_RUNS_READ = 30
const PINS_PER_HOUR = 12

type Db = ReturnType<typeof getServiceClient>
type Ctx = Context<{ Variables: Variables }>

async function access(c: Ctx, db: Db, opts: { write?: boolean } = {}): Promise<{ projectId: string; userId: string } | Response> {
  const userId = c.get('userId') as string
  const projectId = c.req.param('pid')!
  const a = await callerCanAccessProject(c, db, userId, projectId)
  if (!a.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
  if (opts.write && a.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot change the timeline.', 403)
  return { projectId, userId }
}

async function signPaths(db: Db, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(paths)].slice(0, 400)
  if (!unique.length) return out
  const { data, error } = await db.storage.from(UX_CAPTURES_BUCKET).createSignedUrls(unique, READ_URL_TTL_SEC)
  if (error) {
    tlog.warn('could not sign baseline urls', { err: error.message })
    return out
  }
  for (const u of data ?? []) if (u.path && u.signedUrl) out.set(u.path, toPublicSupabaseUrl(u.signedUrl))
  return out
}

async function timelineSettings(db: Db, projectId: string): Promise<{ keep_releases: number; auto_pin: boolean }> {
  const { data } = await db.from('project_settings').select('ux_baseline_keep_releases, ux_baseline_auto_pin').eq('project_id', projectId).maybeSingle()
  const row = data as { ux_baseline_keep_releases?: number; ux_baseline_auto_pin?: boolean } | null
  const n = Number(row?.ux_baseline_keep_releases)
  return { keep_releases: Number.isFinite(n) && n >= 1 ? n : UX_BASELINE_DEFAULT_KEEP, auto_pin: row?.ux_baseline_auto_pin === true }
}

/** Everything the rail needs, read in parallel. */
async function readTimeline(db: Db, projectId: string) {
  const [rel, runsRes, base] = await Promise.all([
    db.from('releases').select('id, version, title, status, published_at, created_at, fixed_report_ids').eq('project_id', projectId).order('created_at', { ascending: false }).limit(60),
    db
      .from('ux_runs')
      .select('id, local_run_id, kind, status, started_at, cost_usd, cost')
      .eq('project_id', projectId)
      .in('kind', ['loop', 'scorecard'])
      .order('started_at', { ascending: false })
      .limit(RUNS_READ),
    db
      .from('ux_baselines')
      .select('id, surface_key, path, label, viewport, version, release_id, run_id, score, penalty, cost_usd, pinned, created_at, capture_path')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(2000),
  ])
  if (rel.error) return { error: rel.error }
  if (runsRes.error) return { error: runsRes.error }
  if (base.error) return { error: base.error }
  const runs = (runsRes.data ?? []) as Array<Omit<TimelineRunRow, 'mean_score' | 'improved'>>
  const scorecardIds = runs.filter((r) => r.kind === 'scorecard').slice(0, SCORECARD_RUNS_READ).map((r) => r.id)
  const loopIds = runs.filter((r) => r.kind === 'loop').map((r) => r.id)
  const releases = (rel.data ?? []) as TimelineReleaseRow[]
  const oldest = [...runs.map((r) => r.started_at), ...releases.map((r) => r.created_at)].sort()[0] ?? new Date(Date.now() - 90 * 864e5).toISOString()
  const [pages, kept, fixed] = await Promise.all([
    scorecardIds.length
      ? db.from('ux_surfaces').select('run_id, surface_key, kind, path, label, score').in('run_id', scorecardIds).not('score', 'is', null).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    loopIds.length
      ? db.from('ux_iterations').select('run_id, surface_id').in('run_id', loopIds).eq('outcome', 'accepted').limit(5000)
      : Promise.resolve({ data: [], error: null }),
    db.from('reports').select('id, summary, fixed_at').eq('project_id', projectId).not('fixed_at', 'is', null).gte('fixed_at', oldest).order('fixed_at', { ascending: false }).limit(500),
  ])
  if (pages.error) return { error: pages.error }
  if (kept.error) return { error: kept.error }
  if (fixed.error) return { error: fixed.error }
  const startedById = new Map(runs.map((r) => [r.id, r.started_at]))
  const scoresByRun = new Map<string, number[]>()
  const pageScores: PageScoreRow[] = []
  for (const p of (pages.data ?? []) as Array<{ run_id: string; surface_key: string; kind: string; path: string; label: string; score: number }>) {
    ;(scoresByRun.get(p.run_id) ?? scoresByRun.set(p.run_id, []).get(p.run_id)!).push(p.score)
    pageScores.push({ run_id: p.run_id, started_at: startedById.get(p.run_id) ?? '', surface_key: timelineSurfaceKey(p), label: p.label, score: p.score })
  }
  const improvedByRun = new Map<string, Set<string>>()
  for (const k of (kept.data ?? []) as Array<{ run_id: string; surface_id: string }>) {
    ;(improvedByRun.get(k.run_id) ?? improvedByRun.set(k.run_id, new Set()).get(k.run_id)!).add(k.surface_id)
  }
  return {
    releases,
    runs: runs.map((r) => ({ ...r, mean_score: meanScore(scoresByRun.get(r.id) ?? []), improved: improvedByRun.get(r.id)?.size ?? 0 })),
    reports: ((fixed.data ?? []) as Array<{ id: string; summary: string | null; fixed_at: string }>).map((r): TimelineReportRow => ({ id: r.id, title: (r.summary ?? 'Report').slice(0, 200), fixed_at: r.fixed_at })),
    baselines: (base.data ?? []) as TimelineBaselineRow[],
    pageScores,
  }
}

const PinBody = z.object({
  version: z.string().trim().max(80).optional(),
  release_id: z.string().uuid().optional(),
  surfaces: z.array(z.string().regex(SURFACE_KEY_RE)).max(240).optional(),
})

export function registerUxTimelineRoutes(app: Hono<{ Variables: Variables }>): void {
  // ── GET the timeline ──────────────────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/timeline', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db)
    if (a instanceof Response) return a
    const read = await readTimeline(db, a.projectId)
    if ('error' in read) return dbError(c, read.error)
    const tl = buildTimeline({ ...read, now: new Date() })
    const settings = await timelineSettings(db, a.projectId)
    const compact = c.req.query('compact') === '1'
    // The overview signs one thumbnail per screen (its newest desktop shot); a screen's frames come from /surfaces/:key.
    const thumbOf = (frames: (typeof tl.surfaces)[number]['frames']) =>
      [...frames].reverse().find((f) => f.viewport === 'desktop') ?? frames[frames.length - 1]
    const signed = compact ? new Map<string, string>() : await signPaths(db, tl.surfaces.slice(0, 80).map((s) => thumbOf(s.frames)?.capture_path).filter((p): p is string => !!p))
    const surfaces = tl.surfaces.slice(0, 80).map((s) => {
      const thumb = thumbOf(s.frames)
      const frames = s.frames.map(({ capture_path: _path, ...f }) => f)
      return compact
        ? { key: s.key, label: s.label, path: s.path, latest_score: s.latest_score, first_score: s.first_score, frames: frames.length }
        : { key: s.key, label: s.label, path: s.path, latest_score: s.latest_score, first_score: s.first_score, frames, thumb_url: thumb ? (signed.get(thumb.capture_path) ?? null) : null }
    })
    const points = compact ? tl.points.map(({ runs, ...p }) => ({ ...p, runs: runs.map((r) => r.local_run_id) })) : tl.points
    return c.json({ ok: true, data: { rail: tl.rail, points, surfaces, month: tl.month, settings, console_path: '/timeline' } })
  })

  // ── GET one screen's history ──────────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/timeline/surfaces/:key', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db)
    if (a instanceof Response) return a
    const key = c.req.param('key')!
    if (!SURFACE_KEY_RE.test(key)) return jsonError(c, 'VALIDATION_ERROR', 'Malformed screen key.')
    const { data: rows, error } = await db
      .from('ux_baselines')
      .select('id, surface_key, path, label, viewport, version, release_id, run_id, score, penalty, cost_usd, pinned, created_at, capture_path')
      .eq('project_id', a.projectId)
      .eq('surface_key', key)
      .order('created_at', { ascending: true })
      .limit(400)
    if (error) return dbError(c, error)
    const baselines = (rows ?? []) as TimelineBaselineRow[]
    const path = baselines.at(-1)?.path ?? null
    // Scores across scorecard runs (same key), and the changes the UX loop kept on this screen.
    const [scoresRes, loopRes] = await Promise.all([
      db
        .from('ux_surfaces')
        .select('score, judge_cached, cost_usd, updated_at, run_id, ux_runs!inner(local_run_id, started_at, kind)')
        .eq('project_id', a.projectId)
        .eq('surface_key', key)
        .not('score', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(60),
      path
        ? db.from('ux_surfaces').select('id, label, ux_runs!inner(local_run_id, started_at, kind, pr_state)').eq('project_id', a.projectId).eq('path', path).eq('ux_runs.kind', 'loop').limit(40)
        : db.from('ux_surfaces').select('id, label, ux_runs!inner(local_run_id, started_at, kind, pr_state)').eq('project_id', a.projectId).eq('surface_key', key).eq('ux_runs.kind', 'loop').limit(40),
    ])
    if (scoresRes.error) return dbError(c, scoresRes.error)
    if (loopRes.error) return dbError(c, loopRes.error)
    type RunJoin = { local_run_id: string; started_at: string; kind: string; pr_state?: string | null }
    const one = (j: unknown): RunJoin | null => (Array.isArray(j) ? (j[0] as RunJoin) : (j as RunJoin | null)) ?? null
    const loopRows = (loopRes.data ?? []) as Array<{ id: string; label: string; ux_runs: unknown }>
    const runOfSurface = new Map(loopRows.map((r) => [r.id, one(r.ux_runs)]))
    const { data: iters, error: itErr } = loopRows.length
      ? await db.from('ux_iterations').select('surface_id, n, reason, step, commit_sha, created_at').in('surface_id', loopRows.map((r) => r.id)).eq('outcome', 'accepted').order('created_at', { ascending: false }).limit(60)
      : { data: [], error: null }
    if (itErr) return dbError(c, itErr)
    const signed = await signPaths(db, baselines.slice(-200).map((b) => b.capture_path))
    return c.json({
      ok: true,
      data: {
        surface: { key, label: baselines.at(-1)?.label ?? loopRows[0]?.label ?? key, path },
        frames: baselines.slice(-200).map(({ capture_path, ...b }) => ({ ...b, url: signed.get(capture_path) ?? null })),
        scores: ((scoresRes.data ?? []) as Array<{ score: number; judge_cached: boolean; cost_usd: number | null; updated_at: string; ux_runs: unknown }>).reverse().map((s) => {
          const run = one(s.ux_runs)
          return { at: run?.started_at ?? s.updated_at, run: run?.local_run_id ?? null, score: s.score, cached: s.judge_cached === true, cost_usd: s.cost_usd == null ? null : Number(s.cost_usd) }
        }),
        changes: ((iters ?? []) as Array<{ surface_id: string; n: number; reason: string | null; step: string | null; commit_sha: string | null; created_at: string }>).map((i) => {
          const run = runOfSurface.get(i.surface_id)
          return { at: i.created_at, run: run?.local_run_id ?? null, shipped: run?.pr_state === 'merged', what: (i.step ?? i.reason ?? '').slice(0, 300), commit_sha: i.commit_sha }
        }),
      },
    })
  })

  // ── POST pin the current screenshots to a release ─────────────────────────
  app.post('/v1/admin/projects/:pid/timeline/baselines', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db, { write: true })
    if (a instanceof Response) return a
    const parsed = PinBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Send { version } or { release_id }.')
    let version = parsed.data.version?.trim() ?? null
    let releaseId: string | null = null
    if (parsed.data.release_id) {
      const { data: rel, error } = await db.from('releases').select('id, version').eq('project_id', a.projectId).eq('id', parsed.data.release_id).maybeSingle()
      if (error) return dbError(c, error)
      if (!rel) return jsonError(c, 'NOT_FOUND', 'No such release in this project.', 404)
      releaseId = (rel as { id: string }).id
      version = (rel as { version: string }).version
    }
    if (!version || !validVersion(version)) {
      return jsonError(c, 'VALIDATION_ERROR', 'Name the version (letters, digits, . _ + -, up to 80) or pick a release.')
    }
    const rate = await claimTenantRateLimit(db, `project:${a.projectId}:ux_baseline_pin`, PINS_PER_HOUR, 3600)
    if (!rate.allowed) return jsonError(c, 'RATE_LIMITED', `At most ${PINS_PER_HOUR} pins an hour per app. Try again later.`, 429)

    const out = await pinBaselines(db, {
      projectId: a.projectId,
      version,
      releaseId,
      userId: a.userId,
      only: parsed.data.surfaces?.length ? new Set(parsed.data.surfaces) : undefined,
    })
    if (!out.ok) return out.code === 'NO_CAPTURES' ? jsonError(c, 'NO_CAPTURES', out.message, 409) : dbError(c, { message: out.message })
    await logAudit(db, a.projectId, a.userId, 'ux_timeline.pinned', 'ux_baseline', undefined, { version, release_id: releaseId, pinned: out.pinned, failed: out.failed }).catch(() => null)
    return c.json({ ok: true, data: { version, release_id: releaseId, pinned: out.pinned, failed: out.failed, screens: out.screens } }, out.pinned ? 201 : 200)
  })

  // ── GET how to start a UX run (MCP start_ux_run) ──────────────────────────
  // ADR 0017/0020: a cloud run spends the host's Actions minutes and Cursor
  // credits, so only a console session starts one. An agent gets the console
  // link and the local command; nothing is queued or dispatched here.
  app.get('/v1/admin/projects/:pid/timeline/run-plan', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db)
    if (a instanceof Response) return a
    const kind = c.req.query('kind') === 'loop' ? 'loop' : 'scorecard'
    return c.json({
      ok: true,
      data: {
        started: false,
        kind,
        why: "A cloud UX run spends your repo's Actions minutes and Cursor credits, so only a person starts it from the console (ADR 0017/0020). A local run uses your own machine and keys.",
        console_path: kind === 'scorecard' ? '/ux-runs?view=scorecard' : '/ux-runs',
        commands: {
          scorecard: 'npx @mushi-mushi/ux scorecard --url <your app URL> --profile-dir <a signed-in browser profile> --sync',
          loop: 'npx @mushi-mushi/ux run --dev "<your dev command, e.g. pnpm dev --port {port}>" --agent claude-code --sync',
        },
        next: 'After the run, read it with get_ux_run (its run id) or get_timeline; pin its screens to a release from the Timeline page.',
      },
    })
  })

  // ── PATCH keep one shot forever ───────────────────────────────────────────
  app.patch('/v1/admin/projects/:pid/timeline/baselines/:id', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db, { write: true })
    if (a instanceof Response) return a
    const id = c.req.param('id')!
    const body = z.object({ pinned: z.boolean() }).safeParse(await c.req.json().catch(() => null))
    if (!body.success || !z.string().uuid().safeParse(id).success) return jsonError(c, 'VALIDATION_ERROR', 'Send { pinned: true | false } for one baseline id.')
    const { data, error } = await db.from('ux_baselines').update({ pinned: body.data.pinned }).eq('project_id', a.projectId).eq('id', id).select('id, pinned').maybeSingle()
    if (error) return dbError(c, error)
    if (!data) return jsonError(c, 'NOT_FOUND', 'No such baseline in this project.', 404)
    return c.json({ ok: true, data })
  })

  // ── PATCH retention and auto-pin ──────────────────────────────────────────
  app.patch('/v1/admin/projects/:pid/timeline/settings', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await access(c, db, { write: true })
    if (a instanceof Response) return a
    const body = z
      .object({ keep_releases: z.number().int().min(1).max(500).optional(), auto_pin: z.boolean().optional() })
      .refine((v) => v.keep_releases !== undefined || v.auto_pin !== undefined)
      .safeParse(await c.req.json().catch(() => null))
    if (!body.success) return jsonError(c, 'VALIDATION_ERROR', 'Send keep_releases (a whole number from 1 to 500) and/or auto_pin (true or false).')
    const patch: Record<string, unknown> = {}
    if (body.data.keep_releases !== undefined) patch.ux_baseline_keep_releases = body.data.keep_releases
    if (body.data.auto_pin !== undefined) patch.ux_baseline_auto_pin = body.data.auto_pin
    const { error } = await db.from('project_settings').update(patch).eq('project_id', a.projectId)
    if (error) return dbError(c, error)
    await logAudit(db, a.projectId, a.userId, 'ux_timeline.retention', 'project_settings', a.projectId, body.data).catch(() => null)
    return c.json({ ok: true, data: body.data })
  })
}
