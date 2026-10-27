/**
 * FILE: packages/server/supabase/functions/api/routes/fresh-eyes.ts
 * PURPOSE: Fresh-eyes runs (ADR 0051), served by `api-ext` (deploy size limit;
 *          `api` forwards these paths).
 *
 *   POST /v1/admin/fresh-eyes/test-account                — operator: mint a synthetic account (password returned once)
 *   PUT  /v1/admin/projects/:pid/fresh-eyes/:runId        — CLI: upsert a run (ux_runs, kind fresh_eyes)
 *   POST /v1/admin/projects/:pid/fresh-eyes/:runId/uploads — CLI: signed upload URLs for its screenshots
 *   POST /v1/admin/projects/:pid/fresh-eyes/:runId/findings — CLI: file one finding as a `fresh_eyes` report
 *   GET  /v1/admin/projects/:pid/fresh-eyes               — runs and the time-to-first-value trend
 *   GET  /v1/admin/projects/:pid/fresh-eyes/:runId        — one run: timeline, screenshot URLs, filed reports
 *
 * The CLI authenticates with an mcp:write key; the console with its JWT.
 * Every project route checks the caller can access the project; writes go
 * through the service client (members only have SELECT on ux_runs).
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { requireOperator } from '../../_shared/operator-gate.ts'
import { checkIngestQuota } from '../../_shared/quota.ts'
import { queueReportClassification } from '../../_shared/report-classification.ts'
import { FILE_REPORT_RATE_SCOPE, FILED_REPORTS_PER_HOUR } from '../../_shared/report-file.ts'
import { UX_CAPTURES_BUCKET } from '../../_shared/ux-runs.ts'
import {
  blocksRefile,
  FRESH_EYES_FILE_CAP,
  FRESH_EYES_RUN_ID_RE,
  FreshEyesFindingBody,
  freshEyesMetricRows,
  freshEyesReportRow,
  freshEyesRunRow,
  freshEyesShotPath,
  FreshEyesSnapshot,
  SYNTHETIC_MINT_RATE_SCOPE,
  SYNTHETIC_MINTS_PER_HOUR,
  syntheticEmailDomain,
  syntheticIdentity,
} from '../../_shared/fresh-eyes.ts'
import { callerCanAccessProject, dbError, jsonError } from '../shared.ts'

const flog = log.child('fresh-eyes')
const READ_URL_TTL_SEC = 3600
const TREND_DAYS = 90

type Db = ReturnType<typeof getServiceClient>

async function runRow(db: Db, projectId: string, localRunId: string) {
  return db.from('ux_runs').select('id, kind, status').eq('project_id', projectId).eq('local_run_id', localRunId).maybeSingle()
}

export function registerFreshEyesRoutes(app: Hono<{ Variables: Variables }>): void {
  // ── Mint a synthetic account (operator only, Mushi itself) ────────────────
  app.post('/v1/admin/fresh-eyes/test-account', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    // An account is company-level: never through a key bound to one project.
    if (c.get('authMethod') === 'apiKey' && (!c.get('isOrgScopedKey') || c.get('keyAllowedProjectIds') || c.req.header('X-Mushi-Project-Id'))) {
      return jsonError(c, 'NEEDS_ACCOUNT_KEY', 'Minting a test account needs an account-level key with access to all your projects, or a signed-in session.', 403)
    }
    const denied = requireOperator(c)
    if (denied) return denied
    const userId = c.get('userId') as string
    const db = getServiceClient()

    // A synthetic account can never mint another one.
    const { data: selfSynthetic, error: synErr } = await db.from('synthetic_accounts').select('user_id').eq('user_id', userId).maybeSingle()
    if (synErr) return dbError(c, synErr)
    if (selfSynthetic) return jsonError(c, 'FORBIDDEN', 'A test account cannot mint test accounts.', 403)

    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: userId,
      p_scope: SYNTHETIC_MINT_RATE_SCOPE,
      p_max_per_window: SYNTHETIC_MINTS_PER_HOUR,
      p_window: '1 hour',
    })
    if (rateErr) {
      const limited = (rateErr.message ?? '').includes('rate_limit_exceeded')
      return jsonError(c, limited ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE', limited ? `At most ${SYNTHETIC_MINTS_PER_HOUR} test accounts an hour.` : 'No account was made. Retry in a moment.', limited ? 429 : 503)
    }

    const now = new Date()
    const id = syntheticIdentity(crypto.getRandomValues(new Uint8Array(34)), syntheticEmailDomain(Deno.env.get('MUSHI_FRESH_EYES_EMAIL_DOMAIN')), now)
    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email: id.email,
      password: id.password,
      email_confirm: true,
      // app_metadata is set at insert, so triggers that run on the new user already see the flag.
      app_metadata: { synthetic: true, synthetic_purpose: 'fresh_eyes' },
      user_metadata: { full_name: id.name, signup_source: 'fresh_eyes' },
    })
    const newId = created?.user?.id
    if (createErr || !newId) {
      flog.error('synthetic account not created', { err: createErr?.message })
      return jsonError(c, 'UPSTREAM_ERROR', 'The test account could not be created.', 502)
    }
    const rows = await Promise.all([
      db.from('synthetic_accounts').insert({ user_id: newId, email: id.email, purpose: 'fresh_eyes', created_by: userId, expires_at: id.expiresAt }),
      db.from('operator_users').upsert({ user_id: newId, note: `synthetic fresh-eyes account, expires ${id.expiresAt}` }, { onConflict: 'user_id' }),
    ])
    const failed = rows.find((r) => r.error)
    if (failed?.error) {
      // Never leave an unflagged account behind.
      await db.auth.admin.deleteUser(newId).catch(() => undefined)
      flog.error('synthetic account not flagged, deleted', { err: failed.error.message })
      return jsonError(c, 'DB_ERROR', 'The test account could not be flagged, so it was deleted again.', 500)
    }
    const selfProject = Deno.env.get('MUSHI_SELF_PROJECT_ID')
    if (selfProject) {
      await logAudit(db, selfProject, userId, 'fresh_eyes.account_created', 'auth_user', newId, { expires_at: id.expiresAt }, { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' })
    }
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true, data: { user_id: newId, email: id.email, password: id.password, name: id.name, expires_at: id.expiresAt } })
  })

  // ── CLI: upsert a run ─────────────────────────────────────────────────────
  app.put('/v1/admin/projects/:pid/fresh-eyes/:runId', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    if (!FRESH_EYES_RUN_ID_RE.test(localRunId)) return jsonError(c, 'VALIDATION_ERROR', 'Bad run id.')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot sync runs.', 403)
    const parsed = FreshEyesSnapshot.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))

    const { data: prior, error: priorErr } = await runRow(db, projectId, localRunId)
    if (priorErr) return dbError(c, priorErr)
    if (prior && (prior as { kind: string }).kind !== 'fresh_eyes') return jsonError(c, 'CONFLICT', 'That run id belongs to a UX loop run.', 409)
    const wasDone = (prior as { status?: string } | null)?.status === 'done'
    const now = new Date()
    const { data: saved, error } = await db
      .from('ux_runs')
      .upsert(freshEyesRunRow(parsed.data, { projectId, localRunId, userId, now }), { onConflict: 'project_id,local_run_id' })
      .select('id')
      .single()
    if (error) return dbError(c, error)

    // The trend: one row per metric per finished run, written once.
    const metrics = freshEyesMetricRows(parsed.data, { projectId, localRunId, wasDone })
    if (metrics.length) {
      const { data: have } = await db.from('metric_series').select('id').eq('project_id', projectId).like('metric_name', 'fresh_eyes.%').eq('dimension', localRunId).limit(1)
      if (!have?.length) {
        const { error: mErr } = await db.from('metric_series').insert(metrics)
        if (mErr) flog.warn('fresh-eyes metrics not written', { projectId, localRunId, err: mErr.message })
      }
    }
    return c.json({ ok: true, data: { id: (saved as { id: string }).id } })
  })

  // ── CLI: screenshot upload URLs ───────────────────────────────────────────
  app.post('/v1/admin/projects/:pid/fresh-eyes/:runId/uploads', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot sync runs.', 403)
    const body = (await c.req.json().catch(() => null)) as { names?: unknown } | null
    const names = Array.isArray(body?.names) ? body!.names.filter((n): n is string => typeof n === 'string') : []
    if (!names.length || names.length > 60) return jsonError(c, 'VALIDATION_ERROR', 'Send { names: ["s1-step00.png", …] } (1 to 60).')
    const { data: run, error } = await runRow(db, projectId, localRunId)
    if (error) return dbError(c, error)
    if (!run || (run as { kind: string }).kind !== 'fresh_eyes') return jsonError(c, 'NOT_FOUND', 'Sync the run (PUT) before uploading its screenshots.', 404)
    const uploads: Array<{ name: string; signedUrl: string }> = []
    for (const name of names) {
      const path = freshEyesShotPath(projectId, (run as { id: string }).id, name)
      if (!path) return jsonError(c, 'VALIDATION_ERROR', `Bad screenshot name "${name.slice(0, 80)}"`)
      const { data, error: signErr } = await db.storage.from(UX_CAPTURES_BUCKET).createSignedUploadUrl(path, { upsert: true })
      if (signErr || !data) return jsonError(c, 'UPSTREAM_ERROR', 'Could not mint an upload URL. Retry in a moment.', 502)
      uploads.push({ name, signedUrl: data.signedUrl })
    }
    return c.json({ ok: true, data: { uploads } })
  })

  // ── CLI: file one finding ─────────────────────────────────────────────────
  app.post('/v1/admin/projects/:pid/fresh-eyes/:runId/findings', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    if (!FRESH_EYES_RUN_ID_RE.test(localRunId)) return jsonError(c, 'VALIDATION_ERROR', 'Bad run id.')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot file reports.', 403)
    const parsed = FreshEyesFindingBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    const f = parsed.data

    const { data: run, error: runErr } = await runRow(db, projectId, localRunId)
    if (runErr) return dbError(c, runErr)
    if (!run || (run as { kind: string }).kind !== 'fresh_eyes') return jsonError(c, 'NOT_FOUND', 'Sync the run (PUT) before filing its findings.', 404)

    // Dedupe: an open or dismissed report with this fingerprint holds it.
    const { data: earlier, error: exErr } = await db
      .from('reports')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('source', 'fresh_eyes')
      .eq('custom_metadata->>fresh_eyes_fingerprint', f.fingerprint)
      .order('created_at', { ascending: false })
      .limit(1)
    if (exErr) return dbError(c, exErr)
    const prior = ((earlier ?? []) as Array<{ id: string; status: string }>)[0]
    if (prior && blocksRefile(prior.status)) return c.json({ ok: true, data: { reportId: null, duplicateOf: prior.id } })

    // A run files at most FRESH_EYES_FILE_CAP reports.
    const { count: filedThisRun, error: capErr } = await db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('source', 'fresh_eyes')
      .eq('custom_metadata->>run', localRunId)
    if (capErr) return dbError(c, capErr)
    if ((filedThisRun ?? 0) >= FRESH_EYES_FILE_CAP) return jsonError(c, 'RUN_CAP', `A run files at most ${FRESH_EYES_FILE_CAP} reports.`, 429)

    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: projectId,
      p_scope: FILE_REPORT_RATE_SCOPE,
      p_max_per_window: FILED_REPORTS_PER_HOUR,
      p_window: '1 hour',
    })
    if (rateErr) {
      const limited = (rateErr.message ?? '').includes('rate_limit_exceeded')
      return jsonError(c, limited ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE', limited ? `This app already had ${FILED_REPORTS_PER_HOUR} reports filed in the last hour.` : 'The finding was not filed. Retry in a moment.', limited ? 429 : 503)
    }
    const quota = await checkIngestQuota(db, projectId)
    if (!quota.allowed) return jsonError(c, 'QUOTA_EXCEEDED', `${quota.plan.display_name} plan quota of reports this month is used up.`, 402)

    const reportId = crypto.randomUUID()
    const { error: insErr } = await db.from('reports').insert(freshEyesReportRow(f, { reportId, projectId, actorId: userId, localRunId, now: new Date() }))
    if (insErr) return dbError(c, insErr)
    await queueReportClassification(db, reportId, projectId)
    await db.from('usage_events').insert({ project_id: projectId, event_name: 'reports_ingested', quantity: 1, metadata: { report_id: reportId, source: 'fresh_eyes' } }).then(({ error }) => {
      if (error) flog.warn('usage event insert failed', { reportId, err: error.message })
    })
    await logAudit(db, projectId, userId, 'report.created', 'report', reportId, { source: 'fresh_eyes', run: localRunId, rule: f.rule, basis: f.basis }, { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' })
    return c.json({ ok: true, data: { reportId, duplicateOf: null } })
  })

  // ── Console: runs and the trend ───────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/fresh-eyes', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    const since = new Date(Date.now() - TREND_DAYS * 86_400_000).toISOString()
    const [runs, trend] = await Promise.all([
      db
        .from('ux_runs')
        .select('local_run_id, status, model, goal, start_url, ttfv_seconds, steps, reached, stalled_at, findings, dry_run, has_account, counts, started_at, finished_at')
        .eq('project_id', projectId)
        .eq('kind', 'fresh_eyes')
        .order('started_at', { ascending: false })
        .limit(30),
      db.from('metric_series').select('metric_name, dimension, value, ts').eq('project_id', projectId).in('metric_name', ['fresh_eyes.ttfv_seconds', 'fresh_eyes.steps']).gte('ts', since).order('ts', { ascending: true }).limit(400),
    ])
    if (runs.error) return dbError(c, runs.error)
    if (trend.error) return dbError(c, trend.error)
    return c.json({ ok: true, data: { runs: runs.data ?? [], trend: trend.data ?? [] } })
  })

  // ── Console: one run ──────────────────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/fresh-eyes/:runId', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    if (!FRESH_EYES_RUN_ID_RE.test(localRunId)) return jsonError(c, 'VALIDATION_ERROR', 'Bad run id.')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    const { data: run, error } = await db
      .from('ux_runs')
      .select('id, local_run_id, status, model, goal, start_url, timeline, ttfv_seconds, steps, reached, stalled_at, findings, dry_run, has_account, started_at, finished_at')
      .eq('project_id', projectId)
      .eq('local_run_id', localRunId)
      .eq('kind', 'fresh_eyes')
      .maybeSingle()
    if (error) return dbError(c, error)
    if (!run) return jsonError(c, 'NOT_FOUND', 'No such fresh-eyes run.', 404)
    const r = run as { id: string; timeline: Array<{ steps?: Array<{ shot?: string | null }> }> | null }
    const names = [...new Set((r.timeline ?? []).flatMap((s) => (s.steps ?? []).map((st) => st.shot).filter((x): x is string => !!x)))]
    const shots: Record<string, string> = {}
    const paths = names.map((n) => freshEyesShotPath(projectId, r.id, n)).filter((p): p is string => !!p)
    if (paths.length) {
      const { data: signed } = await db.storage.from(UX_CAPTURES_BUCKET).createSignedUrls(paths, READ_URL_TTL_SEC)
      for (const s of signed ?? []) if (s.path && s.signedUrl) shots[s.path.split('/').pop()!] = s.signedUrl
    }
    const { data: reports, error: repErr } = await db
      .from('reports')
      .select('id, title, status, severity, created_at')
      .eq('project_id', projectId)
      .eq('source', 'fresh_eyes')
      .eq('custom_metadata->>run', localRunId)
      .order('created_at', { ascending: true })
      .limit(FRESH_EYES_FILE_CAP)
    if (repErr) return dbError(c, repErr)
    const { id: _id, ...rest } = run as Record<string, unknown>
    return c.json({ ok: true, data: { run: rest, shots, reports: reports ?? [] } })
  })
}
