/**
 * ci.ts — CI runners you can see (Plan 022, ADR 0033).
 *
 *   POST /v1/ingest/runner               apiKeyAuth + scope runner:write, 60/min.
 *        A claim RPC failure (statement timeout included) is 503
 *        RATE_LIMIT_UNAVAILABLE — the cap fails closed, it does not lift.
 *        `mushi runner heartbeat` (kind 'heartbeat') and the runner job hooks
 *        (kind 'job'). Host ids arrive hashed; raw machine ids are refused.
 *        Only a runner:write key: the public SDK key (report:write, shipped in
 *        app bundles) could otherwise forge hosts and memory figures, and an
 *        mcp:write key must not sit on a runner, where CI jobs run as the
 *        same user and could read it. runner:write unlocks nothing else.
 *   POST /v1/admin/projects/:id/runner-key  adminOrApiKey(mcp:write), non-viewers, 10/h
 *        Mints a NEW project key with scopes exactly ['runner:write'] (label
 *        `runner:<label>`) and returns the plaintext once.
 *   GET  /v1/admin/ci/overview           adminOrApiKey(mcp:read)
 *        ?project_id=&days=7&refresh=1 — hosts → runners → repos → live jobs,
 *        stats and advice (CiOverview in _shared/ci-overview-types.ts). With
 *        project_id: that project. Without: every project the caller can
 *        read (a console session or an account key); a project-bound key
 *        always reads its own project. refresh=1 first runs a live sync
 *        (queued / running / just-finished runs, once a minute per project,
 *        ≤ 12 GitHub calls).
 *   GET  /v1/admin/ci/compare            adminOrApiKey(mcp:read)
 *        ?project_id=&days=30 — cost and speed per repo × runner class, why
 *        it costs what it costs, what-ifs and cost advice (CiCompare in
 *        _shared/ci-compare-types.ts; Plan 022 Phase 7, ADR 0037). Same
 *        scoping as the overview. Read-only: nothing is written to GitHub.
 *   GET  /v1/admin/ci/cost-settings      jwtAuth (console; MCP and the CLI read the figures in /compare)
 *        ?organization_id= | ?project_id= — the organization's cost figures
 *        (example figures until saved) and whether the caller may edit them.
 *   PUT  /v1/admin/ci/cost-settings      jwtAuth (console only), non-viewers
 *        Saves the figures (zod bounds), audited as settings.updated. 409
 *        MIGRATION_PENDING until ci_cost_settings exists.
 *   POST /v1/admin/fixes/:id/ci/rerun    adminOrApiKey(mcp:write), non-viewers
 *        Re-runs the failed / cancelled jobs on the fix PR's head
 *        (POST /actions/runs/{id}/rerun-failed-jobs). 409 CI_RUNNING while
 *        its CI still runs; 403 GITHUB_ACTIONS_WRITE_MISSING when the token
 *        cannot write Actions. Records a "Re-ran tests" fix event.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, apiKeyAuth, jwtAuth, requireApiKeyScope } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { runnerIngestSchema } from '../../_shared/schemas.ts'
import { mintProjectApiKey } from '../../_shared/api-key-mint.ts'
import { logAudit } from '../../_shared/audit.ts'
import { claimTenantRateLimit, logOrgAudit } from '../../_shared/tenant-observability.ts'
import { buildCiCompare } from '../../_shared/ci-compare.ts'
import { isMissingObject, loadCiCompareInput } from '../../_shared/ci-compare-load.ts'
import { COST_BOUNDS, COST_PLANS, costSettingsRow, normalizeCostSettings, type CostSettingsRow } from '../../_shared/ci-cost.ts'
import {
  fetchPullRequest,
  installationIdForAttempt,
  parseGithubRepoUrl,
  prNumberFromUrl,
  resolveProjectGithubToken,
} from '../../_shared/github.ts'
import { liveSyncProjects, type CollectorDeps } from '../../_shared/ci-collector.ts'
import { buildCiOverview, loadCiOverviewRows } from '../../_shared/ci-overview.ts'
import { ciGithub, listRunsForHeadSha, rerunFailedJobs, RERUN_REFUSED_DEDUPE_PREFIX, type CiGithub } from '../../_shared/ci-jobs.ts'
import { callerCanAccessProject, callerProjectIds, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const clog = log.child('ci-routes')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const RUNNER_INGEST_PER_MINUTE = 60
export const CI_RERUNS_PER_HOUR = 6
export const RUNNER_KEY_MINTS_PER_HOUR = 10
/** The only scope a runner key carries. */
export const RUNNER_KEY_SCOPES = ['runner:write'] as const
/** A job sample may be at most this far in the future (clock skew) or the past. */
const SAMPLE_FUTURE_MS = 10 * 60_000
const SAMPLE_PAST_MS = 7 * 24 * 60 * 60_000
const RERUN_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure'])

type Db = ReturnType<typeof getServiceClient>

export interface CiRouteDeps {
  getServiceClient: () => Db
  apiKeyAuth: MiddlewareHandler
  /** After apiKeyAuth on the runner ingest: the key must carry runner:write. */
  requireRunnerScope: MiddlewareHandler
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  /** Console session only (cost settings writes). */
  jwtAuth: MiddlewareHandler
  claimRateLimit: typeof claimTenantRateLimit
  callerProjectIds: typeof callerProjectIds
  callerCanAccessProject: typeof callerCanAccessProject
  collector: CollectorDeps
  /** A GitHub token for a fix attempt's repository (App installation first, then the project's token). */
  resolveAttemptToken: (db: Db, attempt: { project_id: string; repo_id?: string | null; pr_url?: string | null }) => Promise<string | null>
  fetchPullRequest: typeof fetchPullRequest
  mintKey: typeof mintProjectApiKey
  logAudit: typeof logAudit
  logOrgAudit: typeof logOrgAudit
  fetchImpl?: CiGithub['fetchImpl']
  now: () => Date
}

export const defaultCiRouteDeps: CiRouteDeps = {
  getServiceClient,
  apiKeyAuth: apiKeyAuth as MiddlewareHandler,
  requireRunnerScope: requireApiKeyScope('runner:write') as MiddlewareHandler,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  claimRateLimit: claimTenantRateLimit,
  callerProjectIds,
  callerCanAccessProject,
  collector: {
    resolveToken: (db, projectId, installationId) => resolveProjectGithubToken(db as never, projectId, installationId),
    now: () => new Date(),
  },
  resolveAttemptToken: async (db, attempt) =>
    resolveProjectGithubToken(db, attempt.project_id, await installationIdForAttempt(db, attempt)),
  fetchPullRequest,
  mintKey: mintProjectApiKey,
  logAudit,
  logOrgAudit,
  now: () => new Date(),
}

export function registerCiRoutes(app: Hono<{ Variables: Variables }>, deps: CiRouteDeps = defaultCiRouteDeps): void {
  app.post('/v1/ingest/runner', deps.apiKeyAuth, deps.requireRunnerScope, (c) => ingestRunner(c, deps))
  app.post('/v1/admin/projects/:id/runner-key', deps.adminOrApiKeyWrite, (c) => mintRunnerKey(c, deps))
  app.get('/v1/admin/ci/overview', deps.adminOrApiKeyRead, (c) => ciOverview(c, deps))
  app.get('/v1/admin/ci/compare', deps.adminOrApiKeyRead, (c) => ciCompare(c, deps))
  app.get('/v1/admin/ci/cost-settings', deps.jwtAuth, (c) => getCostSettings(c, deps))
  app.put('/v1/admin/ci/cost-settings', deps.jwtAuth, (c) => putCostSettings(c, deps))
  app.post('/v1/admin/fixes/:id/ci/rerun', deps.adminOrApiKeyWrite, (c) => rerunFixCi(c, deps))
}

async function ingestRunner(c: Context, deps: CiRouteDeps): Promise<Response> {
  const projectId = c.get('projectId') as string | null | undefined
  if (!projectId) return jsonError(c, 'PROJECT_KEY_REQUIRED', 'Use a key bound to a project (Projects → SDK ingest key).', 400)
  const db = deps.getServiceClient()
  const rate = await deps.claimRateLimit(db, `project:${projectId}:runner_ingest`, RUNNER_INGEST_PER_MINUTE, 60)
  if (rate.unavailable) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 30))
    return jsonError(c, 'RATE_LIMIT_UNAVAILABLE', 'Runner pushes are paused for a moment. Retry shortly.', 503)
  }
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 60))
    return jsonError(c, 'RATE_LIMITED', 'Too many runner pushes. Retry in a minute.', 429)
  }
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return jsonError(c, 'INVALID_JSON', 'Body must be valid JSON', 400)
  }
  const parsed = runnerIngestSchema.safeParse(raw)
  if (!parsed.success) {
    return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
  }
  const body = parsed.data

  const { data: project, error: projectErr } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  if (projectErr) return jsonError(c, 'DB_ERROR', 'Could not read the project.', 500)
  const organizationId = (project as { organization_id: string | null } | null)?.organization_id ?? null
  if (!organizationId) return jsonError(c, 'NO_ORGANIZATION', 'This project belongs to no organization, so runner data has nowhere to go.', 409)

  const now = deps.now()
  if (body.kind === 'heartbeat') {
    const h = body.host
    const { error } = await db.from('ci_runner_hosts').upsert(
      {
        organization_id: organizationId,
        project_id: projectId,
        host_id: h.host_id,
        hostname: h.hostname,
        platform: h.platform,
        cpu_count: h.cpu_count ?? null,
        mem_total_mb: h.mem_total_mb ?? null,
        mushi_version: h.mushi_version ?? null,
        metrics: h.metrics ?? {},
        runners: body.runners,
        // Server time: a host with a wrong clock must not look fresh or stale.
        last_heartbeat_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: 'organization_id,host_id' },
    )
    if (error) {
      clog.error('runner heartbeat upsert failed', { projectId, err: error.message })
      return jsonError(c, 'DB_ERROR', 'The heartbeat could not be stored.', 500)
    }
    return c.json({ ok: true, data: { kind: 'heartbeat', hostId: h.host_id, runners: body.runners.length, receivedAt: now.toISOString() } })
  }

  const at = Date.parse(body.at)
  if (at > now.getTime() + SAMPLE_FUTURE_MS || at < now.getTime() - SAMPLE_PAST_MS) {
    return jsonError(c, 'SAMPLE_OUT_OF_RANGE', '`at` must be within the last 7 days (and not in the future).', 400)
  }
  const { error } = await db.from('ci_runner_job_samples').upsert(
    {
      organization_id: organizationId,
      project_id: projectId,
      host_id: body.host_id,
      runner_name: body.runner_name,
      repo: body.repo,
      run_id: body.run_id,
      run_attempt: body.run_attempt,
      job_key: body.job_key,
      phase: body.phase,
      at: new Date(at).toISOString(),
      mem_peak_mb: body.mem_peak_mb ?? null,
      mem_max_mb: body.mem_max_mb ?? null,
      oom_kills: body.oom_kills ?? null,
      swap_used_mb: body.swap_used_mb ?? null,
      load1: body.load1 ?? null,
    },
    { onConflict: 'organization_id,host_id,job_key,phase', ignoreDuplicates: true },
  )
  if (error) {
    clog.error('runner job sample insert failed', { projectId, err: error.message })
    return jsonError(c, 'DB_ERROR', 'The job sample could not be stored.', 500)
  }
  return c.json({ ok: true, data: { kind: 'job', jobKey: body.job_key, phase: body.phase } })
}

async function mintRunnerKey(c: Context, deps: CiRouteDeps): Promise<Response> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const access = await deps.callerCanAccessProject(c, db, userId, projectId)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
  const viewer = denyViewerWrite(c, access.role, 'mint a runner key')
  if (viewer) return viewer

  const body = (await c.req.json().catch(() => ({}))) as { label?: unknown }
  const raw = typeof body.label === 'string' ? body.label.trim() : ''
  // Keep labels plain: they show in the key list and audit log.
  const label = (raw.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'host').slice(0, 56)

  const rate = await deps.claimRateLimit(db, `project:${projectId}:runner_key_mint`, RUNNER_KEY_MINTS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `At most ${RUNNER_KEY_MINTS_PER_HOUR} runner keys an hour per project.`, 429)
  }

  // A narrower key derived from a wider one: the caller already holds
  // mcp:write (or a console session); the new key can only push runner data.
  const mint = await deps.mintKey(db, { projectId, label: `runner:${label}`, scopes: RUNNER_KEY_SCOPES })
  if (!mint.ok) {
    clog.error('runner key mint failed', { projectId, err: mint.error.message })
    return jsonError(c, 'DB_ERROR', 'The runner key could not be created.', 500)
  }
  void deps.logAudit(
    db,
    projectId,
    userId,
    'api_key.created',
    'project_api_key',
    mint.minted.id ?? undefined,
    { source: 'runner_key', scopes: [...RUNNER_KEY_SCOPES], key_prefix: mint.minted.prefix, label: `runner:${label}` },
    { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' },
  )
  return c.json(
    {
      ok: true,
      data: {
        id: mint.minted.id,
        // Shown once; Mushi keeps only its hash.
        key: mint.minted.key,
        prefix: mint.minted.prefix,
        scopes: [...RUNNER_KEY_SCOPES],
        label: `runner:${label}`,
      },
    },
    201,
  )
}

async function ciOverview(c: Context, deps: CiRouteDeps): Promise<Response> {
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const requested = c.req.query('project_id') ?? c.req.query('projectId') ?? null
  if (requested && !UUID_RE.test(requested)) return jsonError(c, 'VALIDATION_ERROR', 'project_id must be a uuid', 400)
  const daysRaw = Number(c.req.query('days') ?? 7)
  const days = Number.isFinite(daysRaw) ? Math.min(30, Math.max(1, Math.round(daysRaw))) : 7
  const refresh = c.req.query('refresh') === '1' || c.req.query('refresh') === 'true'

  // Strict: a failed access read throws (500), never "no projects".
  const projectIds = await deps.callerProjectIds(c, db, userId)
  if (requested && !projectIds.includes(requested)) return jsonError(c, 'FORBIDDEN', 'You cannot read this project.', 403)
  const scope = requested ? [requested] : projectIds

  if (refresh && scope.length > 0) {
    try {
      await liveSyncProjects(db as never, { ...deps.collector, fetchImpl: deps.fetchImpl ?? deps.collector.fetchImpl, now: deps.now }, scope)
    } catch (err) {
      // The stored data still renders; the page says how fresh it is.
      clog.warn('ci live sync failed', { err: err instanceof Error ? err.message : String(err) })
    }
  }

  const now = deps.now()
  const from = new Date(now.getTime() - days * 24 * 60 * 60_000)
  try {
    const rows = await loadCiOverviewRows(db as never, scope, from)
    return c.json({ ok: true, data: buildCiOverview(rows, { now, days, from, refreshedAt: rows.lastLiveSyncAt }) })
  } catch (err) {
    clog.error('ci overview read failed', { err: err instanceof Error ? err.message : String(err) })
    return jsonError(c, 'CI_OVERVIEW_FAILED', 'The CI overview could not be read. Try again in a minute.', 500)
  }
}

async function ciCompare(c: Context, deps: CiRouteDeps): Promise<Response> {
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const requested = c.req.query('project_id') ?? c.req.query('projectId') ?? null
  if (requested && !UUID_RE.test(requested)) return jsonError(c, 'VALIDATION_ERROR', 'project_id must be a uuid', 400)
  const daysRaw = Number(c.req.query('days') ?? 30)
  const days = Number.isFinite(daysRaw) ? Math.min(30, Math.max(1, Math.round(daysRaw))) : 30
  const projectIds = await deps.callerProjectIds(c, db, userId)
  if (requested && !projectIds.includes(requested)) return jsonError(c, 'FORBIDDEN', 'You cannot read this project.', 403)
  const scope = requested ? [requested] : projectIds
  const now = deps.now()
  const from = new Date(now.getTime() - days * 24 * 60 * 60_000)
  try {
    const loaded = await loadCiCompareInput(db as never, scope, from, now)
    return c.json({ ok: true, data: buildCiCompare({ ...loaded, now, days, from, to: now }) })
  } catch (err) {
    clog.error('ci compare failed', { err: err instanceof Error ? err.message : String(err) })
    return jsonError(c, 'CI_COMPARE_FAILED', 'The CI cost comparison could not be read. Try again in a minute.', 500)
  }
}

const costMachineSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    runners: z.array(z.string().trim().min(1).max(100)).min(1).max(COST_BOUNDS.machineRunners),
    wattsIdle: z.number().min(COST_BOUNDS.watts.min).max(COST_BOUNDS.watts.max).nullable().optional(),
    wattsLoad: z.number().min(COST_BOUNDS.watts.min).max(COST_BOUNDS.watts.max).nullable().optional(),
  })
  .strict()

export const costSettingsSchema = z
  .object({
    organizationId: z.string().uuid(),
    currency: z.string().regex(/^[A-Z]{3}$/, 'a 3-letter currency code, e.g. USD'),
    fxPerUsd: z.number().min(COST_BOUNDS.fxPerUsd.min).max(COST_BOUNDS.fxPerUsd.max),
    wattsIdle: z.number().min(COST_BOUNDS.watts.min).max(COST_BOUNDS.watts.max),
    wattsLoad: z.number().min(COST_BOUNDS.watts.min).max(COST_BOUNDS.watts.max),
    pricePerKwh: z.number().min(COST_BOUNDS.pricePerKwh.min).max(COST_BOUNDS.pricePerKwh.max),
    wearPerHour: z.number().min(COST_BOUNDS.wearPerHour.min).max(COST_BOUNDS.wearPerHour.max),
    plan: z.enum(COST_PLANS),
    includedMinutes: z.number().int().min(COST_BOUNDS.includedMinutes.min).max(COST_BOUNDS.includedMinutes.max),
    selfHostedFeePerMinuteUsd: z.number().min(COST_BOUNDS.selfHostedFeePerMinuteUsd.min).max(COST_BOUNDS.selfHostedFeePerMinuteUsd.max),
    machines: z.array(costMachineSchema).max(COST_BOUNDS.machines),
  })
  .strict()
  .refine((v) => v.wattsLoad >= v.wattsIdle, { message: 'must be at least the idle draw', path: ['wattsLoad'] })

/** The organizations of the projects the caller can read, with names. */
async function callerOrgs(c: Context, deps: CiRouteDeps, db: Db, userId: string): Promise<Array<{ id: string; name: string | null }>> {
  const projectIds = await deps.callerProjectIds(c, db, userId)
  if (projectIds.length === 0) return []
  const { data, error } = await db.from('projects').select('organization_id, organizations(name)').in('id', projectIds)
  if (error) throw new Error(`projects read failed: ${error.message}`)
  const out = new Map<string, string | null>()
  for (const p of (data ?? []) as Array<{ organization_id: string | null; organizations?: { name?: string | null } | null }>) {
    if (p.organization_id && !out.has(p.organization_id)) out.set(p.organization_id, p.organizations?.name ?? null)
  }
  return [...out.entries()].map(([id, name]) => ({ id, name }))
}

/** Pick the organization: ?organization_id=, else ?project_id='s, else the caller's only one. */
async function resolveCostOrg(c: Context, deps: CiRouteDeps, db: Db, userId: string, requestedOrg: string | null): Promise<{ orgId: string } | { response: Response }> {
  let orgs: Array<{ id: string; name: string | null }>
  try {
    orgs = await callerOrgs(c, deps, db, userId)
  } catch {
    return { response: jsonError(c, 'DB_ERROR', 'Could not read your organizations.', 500) }
  }
  const projectId = c.req.query('project_id') ?? c.req.query('projectId') ?? null
  if (requestedOrg) {
    if (!UUID_RE.test(requestedOrg)) return { response: jsonError(c, 'VALIDATION_ERROR', 'organization_id must be a uuid', 400) }
    if (!orgs.some((o) => o.id === requestedOrg)) return { response: jsonError(c, 'FORBIDDEN', 'You cannot read this organization.', 403) }
    return { orgId: requestedOrg }
  }
  if (projectId) {
    if (!UUID_RE.test(projectId)) return { response: jsonError(c, 'VALIDATION_ERROR', 'project_id must be a uuid', 400) }
    const ids = await deps.callerProjectIds(c, db, userId)
    if (!ids.includes(projectId)) return { response: jsonError(c, 'FORBIDDEN', 'You cannot read this project.', 403) }
    const { data } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
    const org = (data as { organization_id: string | null } | null)?.organization_id
    if (!org) return { response: jsonError(c, 'NO_ORGANIZATION', 'This project belongs to no organization.', 409) }
    return { orgId: org }
  }
  if (orgs.length !== 1) {
    return {
      response: jsonError(c, 'ORG_REQUIRED', orgs.length === 0 ? 'You can read no organization.' : 'You belong to several organizations; pass organization_id.', 400, { organizations: orgs }),
    }
  }
  return { orgId: orgs[0].id }
}

async function orgRole(db: Db, orgId: string, userId: string): Promise<string | null> {
  const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  return (data as { role?: string } | null)?.role ?? null
}

async function getCostSettings(c: Context, deps: CiRouteDeps): Promise<Response> {
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const org = await resolveCostOrg(c, deps, db, userId, c.req.query('organization_id') ?? c.req.query('organizationId') ?? null)
  if ('response' in org) return org.response
  const { data, error } = await db.from('ci_cost_settings').select('*').eq('organization_id', org.orgId).maybeSingle()
  if (error && !isMissingObject(error)) return jsonError(c, 'DB_ERROR', 'Could not read the CI cost settings.', 500)
  const role = c.get('authMethod') === 'apiKey' ? null : await orgRole(db, org.orgId, userId)
  return c.json({
    ok: true,
    data: {
      settings: normalizeCostSettings(org.orgId, error ? null : ((data as CostSettingsRow | null) ?? null)),
      writable: !error,
      // Console members who are not viewers may edit; API keys never.
      canEdit: !error && role != null && role !== 'viewer',
      bounds: COST_BOUNDS,
      plans: COST_PLANS,
    },
  })
}

async function putCostSettings(c: Context, deps: CiRouteDeps): Promise<Response> {
  // jwtAuth already refused API keys; say so plainly if one slips through a test double.
  if (c.get('authMethod') === 'apiKey') return jsonError(c, 'CONSOLE_ONLY', 'CI cost settings are changed in the console, not with an API key.', 403)
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const parsed = costSettingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
  }
  const body = parsed.data
  const org = await resolveCostOrg(c, deps, db, userId, body.organizationId)
  if ('response' in org) return org.response
  const role = await orgRole(db, org.orgId, userId)
  if (!role) return jsonError(c, 'FORBIDDEN', 'You are not a member of this organization.', 403)
  const viewer = denyViewerWrite(c, role, 'change CI cost settings')
  if (viewer) return viewer

  const now = deps.now()
  const { organizationId: _org, ...figures } = body
  const row = costSettingsRow(org.orgId, figures, userId, now)
  const { data: prior, error: readErr } = await db.from('ci_cost_settings').select('*').eq('organization_id', org.orgId).maybeSingle()
  if (readErr) {
    if (isMissingObject(readErr)) return jsonError(c, 'MIGRATION_PENDING', 'CI cost settings can be saved once the database update 20261022050303_ci_cost_compare is applied.', 409)
    return jsonError(c, 'DB_ERROR', 'Could not read the CI cost settings.', 500)
  }
  // Snapshot before the write: the audit says which figures changed.
  const before = prior ? normalizeCostSettings(org.orgId, prior as CostSettingsRow) : null
  const { error } = await db.from('ci_cost_settings').upsert(row, { onConflict: 'organization_id' })
  if (error) {
    if (isMissingObject(error)) return jsonError(c, 'MIGRATION_PENDING', 'CI cost settings can be saved once the database update 20261022050303_ci_cost_compare is applied.', 409)
    clog.error('ci cost settings save failed', { orgId: org.orgId, err: error.message })
    return jsonError(c, 'DB_ERROR', 'The CI cost settings could not be saved.', 500)
  }
  const after = normalizeCostSettings(org.orgId, { ...row, updated_at: now.toISOString() })
  const changed = before
    ? (Object.keys(figures) as Array<keyof typeof figures>).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    : Object.keys(figures)
  void deps.logOrgAudit(db as never, {
    organizationId: org.orgId,
    actorId: userId,
    action: 'settings.updated',
    resourceType: 'ci_cost_settings',
    resourceId: org.orgId,
    metadata: { changed, first_save: !before },
  }).catch(() => {})
  return c.json({ ok: true, data: { settings: after, writable: true, canEdit: true, bounds: COST_BOUNDS, plans: COST_PLANS } })
}

async function rerunFixCi(c: Context, deps: CiRouteDeps): Promise<Response> {
  const fixId = c.req.param('id') ?? ''
  if (!UUID_RE.test(fixId)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()

  const { data: attempt, error } = await db
    .from('fix_attempts')
    .select('id, project_id, repo_id, pr_url, pr_number, commit_sha')
    .eq('id', fixId)
    .maybeSingle()
  if (error) return jsonError(c, 'DB_ERROR', 'Could not read the fix.', 500)
  if (!attempt) return jsonError(c, 'NOT_FOUND', 'Fix not found', 404)
  const a = attempt as { id: string; project_id: string; repo_id: string | null; pr_url: string | null; pr_number: number | null; commit_sha: string | null }

  const access = await deps.callerCanAccessProject(c, db, userId, a.project_id)
  if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'You cannot change this fix.', 403)
  const viewer = denyViewerWrite(c, access.role, 're-run tests')
  if (viewer) return viewer

  const ref = a.pr_url ? parseGithubRepoUrl(a.pr_url.split('/pull/')[0]) : null
  const prNumber = a.pr_number ?? (a.pr_url ? prNumberFromUrl(a.pr_url) : null)
  if (!ref || !prNumber) return jsonError(c, 'NO_PR', 'This fix has no pull request to test.', 409)

  const rate = await deps.claimRateLimit(db, `fix:${a.id}:ci_rerun`, CI_RERUNS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `Tests can be re-run ${CI_RERUNS_PER_HOUR} times an hour per fix.`, 429)
  }

  const token = await deps.resolveAttemptToken(db, a)
  if (!token) return jsonError(c, 'NO_GITHUB_TOKEN', 'Connect GitHub for this project first.', 409)
  const repo = `${ref.owner}/${ref.repo}`
  let headSha = a.commit_sha
  try {
    headSha = (await deps.fetchPullRequest(token, ref, prNumber))?.headSha ?? headSha
  } catch {
    // The stored commit is the fallback.
  }
  if (!headSha) return jsonError(c, 'NO_HEAD', 'Mushi does not know the pull request\'s latest commit yet. Refresh CI first.', 409)

  const gh = ciGithub(token, 1 + 5, deps.fetchImpl)
  const runs = await listRunsForHeadSha(gh, repo, headSha)
  if (runs.status === 403) return jsonError(c, 'GITHUB_ACTIONS_READ_MISSING', 'The GitHub token Mushi uses cannot read Actions runs. Give it Actions: Read and write.', 403)
  if (runs.status !== 200 || !runs.body) return jsonError(c, 'GITHUB_ERROR', `GitHub answered ${runs.status} when listing the runs.`, 502)
  const failed = runs.body.filter((r) => r.status === 'completed' && RERUN_CONCLUSIONS.has((r.conclusion ?? '').toLowerCase()))
  if (failed.length === 0) {
    if (runs.body.some((r) => r.status !== 'completed')) return jsonError(c, 'CI_RUNNING', 'The tests are still running on this commit.', 409)
    return jsonError(c, 'NOTHING_TO_RERUN', 'No failed or cancelled run on the pull request\'s latest commit.', 409)
  }

  const rerun: number[] = []
  for (const run of failed) {
    const status = await rerunFailedJobs(gh, repo, run.id)
    if (status === 201 || status === 204) {
      rerun.push(run.id)
      continue
    }
    if (status === 403) {
      if (rerun.length > 0) break
      // Remembered so /pipeline stops offering Re-run CI for this app until its GitHub settings change (69fcafcb).
      const at = deps.now().toISOString()
      const { error: refusedErr } = await db.from('fix_events').insert({
        fix_attempt_id: a.id,
        project_id: a.project_id,
        kind: 'ci_started',
        status: 'fail',
        label: 'Re-run refused: the GitHub token cannot re-run workflows',
        detail: 'Give the token Actions: Read and write (fine-grained token) or the workflow scope.',
        at,
        dedupe_key: `${RERUN_REFUSED_DEDUPE_PREFIX}${a.id}:${at}`,
        payload: { rerunRefused: 'actions_write', by: userId },
      })
      if (refusedErr) clog.warn('ci rerun refusal fix_event insert failed (non-fatal)', { fixId: a.id, err: refusedErr.message })
      return jsonError(c, 'GITHUB_ACTIONS_WRITE_MISSING', 'The GitHub token Mushi uses cannot re-run workflows. Give it Actions: Read and write (fine-grained token) or the workflow scope.', 403)
    }
    if (status === 409) {
      if (rerun.length > 0) break
      return jsonError(c, 'CI_RUNNING', 'GitHub is still running this workflow; re-run it when it finishes.', 409)
    }
    if (rerun.length === 0) return jsonError(c, 'GITHUB_ERROR', `GitHub answered ${status} to the re-run.`, 502)
  }

  const now = deps.now().toISOString()
  const { error: eventErr } = await db.from('fix_events').insert({
    fix_attempt_id: a.id,
    project_id: a.project_id,
    kind: 'ci_started',
    status: 'pending',
    label: 'Re-ran tests',
    detail: `Run${rerun.length === 1 ? '' : 's'} ${rerun.map((id) => `#${id}`).join(', ')}`,
    at: now,
    dedupe_key: `ci_rerun:${rerun.join(',')}:${now}`,
    payload: { runIds: rerun, headSha, by: userId },
  })
  if (eventErr) clog.warn('ci rerun fix_event insert failed (non-fatal)', { fixId: a.id, err: eventErr.message })
  return c.json({ ok: true, data: { rerun: rerun.map((runId) => ({ runId })), headSha } })
}
