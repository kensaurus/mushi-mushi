/**
 * FILE: packages/server/supabase/functions/api/routes/ux-scorecard.ts
 * PURPOSE: The UX scorecard (ADR 0067), served by `api-ext` (deploy size
 *          limit; `api` forwards these paths).
 *
 *   PUT  /v1/admin/projects/:pid/ux-scorecard/:runId            — CLI: upsert a run and its pages (ux_runs kind scorecard)
 *   POST /v1/admin/projects/:pid/ux-scorecard/:runId/uploads    — CLI: signed upload URLs for page screenshots
 *   POST /v1/admin/projects/:pid/ux-scorecard/:runId/score      — CLI: score one page through the `ux-scorecard` route
 *   POST /v1/admin/projects/:pid/ux-scorecard/:runId/group      — CLI: group the run's issues into root causes (one model call)
 *   POST /v1/admin/projects/:pid/ux-scorecard/:runId/file       — CLI: file the top root causes as `ux_scorecard` reports
 *   GET  /v1/admin/projects/:pid/ux-scorecard[?run=<id>]        — console: pages worst first with their trend, the causes, the runs
 *   PATCH /v1/admin/projects/:pid/ux-scorecard  { viewport }     — console: the viewport this app is scored at ("1440x900")
 *
 * The CLI authenticates with an mcp:write key; the console with its JWT.
 * Every route checks the caller can access the project; writes go through
 * the service client (members only have SELECT on ux_runs and ux_surfaces).
 *
 * Model calls: the app's own Claude or OpenAI key first, then the platform
 * route `ux-scorecard` (tier standard) on kenji (withAnthropicOrOpenAi). One
 * request is one model call, so a run of 60 pages never meets the edge
 * function's wall clock.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { checkIngestQuota } from '../../_shared/quota.ts'
import { queueReportClassification } from '../../_shared/report-classification.ts'
import { FILE_REPORT_RATE_SCOPE, FILED_REPORTS_PER_HOUR } from '../../_shared/report-file.ts'
import { UX_CAPTURES_BUCKET } from '../../_shared/ux-runs.ts'
import { toPublicSupabaseUrl } from '../../_shared/public-url.ts'
import { withAnthropicOrOpenAi } from '../../_shared/llm-failover.ts'
import { withLlmUsage } from '../../_shared/llm-usage.ts'
import { claudeGenerateText } from '../../_shared/claude-messages.ts'
import { ANTHROPIC_SONNET_LATEST, OPENAI_TERRA } from '../../_shared/models.ts'
import {
  groupCauses,
  groupingPrompt,
  mergeGrouping,
  pageSystemPrompt,
  pageUserPrompt,
  parsePageAnswer,
  planFiling,
  scorecardPageKey,
  scorecardRows,
  UX_SCORECARD_LIMITS,
  UX_SCORECARD_PROMPT_VERSION,
  type ScoredPage,
  type UxCause,
  type UxPageFacts,
} from '../../_shared/ux-scorecard.ts'
import {
  affectedScreens,
  parseViewport,
  scorecardReportRow,
  scorecardRunRow,
  scorecardShotPath,
  scorecardSurfaceKey,
  scorecardSurfaceRow,
  scoredPageFromRow,
  UX_SCORECARD_DEFAULT_VIEWPORT,
  UX_SCORECARD_OPEN_CAP,
  UX_SCORECARD_OPEN_STATUSES,
  UX_SCORECARD_RUN_ID_RE,
  UxScorecardCauses,
  UxScorecardFacts,
  UxScorecardSnapshot,
} from '../../_shared/ux-scorecard-io.ts'
import { callerCanAccessProject, dbError, jsonError } from '../shared.ts'

const slog = log.child('ux-scorecard')
const READ_URL_TTL_SEC = 3600
const FEATURE = 'ux-scorecard'
/** Defaults when the app's own key answers; a platform call uses the route's model. */
const SCORECARD_MODEL = ANTHROPIC_SONNET_LATEST
const SCORECARD_FALLBACK = OPENAI_TERRA
const LLM_TIMEOUT_MS = 120_000
const MAX_OUTPUT_TOKENS = 4000
/** Scored runs whose page scores make the trend. */
const TREND_RUNS = 12

type Db = ReturnType<typeof getServiceClient>
type Ctx = Context<{ Variables: Variables }>

async function runRow(db: Db, projectId: string, localRunId: string) {
  return db.from('ux_runs').select('id, kind, status, start_url, findings').eq('project_id', projectId).eq('local_run_id', localRunId).maybeSingle()
}

/** Access for a write: a member who is not a viewer, on a well-formed run id. */
async function writeAccess(c: Ctx, db: Db): Promise<{ projectId: string; localRunId: string; userId: string } | Response> {
  const userId = c.get('userId') as string
  const projectId = c.req.param('pid')!
  const localRunId = c.req.param('runId')!
  if (!UX_SCORECARD_RUN_ID_RE.test(localRunId)) return jsonError(c, 'VALIDATION_ERROR', 'Bad run id.')
  const access = await callerCanAccessProject(c, db, userId, projectId)
  if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
  if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot run the UX scorecard.', 403)
  return { projectId, localRunId, userId }
}

/** The scorecard run a write names, or a response saying why there is none. */
async function scorecardRun(c: Ctx, db: Db, projectId: string, localRunId: string): Promise<{ id: string; start_url: string | null; findings: unknown } | Response> {
  const { data, error } = await runRow(db, projectId, localRunId)
  if (error) return dbError(c, error)
  if (!data || (data as { kind: string }).kind !== 'scorecard') return jsonError(c, 'NOT_FOUND', 'Sync the scorecard run (PUT) first.', 404)
  return data as { id: string; start_url: string | null; findings: unknown }
}

/** Pattern keys of the app's open scorecard reports. */
async function openPatternKeys(db: Db, projectId: string): Promise<{ keys: Map<string, string> } | { error: { message: string } }> {
  const { data, error } = await db
    .from('reports')
    .select('id, pattern_key')
    .eq('project_id', projectId)
    .eq('source', 'ux_scorecard')
    .is('parent_report_id', null)
    .in('status', [...UX_SCORECARD_OPEN_STATUSES])
    .not('pattern_key', 'is', null)
    .limit(500)
  if (error) return { error }
  return { keys: new Map(((data ?? []) as Array<{ id: string; pattern_key: string }>).map((r) => [r.pattern_key, r.id])) }
}

/** The run's scored pages, as the rubric reads them. */
async function scoredPages(db: Db, runRowId: string): Promise<{ pages: ScoredPage[] } | { error: { message: string } }> {
  const { data, error } = await db.from('ux_surfaces').select('path, label, scorecard, facts').eq('run_id', runRowId).not('score', 'is', null).order('path').limit(200)
  if (error) return { error }
  const pages = ((data ?? []) as Array<{ path: string; label: string; scorecard: unknown; facts: unknown }>).map(scoredPageFromRow).filter((p): p is ScoredPage => !!p)
  return { pages }
}

export function registerUxScorecardRoutes(app: Hono<{ Variables: Variables }>): void {
  // ── CLI: upsert a run and its pages ───────────────────────────────────────
  app.put('/v1/admin/projects/:pid/ux-scorecard/:runId', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await writeAccess(c, db)
    if (a instanceof Response) return a
    const parsed = UxScorecardSnapshot.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    const { data: prior, error: priorErr } = await runRow(db, a.projectId, a.localRunId)
    if (priorErr) return dbError(c, priorErr)
    if (prior && (prior as { kind: string }).kind !== 'scorecard') return jsonError(c, 'CONFLICT', 'That run id belongs to another kind of UX run.', 409)
    const now = new Date()
    const { data: saved, error } = await db
      .from('ux_runs')
      .upsert(scorecardRunRow(parsed.data, { projectId: a.projectId, localRunId: a.localRunId, userId: a.userId, now }), { onConflict: 'project_id,local_run_id' })
      .select('id')
      .single()
    if (error) return dbError(c, error)
    const runRowId = (saved as { id: string }).id
    if (parsed.data.pages.length) {
      // A page the server already scored keeps its score when the CLI resends it
      // unscored. Scored and unscored rows go in two upserts, so every row of a
      // batch names the same columns (a bulk upsert nulls a column a row leaves out).
      const rows = parsed.data.pages.map((p) => scorecardSurfaceRow(p, { projectId: a.projectId, runRowId, now }))
      const { data: have, error: haveErr } = await db.from('ux_surfaces').select('surface_key, score').eq('run_id', runRowId)
      if (haveErr) return dbError(c, haveErr)
      const scored = new Set(((have ?? []) as Array<{ surface_key: string; score: number | null }>).filter((r) => r.score != null).map((r) => r.surface_key))
      const withScore = rows.filter((r) => r.score !== undefined)
      const without = rows.filter((r) => r.score === undefined && !scored.has(String(r.surface_key)))
      for (const batch of [withScore, without]) {
        if (!batch.length) continue
        const { error: sErr } = await db.from('ux_surfaces').upsert(batch, { onConflict: 'run_id,surface_key' })
        if (sErr) return dbError(c, sErr)
      }
    }
    return c.json({ ok: true, data: { id: runRowId } })
  })

  // ── CLI: screenshot upload URLs ───────────────────────────────────────────
  app.post('/v1/admin/projects/:pid/ux-scorecard/:runId/uploads', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await writeAccess(c, db)
    if (a instanceof Response) return a
    const body = (await c.req.json().catch(() => null)) as { names?: unknown } | null
    const names = Array.isArray(body?.names) ? body!.names.filter((n): n is string => typeof n === 'string') : []
    if (!names.length || names.length > 60) return jsonError(c, 'VALIDATION_ERROR', 'Send { names: ["<surface-key>/settled.png", …] } (1 to 60).')
    const run = await scorecardRun(c, db, a.projectId, a.localRunId)
    if (run instanceof Response) return run
    const uploads: Array<{ name: string; signedUrl: string }> = []
    for (const name of names) {
      const path = scorecardShotPath(a.projectId, run.id, name)
      if (!path) return jsonError(c, 'VALIDATION_ERROR', `Bad screenshot name "${name.slice(0, 80)}"`)
      const { data, error } = await db.storage.from(UX_CAPTURES_BUCKET).createSignedUploadUrl(path, { upsert: true })
      if (error || !data) return jsonError(c, 'UPSTREAM_ERROR', 'Could not mint an upload URL. Retry in a moment.', 502)
      uploads.push({ name, signedUrl: toPublicSupabaseUrl(data.signedUrl) })
    }
    return c.json({ ok: true, data: { uploads } })
  })

  // ── CLI: score one page (one model call) ──────────────────────────────────
  app.post('/v1/admin/projects/:pid/ux-scorecard/:runId/score', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await writeAccess(c, db)
    if (a instanceof Response) return a
    const body = (await c.req.json().catch(() => null)) as { facts?: unknown; shots?: unknown; app?: unknown; about?: unknown; other_pages?: unknown } | null
    const parsedFacts = UxScorecardFacts.safeParse(body?.facts)
    if (!parsedFacts.success) return jsonError(c, 'VALIDATION_ERROR', parsedFacts.error.issues.slice(0, 3).map((i) => `facts.${i.path.join('.')}: ${i.message}`).join('; '))
    const facts = parsedFacts.data as UxPageFacts
    const run = await scorecardRun(c, db, a.projectId, a.localRunId)
    if (run instanceof Response) return run
    const shotNames = (Array.isArray(body?.shots) ? body!.shots : []).filter((n): n is string => typeof n === 'string').slice(0, 2)
    const paths = shotNames.map((n) => scorecardShotPath(a.projectId, run.id, n)).filter((p): p is string => !!p)
    const images: string[] = []
    if (paths.length) {
      const { data: signed, error: signErr } = await db.storage.from(UX_CAPTURES_BUCKET).createSignedUrls(paths, READ_URL_TTL_SEC)
      if (signErr) return jsonError(c, 'UPSTREAM_ERROR', 'Could not read the page screenshots. Upload them, then retry.', 502)
      for (const s of signed ?? []) if (s.signedUrl) images.push(toPublicSupabaseUrl(s.signedUrl))
    }
    const system = pageSystemPrompt()
    const user = pageUserPrompt(facts, {
      app: typeof body?.app === 'string' ? body.app.slice(0, 120) : 'this app',
      about: typeof body?.about === 'string' ? body.about.slice(0, 300) : undefined,
      otherPages: Array.isArray(body?.other_pages) ? body!.other_pages.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 80)).slice(0, 80) : [],
    })
    const content = [{ type: 'text' as const, text: user }, ...images.map((image) => ({ type: 'image' as const, image }))]
    const usage = (model: string, keySource: 'byok' | 'env') => ({ functionName: 'api', stage: FEATURE, projectId: a.projectId, model, keySource, promptVersion: UX_SCORECARD_PROMPT_VERSION })
    let text: string
    let usedModel: string
    try {
      const routed = await withAnthropicOrOpenAi(
        db,
        a.projectId,
        (key) =>
          withLlmUsage(db, usage(key.model ?? SCORECARD_MODEL, key.source), () =>
            claudeGenerateText({ apiKey: key.key, model: key.model ?? SCORECARD_MODEL, system, messages: [{ role: 'user', content } as never], maxTokens: MAX_OUTPUT_TOKENS, timeoutMs: LLM_TIMEOUT_MS }),
          ).then((r) => r.text),
        async (key) => {
          const [{ openAiProvider }, { generateText }] = await Promise.all([import('../../_shared/openai-compat.ts'), import('../../_shared/ai-sdk.ts')])
          const openai = openAiProvider({ apiKey: key.key, ...(key.baseUrl ? { baseURL: key.baseUrl } : {}) })
          return withLlmUsage(db, usage(key.model ?? SCORECARD_FALLBACK, key.source), () =>
            generateText({ model: openai(key.model ?? SCORECARD_FALLBACK), system, messages: [{ role: 'user', content }] as never, maxTokens: MAX_OUTPUT_TOKENS }),
          ).then((r) => r.text)
        },
        { feature: FEATURE, tier: 'standard' },
      )
      text = routed.result
      usedModel = routed.model ?? (routed.usedProvider === 'openai' ? SCORECARD_FALLBACK : SCORECARD_MODEL)
    } catch (err) {
      slog.warn('page not scored', { projectId: a.projectId, run: a.localRunId, page: facts.key, err: String(err).slice(0, 300) })
      return jsonError(c, 'LLM_UNAVAILABLE', 'The page could not be scored right now. Retry in a minute.', 503)
    }
    const parsed = parsePageAnswer(text, facts)
    if (!parsed.ok) return jsonError(c, 'LLM_BAD_ANSWER', parsed.error, 502)
    const key = scorecardPageKey(facts.key)
    const now = new Date().toISOString()
    const { error } = await db.from('ux_surfaces').upsert(
      {
        run_id: run.id,
        project_id: a.projectId,
        surface_key: scorecardSurfaceKey(key),
        kind: 'page',
        path: key.slice(0, 500),
        label: (facts.label || key).slice(0, 300),
        status: 'baseline',
        facts,
        score: parsed.value.overall,
        scorecard: parsed.value,
        thumbs: shotNames.length ? { scorecard: shotNames } : null,
        updated_at: now,
      },
      { onConflict: 'run_id,surface_key' },
    )
    if (error) return dbError(c, error)
    return c.json({ ok: true, data: { score: parsed.value, model: usedModel } })
  })

  // ── CLI: group the run's issues into root causes ──────────────────────────
  app.post('/v1/admin/projects/:pid/ux-scorecard/:runId/group', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await writeAccess(c, db)
    if (a instanceof Response) return a
    const run = await scorecardRun(c, db, a.projectId, a.localRunId)
    if (run instanceof Response) return run
    const [read, open] = await Promise.all([scoredPages(db, run.id), openPatternKeys(db, a.projectId)])
    if ('error' in read) return dbError(c, read.error)
    if ('error' in open) return dbError(c, open.error)
    const prior = [...open.keys.keys()]
    const base = groupCauses(read.pages, prior)
    let causes: UxCause[] = base
    let modelUsed: string | null = null
    if (read.pages.length >= 2) {
      const prompt = groupingPrompt(read.pages, prior)
      const usage = (model: string, keySource: 'byok' | 'env') => ({ functionName: 'api', stage: `${FEATURE}-group`, projectId: a.projectId, model, keySource, promptVersion: UX_SCORECARD_PROMPT_VERSION })
      try {
        const routed = await withAnthropicOrOpenAi(
          db,
          a.projectId,
          (key) =>
            withLlmUsage(db, usage(key.model ?? SCORECARD_MODEL, key.source), () =>
              claudeGenerateText({ apiKey: key.key, model: key.model ?? SCORECARD_MODEL, system: prompt.system, prompt: prompt.user, maxTokens: MAX_OUTPUT_TOKENS * 2, timeoutMs: LLM_TIMEOUT_MS }),
            ).then((r) => r.text),
          async (key) => {
            const [{ openAiProvider }, { generateText }] = await Promise.all([import('../../_shared/openai-compat.ts'), import('../../_shared/ai-sdk.ts')])
            const openai = openAiProvider({ apiKey: key.key, ...(key.baseUrl ? { baseURL: key.baseUrl } : {}) })
            return withLlmUsage(db, usage(key.model ?? SCORECARD_FALLBACK, key.source), () =>
              generateText({ model: openai(key.model ?? SCORECARD_FALLBACK), system: prompt.system, prompt: prompt.user, maxTokens: MAX_OUTPUT_TOKENS * 2 }),
            ).then((r) => r.text)
          },
          { feature: FEATURE, tier: 'standard' },
        )
        causes = mergeGrouping(read.pages, base, routed.result, prior)
        modelUsed = routed.model ?? null
      } catch (err) {
        // The code's grouping still stands: shared causes and evidence matches need no model.
        slog.warn('cross-page pass failed; keeping the code grouping', { projectId: a.projectId, run: a.localRunId, err: String(err).slice(0, 300) })
      }
    }
    const { error } = await db.from('ux_runs').update({ findings: causes, updated_at: new Date().toISOString() }).eq('id', run.id)
    if (error) return dbError(c, error)
    return c.json({ ok: true, data: { causes, grouped_by: modelUsed ? 'model' : 'code', model: modelUsed } })
  })

  // ── CLI: file the top root causes ─────────────────────────────────────────
  app.post('/v1/admin/projects/:pid/ux-scorecard/:runId/file', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const db = getServiceClient()
    const a = await writeAccess(c, db)
    if (a instanceof Response) return a
    const body = (await c.req.json().catch(() => null)) as { causes?: unknown; dry_run?: unknown; cap?: unknown } | null
    const run = await scorecardRun(c, db, a.projectId, a.localRunId)
    if (run instanceof Response) return run
    // The causes the CLI grouped (a local transport), else the ones the group route stored.
    const parsedCauses = UxScorecardCauses.safeParse(body?.causes ?? run.findings ?? [])
    if (!parsedCauses.success) return jsonError(c, 'VALIDATION_ERROR', 'causes: not a list of scorecard causes.')
    const causes = parsedCauses.data as UxCause[]
    const [open, read] = await Promise.all([openPatternKeys(db, a.projectId), scoredPages(db, run.id)])
    if ('error' in open) return dbError(c, open.error)
    if ('error' in read) return dbError(c, read.error)
    const room = Math.max(0, UX_SCORECARD_OPEN_CAP - open.keys.size)
    const asked = Number(body?.cap)
    const cap = Math.min(UX_SCORECARD_LIMITS.filePerRun, room, Number.isFinite(asked) && asked >= 0 ? asked : UX_SCORECARD_LIMITS.filePerRun)
    const plan = planFiling(causes, [...open.keys.keys()], cap)
    const pageScores = Object.fromEntries(read.pages.map((p) => [p.key, p.score.overall]))
    const baseUrl = run.start_url ?? ''
    const result = {
      filed: [] as Array<{ reportId: string; patternKey: string; title: string }>,
      updated: [] as Array<{ reportId: string; patternKey: string }>,
      skipped: plan.overCap.map((c2) => ({ patternKey: c2.patternKey, reason: room < UX_SCORECARD_LIMITS.filePerRun ? `the app holds ${open.keys.size} open scorecard reports (cap ${UX_SCORECARD_OPEN_CAP})` : `a run files at most ${UX_SCORECARD_LIMITS.filePerRun}` })),
      dryRun: body?.dry_run === true,
    }
    if (result.dryRun) {
      return c.json({ ok: true, data: { ...result, wouldFile: plan.file.map((x) => ({ patternKey: x.patternKey, title: x.title, pages: x.pages.length })), wouldUpdate: plan.update.map((x) => x.patternKey) } })
    }
    const now = new Date()
    // A cause already open: its pages are refreshed, nothing new is filed (ADR 0065).
    for (const cause of plan.update) {
      const reportId = open.keys.get(cause.patternKey)!
      const { error } = await db.from('reports').update({ affected_screens: affectedScreens(cause, pageScores, now.toISOString()), updated_at: now.toISOString() }).eq('id', reportId)
      if (error) slog.warn('open scorecard report not refreshed', { reportId, err: error.message })
      else result.updated.push({ reportId, patternKey: cause.patternKey })
    }
    for (const cause of plan.file) {
      const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', { p_user_id: a.projectId, p_scope: FILE_REPORT_RATE_SCOPE, p_max_per_window: FILED_REPORTS_PER_HOUR, p_window: '1 hour' })
      if (rateErr) {
        result.skipped.push({ patternKey: cause.patternKey, reason: (rateErr.message ?? '').includes('rate_limit_exceeded') ? `the app had ${FILED_REPORTS_PER_HOUR} reports filed in the last hour` : 'the rate limit could not be read' })
        continue
      }
      const quota = await checkIngestQuota(db, a.projectId)
      if (!quota.allowed) {
        result.skipped.push({ patternKey: cause.patternKey, reason: 'the plan quota of reports this month is used up' })
        break
      }
      const reportId = crypto.randomUUID()
      const { error } = await db
        .from('reports')
        .insert(scorecardReportRow(cause, { reportId, projectId: a.projectId, actorId: a.userId, localRunId: a.localRunId, baseUrl, pageScores, now }))
      if (error) {
        // The unique index lost a race to another run: that run's report holds the cause.
        if ((error as { code?: string }).code === '23505') result.skipped.push({ patternKey: cause.patternKey, reason: 'another run filed it just now' })
        else return dbError(c, error)
        continue
      }
      await queueReportClassification(db, reportId, a.projectId)
      await db.from('usage_events').insert({ project_id: a.projectId, event_name: 'reports_ingested', quantity: 1, metadata: { report_id: reportId, source: 'ux_scorecard' } }).then(({ error: uErr }) => {
        if (uErr) slog.warn('usage event insert failed', { reportId, err: uErr.message })
      })
      await logAudit(db, a.projectId, a.userId, 'report.created', 'report', reportId, { source: 'ux_scorecard', run: a.localRunId, pattern_key: cause.patternKey }, { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' })
      result.filed.push({ reportId, patternKey: cause.patternKey, title: cause.title })
    }
    return c.json({ ok: true, data: result })
  })

  // ── Console: the viewport this app is scored at ───────────────────────────
  app.patch('/v1/admin/projects/:pid/ux-scorecard', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot change settings.', 403)
    const body = (await c.req.json().catch(() => null)) as { viewport?: unknown } | null
    const vp = parseViewport(body?.viewport)
    if (!vp) return jsonError(c, 'VALIDATION_ERROR', 'Send { viewport: "1440x900" } (width 320–3840, height 320–2400).')
    const viewport = `${vp.width}x${vp.height}`
    const { data: saved, error } = await db.from('project_settings').update({ ux_scorecard_viewport: viewport }).eq('project_id', projectId).select('project_id')
    if (error) return dbError(c, error)
    if (!saved || (saved as unknown[]).length === 0) return jsonError(c, 'NOT_FOUND', 'This app has no settings row yet. Open its settings once, then retry.', 404)
    await logAudit(db, projectId, userId, 'ux_scorecard.viewport_set', 'project', projectId, { viewport }, { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' })
    return c.json({ ok: true, data: { viewport } })
  })

  // ── Console: the scorecard ────────────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/ux-scorecard', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    const { data: runs, error } = await db
      .from('ux_runs')
      .select('id, local_run_id, status, model, start_url, detail, counts, findings, started_at, finished_at, error')
      .eq('project_id', projectId)
      .eq('kind', 'scorecard')
      .order('started_at', { ascending: false })
      .limit(TREND_RUNS)
    if (error) return dbError(c, error)
    const list = (runs ?? []) as Array<{ id: string; local_run_id: string; started_at: string; findings: unknown; [k: string]: unknown }>
    const { data: settings } = await db.from('project_settings').select('ux_scorecard_viewport').eq('project_id', projectId).maybeSingle()
    const viewport = (settings as { ux_scorecard_viewport?: string } | null)?.ux_scorecard_viewport ?? UX_SCORECARD_DEFAULT_VIEWPORT
    const chosenId = c.req.query('run')
    const run = (chosenId ? list.find((r) => r.local_run_id === chosenId) : list[0]) ?? null
    const strip = (r: (typeof list)[number]) => {
      const { id: _id, findings: _f, ...rest } = r
      return rest
    }
    if (!run) return c.json({ ok: true, data: { run: null, runs: [], rows: [], causes: [], reports: [], viewport } })
    const older = list.filter((r) => r.started_at < run.started_at).map((r) => r.id)
    const [pagesRes, histRes, reportsRes] = await Promise.all([
      db.from('ux_surfaces').select('path, label, score, scorecard, facts, status, note, thumbs').eq('run_id', run.id).order('path').limit(200),
      older.length ? db.from('ux_surfaces').select('run_id, path, score, updated_at, version:scorecard->>promptVersion').in('run_id', older).not('score', 'is', null).limit(2000) : Promise.resolve({ data: [], error: null }),
      db.from('reports').select('id, title, status, severity, pattern_key, created_at').eq('project_id', projectId).eq('source', 'ux_scorecard').order('created_at', { ascending: false }).limit(50),
    ])
    if (pagesRes.error) return dbError(c, pagesRes.error)
    if (histRes.error) return dbError(c, histRes.error)
    if (reportsRes.error) return dbError(c, reportsRes.error)
    const pageRows = (pagesRes.data ?? []) as Array<{ path: string; label: string; scorecard: unknown; facts: unknown; status: string; note: string | null }>
    const scored = pageRows.map(scoredPageFromRow).filter((p): p is ScoredPage => !!p)
    const startedAt = new Map(list.map((r) => [r.id, r.started_at]))
    // A trend compares scores of one rubric version only (docs/ux-scorecard-rubric.md); older versions are left out.
    const version = scored[0]?.score.promptVersion ?? null
    const history = ((histRes.data ?? []) as Array<{ run_id: string; path: string; score: number; version: string | null }>)
      .filter((h) => !version || h.version === version)
      .map((h) => ({ key: h.path, overall: h.score, at: startedAt.get(h.run_id) ?? '' }))
    const rows = scorecardRows(scored, history)
    const unscored = pageRows.filter((p) => !scored.some((s) => s.key === p.path)).map((p) => ({ key: p.path, label: p.label, status: p.status, note: p.note }))
    const causesParsed = UxScorecardCauses.safeParse(run.findings ?? [])
    return c.json({
      ok: true,
      data: {
        run: strip(run),
        runs: list.map(strip),
        rows,
        unscored,
        causes: causesParsed.success ? causesParsed.data : [],
        reports: reportsRes.data ?? [],
        viewport,
        rubricVersion: version,
      },
    })
  })
}
