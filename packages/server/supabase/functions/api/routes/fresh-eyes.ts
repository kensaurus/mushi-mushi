/**
 * FILE: packages/server/supabase/functions/api/routes/fresh-eyes.ts
 * PURPOSE: Fresh-eyes runs (ADR 0053), served by `api-ext` (deploy size limit;
 *          `api` forwards these paths).
 *
 *   POST /v1/admin/fresh-eyes/test-account                — operator: mint a synthetic account (password returned once)
 *   POST /v1/admin/projects/:pid/fresh-eyes               — console Run now: queue a run for a local worker
 *   POST /v1/admin/projects/:pid/fresh-eyes/:runId/cancel — console session: cancel a run no computer took yet
 *   PUT  /v1/admin/projects/:pid/fresh-eyes/:runId        — CLI: upsert a run (ux_runs, kind fresh_eyes)
 *   POST /v1/admin/projects/:pid/fresh-eyes/:runId/uploads — CLI: signed upload URLs for its screenshots
 *   POST /v1/admin/projects/:pid/fresh-eyes/:runId/findings — CLI: file one finding as a `fresh_eyes` report
 *   GET  /v1/admin/projects/:pid/fresh-eyes               — runs, the time-to-first-value trend, the
 *                                                           defaults for Run now and whether a computer can take it
 *   GET  /v1/admin/projects/:pid/fresh-eyes/:runId        — one run: timeline, screenshot URLs, filed reports
 *
 * The CLI authenticates with an mcp:write key; the console with its JWT. A
 * local worker's key (worker:run, ADR 0053 amendment 2026-10-28) reaches the
 * three CLI routes only for the run its own machine holds an active claim on.
 * Every project route checks the caller can access the project; writes go
 * through the service client (members only have SELECT on ux_runs).
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { isOperatorUser, requireOperator } from '../../_shared/operator-gate.ts'
import { checkIngestQuota } from '../../_shared/quota.ts'
import { queueReportClassification } from '../../_shared/report-classification.ts'
import { FILE_REPORT_RATE_SCOPE, FILED_REPORTS_PER_HOUR } from '../../_shared/report-file.ts'
import { UX_CAPTURES_BUCKET } from '../../_shared/ux-runs.ts'
import { isWorkerOnlyKey } from '../../_shared/work-claims.ts'
import { mintSyntheticAccount } from '../../_shared/synthetic-accounts.ts'
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
} from '../../_shared/fresh-eyes.ts'
import {
  ACCOUNT_GRANT_MS,
  canUseTestAccount,
  DEFAULT_FRESH_EYES_GOAL,
  defaultStartUrl,
  FRESH_EYES_OPEN_MAX,
  FRESH_EYES_QUEUE_RATE_SCOPE,
  FRESH_EYES_QUEUED_PER_HOUR,
  FRESH_EYES_QUEUED_TTL_MS,
  FRESH_EYES_SESSIONS_DEFAULT,
  freshEyesRunner,
  MUSHI_FRESH_EYES_GOAL,
  newLocalRunId,
  parseFreshEyesRequest,
  QUEUED_EXPIRED_DETAIL,
  runnerRefusal,
  type Runner,
  type RunnerHost,
  type RunnerLane,
} from '../../_shared/fresh-eyes-queue.ts'
import { callerCanAccessProject, dbError, jsonError } from '../shared.ts'

const flog = log.child('fresh-eyes')
const READ_URL_TTL_SEC = 3600
const TREND_DAYS = 90

type Db = ReturnType<typeof getServiceClient>

async function runRow(db: Db, projectId: string, localRunId: string) {
  return db.from('ux_runs').select('id, kind, status').eq('project_id', projectId).eq('local_run_id', localRunId).maybeSingle()
}

/**
 * Whether a computer of the user's can take a first-time user test of this
 * app now (freshEyesRunner). `{ error }` on a failed read; a missing worker
 * table means no worker.
 */
async function readRunner(db: Db, projectId: string, now: Date): Promise<{ runner: Runner } | { error: { message: string; code?: string } }> {
  const { data: lanes, error } = await db.from('work_lanes').select('host_id, mode, paused, drain, stop_at, concurrency').eq('project_id', projectId)
  if (error) {
    if (['42P01', 'PGRST205'].includes((error as { code?: string }).code ?? '')) return { runner: freshEyesRunner([], [], new Map(), now) }
    return { error }
  }
  const laneRows = (lanes ?? []) as RunnerLane[]
  const hostIds = [...new Set(laneRows.map((l) => l.host_id))]
  if (hostIds.length === 0) return { runner: freshEyesRunner([], [], new Map(), now) }
  const [hosts, claims] = await Promise.all([
    db.from('work_hosts').select('id, hostname, last_heartbeat_at, revoked_at, takes').in('id', hostIds),
    db.from('work_claims').select('host_id').in('host_id', hostIds).eq('status', 'active').gt('lease_until', now.toISOString()),
  ])
  if (hosts.error) return { error: hosts.error }
  if (claims.error) return { error: claims.error }
  const active = new Map<string, number>()
  for (const c of (claims.data ?? []) as Array<{ host_id: string }>) active.set(c.host_id, (active.get(c.host_id) ?? 0) + 1)
  return { runner: freshEyesRunner(laneRows, (hosts.data ?? []) as RunnerHost[], active, now) }
}

/** The app's own address as Mushi already knows it: the live-site watch, the site audit, the crawler setting. */
async function knownAddresses(db: Db, projectId: string): Promise<{ siteWatch: string | null; siteAudit: string | null; crawler: string | null }> {
  const [watch, audit, settings] = await Promise.all([
    db.from('site_watches').select('base_url').eq('project_id', projectId).maybeSingle(),
    db.from('site_audits').select('base_url').eq('project_id', projectId).maybeSingle(),
    db.from('project_settings').select('crawler_base_url').eq('project_id', projectId).maybeSingle(),
  ])
  return {
    siteWatch: (watch.data as { base_url?: string } | null)?.base_url ?? null,
    siteAudit: (audit.data as { base_url?: string } | null)?.base_url ?? null,
    crawler: (settings.data as { crawler_base_url?: string | null } | null)?.crawler_base_url ?? null,
  }
}

/**
 * For a local worker's key (worker:run without mcp:write): a 403 unless its
 * own machine (work_hosts with this key, not revoked) holds an active,
 * unexpired fresh_eyes claim on this run. Null for every other caller.
 */
async function workerRunDenial(c: Context, db: Db, projectId: string, localRunId: string): Promise<Response | null> {
  if (!isWorkerOnlyKey(c)) return null
  const deny = (message: string, status: 403 | 503 = 403) => jsonError(c, 'NO_WORK_CLAIM', message, status)
  const keyId = c.get('apiKeyId') as string | undefined
  if (!keyId || !FRESH_EYES_RUN_ID_RE.test(localRunId)) return deny('A worker key syncs only a test it claimed.')
  const { data: run, error } = await db.from('ux_runs').select('id').eq('project_id', projectId).eq('local_run_id', localRunId).eq('kind', 'fresh_eyes').maybeSingle()
  if (error) return deny('Could not read the run. Try again in a minute.', 503)
  if (!run) return deny('A worker key syncs only a test it claimed.')
  const { data: claims, error: claimErr } = await db
    .from('work_claims')
    .select('id, host_id')
    .eq('ux_run_id', (run as { id: string }).id)
    .eq('kind', 'fresh_eyes')
    .eq('status', 'active')
    .gt('lease_until', new Date().toISOString())
    .limit(1)
  if (claimErr) return deny('Could not read the worker claim. Try again in a minute.', 503)
  const claim = ((claims ?? []) as Array<{ id: string; host_id: string }>)[0]
  if (!claim) return deny('This worker holds no active claim on that test (the lease ran out, or it ended).')
  const { data: host, error: hostErr } = await db.from('work_hosts').select('id').eq('id', claim.host_id).eq('api_key_id', keyId).is('revoked_at', null).maybeSingle()
  if (hostErr) return deny('Could not read the worker claim. Try again in a minute.', 503)
  if (!host) return deny('Another worker holds the claim on that test.')
  return null
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

    const minted = await mintSyntheticAccount(db, userId, new Date(), Deno.env.get('MUSHI_FRESH_EYES_EMAIL_DOMAIN'))
    if (!minted.ok) return jsonError(c, minted.code, minted.message, minted.status)
    const id = minted.account
    const selfProject = Deno.env.get('MUSHI_SELF_PROJECT_ID')
    if (selfProject) {
      await logAudit(db, selfProject, userId, 'fresh_eyes.account_created', 'auth_user', id.userId, { expires_at: id.expiresAt }, { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' })
    }
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true, data: { user_id: id.userId, email: id.email, password: id.password, name: id.name, expires_at: id.expiresAt } })
  })

  // ── Console: queue a run for a local worker (Run now) ─────────────────────
  app.post('/v1/admin/projects/:pid/fresh-eyes', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot start tests.', 403)
    const parsed = parseFreshEyesRequest(await c.req.json().catch(() => null))
    if (!parsed.ok) return jsonError(c, 'VALIDATION_ERROR', parsed.message)
    const req = parsed.value
    const selfProjectId = Deno.env.get('MUSHI_SELF_PROJECT_ID')
    if (req.withAccount && !canUseTestAccount({ isOperator: isOperatorUser(userId), authMethod: c.get('authMethod') as string | undefined, projectId, selfProjectId })) {
      return jsonError(c, 'TEST_ACCOUNT_UNAVAILABLE', 'Test accounts can only be made for Mushi itself, by its operators, from the console.', 403)
    }
    const now = new Date()

    const runner = await readRunner(db, projectId, now)
    if ('error' in runner) return dbError(c, runner.error)
    const refusal = runnerRefusal(runner.runner)
    if (refusal) return c.json({ ok: false, error: { code: 'NO_WORKER', message: refusal }, data: { runner: runner.runner } }, 409)

    const { count: open, error: openErr } = await db
      .from('ux_runs')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('kind', 'fresh_eyes')
      .in('status', ['queued', 'running'])
    if (openErr) return dbError(c, openErr)
    if ((open ?? 0) >= FRESH_EYES_OPEN_MAX) return jsonError(c, 'ALREADY_RUNNING', `${FRESH_EYES_OPEN_MAX} tests of this app are already waiting or running. Wait for one to finish.`, 409)

    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: projectId,
      p_scope: FRESH_EYES_QUEUE_RATE_SCOPE,
      p_max_per_window: FRESH_EYES_QUEUED_PER_HOUR,
      p_window: '1 hour',
    })
    if (rateErr) {
      const limited = (rateErr.message ?? '').includes('rate_limit_exceeded')
      return jsonError(c, limited ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE', limited ? `At most ${FRESH_EYES_QUEUED_PER_HOUR} tests of one app an hour.` : 'The test was not started. Retry in a moment.', limited ? 429 : 503)
    }

    const localRunId = newLocalRunId(now, crypto.getRandomValues(new Uint8Array(4)))
    const { error } = await db.from('ux_runs').insert({
      project_id: projectId,
      local_run_id: localRunId,
      created_by: userId,
      requested_by: userId,
      kind: 'fresh_eyes',
      mode: 'local',
      agent: 'fresh-eyes',
      status: 'queued',
      goal: req.goal,
      start_url: req.url,
      sessions_requested: req.sessions,
      success_text: req.successText,
      dry_run: req.dryRun,
      has_account: req.withAccount,
      ...(req.withAccount ? { account_granted_by: userId, account_grant_until: new Date(now.getTime() + ACCOUNT_GRANT_MS).toISOString() } : {}),
      counts: { sessions: req.sessions },
      started_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    if (error) return dbError(c, error)
    await logAudit(db, projectId, userId, 'fresh_eyes.queued', 'ux_run', localRunId, { url: req.url, sessions: req.sessions, dry_run: req.dryRun, with_account: req.withAccount }, { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' })
    return c.json({ ok: true, data: { runId: localRunId, status: 'queued', runner: runner.runner } }, 201)
  })

  // ── Console: cancel a run no computer took yet ────────────────────────────
  app.post('/v1/admin/projects/:pid/fresh-eyes/:runId/cancel', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    if (!FRESH_EYES_RUN_ID_RE.test(localRunId)) return jsonError(c, 'VALIDATION_ERROR', 'Bad run id.')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot cancel tests.', 403)
    const now = new Date().toISOString()
    const { data, error } = await db
      .from('ux_runs')
      .update({ status: 'stopped', detail: 'Cancelled before a computer started it.', finished_at: now, updated_at: now, account_granted_by: null, account_grant_until: null })
      .eq('project_id', projectId)
      .eq('local_run_id', localRunId)
      .eq('kind', 'fresh_eyes')
      .eq('status', 'queued')
      .select('id')
    if (error) return dbError(c, error)
    if (!data || (data as unknown[]).length === 0) return jsonError(c, 'NOT_QUEUED', 'That test is not waiting any more: a computer already started it, or it ended.', 409)
    return c.json({ ok: true, data: { runId: localRunId, status: 'stopped' } })
  })

  // ── CLI: upsert a run ─────────────────────────────────────────────────────
  app.put('/v1/admin/projects/:pid/fresh-eyes/:runId', adminOrApiKey({ scope: ['mcp:write', 'worker:run'] }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    if (!FRESH_EYES_RUN_ID_RE.test(localRunId)) return jsonError(c, 'VALIDATION_ERROR', 'Bad run id.')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot sync runs.', 403)
    const claimDenied = await workerRunDenial(c, db, projectId, localRunId)
    if (claimDenied) return claimDenied
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
  app.post('/v1/admin/projects/:pid/fresh-eyes/:runId/uploads', adminOrApiKey({ scope: ['mcp:write', 'worker:run'] }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot sync runs.', 403)
    const claimDenied = await workerRunDenial(c, db, projectId, localRunId)
    if (claimDenied) return claimDenied
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
  app.post('/v1/admin/projects/:pid/fresh-eyes/:runId/findings', adminOrApiKey({ scope: ['mcp:write', 'worker:run'] }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const localRunId = c.req.param('runId')!
    if (!FRESH_EYES_RUN_ID_RE.test(localRunId)) return jsonError(c, 'VALIDATION_ERROR', 'Bad run id.')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot file reports.', 403)
    const claimDenied = await workerRunDenial(c, db, projectId, localRunId)
    if (claimDenied) return claimDenied
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
    const now = new Date()
    const since = new Date(now.getTime() - TREND_DAYS * 86_400_000).toISOString()
    // A run no computer took within a day stops here, with the reason.
    await db
      .from('ux_runs')
      .update({ status: 'stopped', detail: QUEUED_EXPIRED_DETAIL, finished_at: now.toISOString(), updated_at: now.toISOString(), account_granted_by: null, account_grant_until: null })
      .eq('project_id', projectId)
      .eq('kind', 'fresh_eyes')
      .eq('status', 'queued')
      .lt('started_at', new Date(now.getTime() - FRESH_EYES_QUEUED_TTL_MS).toISOString())
      .then(({ error }) => {
        if (error) flog.warn('stale queued runs not stopped', { projectId, err: error.message })
      })
    const [runs, trend, runner, known] = await Promise.all([
      db
        .from('ux_runs')
        .select('local_run_id, status, model, goal, start_url, ttfv_seconds, steps, reached, stalled_at, findings, dry_run, has_account, counts, started_at, finished_at, detail, sessions_requested, success_text')
        .eq('project_id', projectId)
        .eq('kind', 'fresh_eyes')
        .order('started_at', { ascending: false })
        .limit(30),
      db.from('metric_series').select('metric_name, dimension, value, ts').eq('project_id', projectId).in('metric_name', ['fresh_eyes.ttfv_seconds', 'fresh_eyes.steps']).gte('ts', since).order('ts', { ascending: true }).limit(400),
      readRunner(db, projectId, now),
      knownAddresses(db, projectId),
    ])
    if (runs.error) return dbError(c, runs.error)
    if (trend.error) return dbError(c, trend.error)
    const rows = (runs.data ?? []) as Array<{ start_url: string | null; goal: string | null }>
    const selfProjectId = Deno.env.get('MUSHI_SELF_PROJECT_ID')
    const isMushi = !!selfProjectId && selfProjectId.toLowerCase() === projectId.toLowerCase()
    const start = defaultStartUrl({ ...known, lastRun: rows.find((r) => r.start_url)?.start_url ?? null, isMushi })
    return c.json({
      ok: true,
      data: {
        runs: rows,
        trend: trend.data ?? [],
        defaults: {
          url: start?.url ?? null,
          urlSource: start?.source ?? null,
          goal: rows.find((r) => r.goal)?.goal ?? (isMushi ? MUSHI_FRESH_EYES_GOAL : DEFAULT_FRESH_EYES_GOAL),
          sessions: FRESH_EYES_SESSIONS_DEFAULT,
        },
        canUseTestAccount: canUseTestAccount({ isOperator: isOperatorUser(userId), authMethod: c.get('authMethod') as string | undefined, projectId, selfProjectId }),
        // A failed worker read shows as "unknown", never as "no computer".
        runner: 'error' in runner ? null : runner.runner,
      },
    })
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
      .select('id, local_run_id, status, model, goal, start_url, timeline, ttfv_seconds, steps, reached, stalled_at, findings, dry_run, has_account, counts, started_at, finished_at, detail, sessions_requested, success_text')
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
