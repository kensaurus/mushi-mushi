/**
 * ci-placement.ts — choose where CI runs (Plan 022 Phase 7b, ADR 0037).
 * Served by api-ext; `api` forwards /v1/admin/ci/*.
 *
 *   GET  /v1/admin/ci/policy                       jwtAuth (console)
 *        ?organization_id= | ?project_id= — the organization's CI agreement
 *        as Mushi enforces it (null until the owner fills it in).
 *   PUT  /v1/admin/ci/policy                       jwtAuth, owner/admin
 *        Turning "no paid GitHub-hosted on private repos" OFF needs an owner.
 *        Audited. 409 MIGRATION_PENDING before the table exists.
 *   GET  /v1/admin/ci/placement                    adminOrApiKey(mcp:read)
 *        ?project_id= — per bound repo: visibility, the runner variables its
 *        workflows read and their current values (≤ 6 GitHub reads), the
 *        policy and external controller, runners by label, recent requests
 *        and post-change watches.
 *   POST /v1/admin/ci/placement/preview            adminOrApiKey(mcp:read)
 *        { projectId, repo, variable, value | null } — the dry run: current
 *        vs new value, jobs that move or stay, target runners and wait, cost
 *        change, policy verdict, warnings, the payload a request would store.
 *   POST /v1/admin/ci/placement/requests           adminOrApiKey(mcp:write), non-viewers, 20/h
 *        Same body (+ reason). Rebuilds the preview server-side (never trusts
 *        a client payload) and stores a pending connector action. Nothing
 *        changes on GitHub.
 *   POST /v1/admin/ci/placement/requests/:id/approve   jwtAuth, owner/admin  { payloadSha256 }
 *   POST /v1/admin/ci/placement/requests/:id/reject    jwtAuth, owner/admin
 *   POST /v1/admin/ci/placement/requests/:id/execute   jwtAuth, owner/admin
 *        Runs once within the 1-hour approval; act() re-checks the allowlist,
 *        the policy and the variable (409 VARIABLE_MOVED). Starts the watch.
 *   POST /v1/admin/ci/placement/requests/:id/revert    adminOrApiKey(mcp:write), non-viewers
 *        Requests the reverse of an executed change (it needs its own approval).
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { claimTenantRateLimit, logOrgAudit } from '../../_shared/tenant-observability.ts'
import { parseGithubRepoUrl, resolveProjectGithubToken } from '../../_shared/github.ts'
import {
  approveConnectorAction,
  executeConnectorAction,
  rejectConnectorAction,
  requestLegacyConnectorAction,
  type ExecuteDeps,
} from '../../_shared/connector-actions.ts'
import { readActionsVariable } from '../../_shared/connectors/github.ts'
import {
  buildPlacementPreview,
  externalControllerFor,
  isAllowedPlacementVariable,
  normalizePolicy,
  PLACEMENT_ACTIONS,
  revertPayload,
  runnersWithLabel,
  type PlacementPayload,
  type PlacementPreview,
  type PolicyRow,
  type RunnerSeen,
  type VariableState,
} from '../../_shared/ci-placement.ts'
import { isHostedLabel, parseRepoWorkflows } from '../../_shared/ci-runs-on.ts'
import { snapshotWorkflows } from '../../_shared/verify-workflow-repo.ts'
import { buildCiCompare } from '../../_shared/ci-compare.ts'
import { isMissingObject, loadCiCompareInput } from '../../_shared/ci-compare-load.ts'
import type { CiCompare } from '../../_shared/ci-compare-types.ts'
import { callerCanAccessProject, callerProjectIds, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const plog = log.child('ci-placement')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
export const PLACEMENT_REQUESTS_PER_HOUR = 20
/** GitHub reads GET /v1/admin/ci/placement may spend on variable values. */
export const PLACEMENT_READ_CALLS = 6

type Db = ReturnType<typeof getServiceClient>
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface CiPlacementRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  callerProjectIds: typeof callerProjectIds
  callerCanAccessProject: typeof callerCanAccessProject
  claimRateLimit: typeof claimTenantRateLimit
  logOrgAudit: typeof logOrgAudit
  /** The project's stored GitHub token (PAT path, no platform fallback). */
  resolveToken: (db: Db, projectId: string) => Promise<string | null>
  fetch: FetchLike
  /** The cost comparison for one project, or null when it cannot be built. */
  loadCompare: (db: Db, projectId: string, now: Date) => Promise<CiCompare | null>
  execute: ExecuteDeps
  now: () => Date
}

export const defaultCiPlacementDeps: CiPlacementRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  callerProjectIds,
  callerCanAccessProject,
  claimRateLimit: claimTenantRateLimit,
  logOrgAudit,
  resolveToken: (db, projectId) => resolveProjectGithubToken(db, projectId, null, { allowEnvFallback: false }),
  fetch: (url, init) => fetch(url, init),
  loadCompare: async (db, projectId, now) => {
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60_000)
    try {
      return buildCiCompare({ ...(await loadCiCompareInput(db as never, [projectId], from, now)), now, days: 30, from, to: now, whatIfLimit: 50 })
    } catch {
      return null
    }
  },
  execute: { fetch: (url, init) => fetch(url, init), now: () => new Date() },
  now: () => new Date(),
}

export function registerCiPlacementRoutes(app: Hono<{ Variables: Variables }>, deps: CiPlacementRouteDeps = defaultCiPlacementDeps): void {
  app.get('/v1/admin/ci/policy', deps.jwtAuth, (c) => getPolicy(c, deps))
  app.put('/v1/admin/ci/policy', deps.jwtAuth, (c) => putPolicy(c, deps))
  app.get('/v1/admin/ci/placement', deps.adminOrApiKeyRead, (c) => getPlacement(c, deps))
  app.post('/v1/admin/ci/placement/preview', deps.adminOrApiKeyRead, (c) => previewRoute(c, deps))
  app.post('/v1/admin/ci/placement/requests', deps.adminOrApiKeyWrite, (c) => requestRoute(c, deps))
  for (const verb of ['approve', 'reject', 'execute'] as const) {
    app.post(`/v1/admin/ci/placement/requests/:id/${verb}`, deps.jwtAuth, (c) => decideRoute(c, deps, verb))
  }
  app.post('/v1/admin/ci/placement/requests/:id/revert', deps.adminOrApiKeyWrite, (c) => revertRoute(c, deps))
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared reads
// ─────────────────────────────────────────────────────────────────────────────

async function orgRole(db: Db, orgId: string, userId: string): Promise<string | null> {
  const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  return (data as { role?: string } | null)?.role ?? null
}

async function projectOrg(db: Db, projectId: string): Promise<string | null> {
  const { data } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  return (data as { organization_id: string | null } | null)?.organization_id ?? null
}

async function loadPolicy(db: Db, orgId: string): Promise<{ policy: ReturnType<typeof normalizePolicy>; writable: boolean }> {
  const { data, error } = await db.from('ci_runner_policies').select('*').eq('organization_id', orgId).maybeSingle()
  if (error) {
    if (isMissingObject(error)) return { policy: null, writable: false }
    throw new Error(`ci_runner_policies read failed: ${error.message}`)
  }
  return { policy: normalizePolicy((data as PolicyRow | null) ?? null), writable: true }
}

async function boundRepos(db: Db, projectId: string): Promise<string[]> {
  const { data } = await db.from('project_repos').select('repo_url').eq('project_id', projectId)
  const out = new Set<string>()
  for (const r of (data ?? []) as Array<{ repo_url: string | null }>) {
    const ref = parseGithubRepoUrl(r.repo_url ?? '')
    if (ref) out.add(`${ref.owner}/${ref.repo}`)
  }
  return [...out]
}

async function repoVisibility(db: Db, projectId: string, repo: string): Promise<'public' | 'private' | 'unknown'> {
  const { data } = await db.from('ci_collector_state').select('permissions').eq('project_id', projectId).maybeSingle()
  const perms = ((data as { permissions?: Record<string, { visibility?: string }> } | null)?.permissions ?? {}) as Record<string, { visibility?: string }>
  const hit = Object.entries(perms).find(([r]) => r.toLowerCase() === repo.toLowerCase())?.[1]?.visibility
  return hit === 'public' || hit === 'private' ? hit : 'unknown'
}

async function repoRunners(db: Db, repo: string): Promise<RunnerSeen[]> {
  const { data } = await db.from('ci_runners').select('runner_name, status, busy, labels').eq('repo', repo)
  return (data ?? []) as RunnerSeen[]
}

/** Project access for a project-scoped call; a Response when refused. */
type Refused = { refused: Response }
const refuse = (response: Response): Refused => ({ refused: response })
const isRefused = (x: unknown): x is Refused => !!x && typeof x === 'object' && 'refused' in x

async function projectAccess(c: Context, deps: CiPlacementRouteDeps, db: Db, projectId: unknown): Promise<{ projectId: string; role: string | null } | Refused> {
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return refuse(jsonError(c, 'VALIDATION_ERROR', 'projectId must be a uuid', 400))
  const access = await deps.callerCanAccessProject(c, db, c.get('userId') as string, projectId)
  if (!access.allowed) return refuse(jsonError(c, 'FORBIDDEN', 'You cannot read this project.', 403))
  return { projectId, role: (access.role as string | null | undefined) ?? null }
}

const previewSchema = z
  .object({
    projectId: z.string().uuid(),
    repo: z.string().regex(REPO_RE, 'owner/repo'),
    variable: z.string().min(1).max(80),
    value: z.string().min(1).max(100).nullable(),
    reason: z.string().max(500).optional(),
  })
  .strict()

type PreviewBody = z.infer<typeof previewSchema>

/** Build the preview for a validated body. A Response when the inputs are refused before GitHub is read. */
async function previewFor(c: Context, deps: CiPlacementRouteDeps, db: Db, body: PreviewBody): Promise<{ preview: PlacementPreview; orgId: string } | Refused> {
  const repos = await boundRepos(db, body.projectId)
  const repo = repos.find((r) => r.toLowerCase() === body.repo.toLowerCase())
  if (!repo) return refuse(jsonError(c, 'REPO_NOT_IN_PROJECT', `${body.repo} is not connected to this project.`, 404))
  const orgId = await projectOrg(db, body.projectId)
  if (!orgId) return refuse(jsonError(c, 'NO_ORGANIZATION', 'This project belongs to no organization.', 409))
  if (!isAllowedPlacementVariable(body.variable)) {
    return refuse(jsonError(c, 'VARIABLE_NOT_ALLOWED', `Mushi only changes LINUX_RUNNER and RUNNER_<WORKFLOW> variables, not "${body.variable.slice(0, 60)}".`, 403))
  }
  const now = deps.now()
  const [{ policy }, visibility, runners, workflows, token, compare] = await Promise.all([
    loadPolicy(db, orgId),
    repoVisibility(db, body.projectId, repo),
    repoRunners(db, repo),
    snapshotWorkflows(db as never, body.projectId, repo),
    deps.resolveToken(db, body.projectId),
    deps.loadCompare(db, body.projectId, now),
  ])
  let current: VariableState | null = null
  if (token) {
    const read = await readActionsVariable({ fetch: deps.fetch }, token, repo, body.variable).catch(() => ({ status: 0, state: null }))
    current = read.state
  }
  const waitP95ByLabel: Record<string, number | null> = {}
  for (const row of compare?.rows.filter((r) => r.repo === repo || r.runnerClass === 'self_hosted') ?? []) {
    for (const l of row.labels) {
      if (row.queueP95s == null) continue
      waitP95ByLabel[l] = Math.max(waitP95ByLabel[l] ?? 0, row.queueP95s)
    }
  }
  const toSelf = body.value !== null && !isHostedLabel(body.value)
  const moves = (compare?.whatIfs ?? []).filter((w) => w.repo === repo && w.id.startsWith(toSelf ? 'to_self:' : 'to_hosted:'))
  const cost = moves.length > 0
    ? { monthCostDelta: Math.round(moves.reduce((n, w) => n + w.monthCostDelta, 0) * 100) / 100, currency: moves[0].currency, note: `Estimated from the cost comparison over ${moves.length} workflow${moves.length === 1 ? '' : 's'}; pinned and main-branch jobs are left out.` }
    : null
  const preview = buildPlacementPreview({
    projectId: body.projectId,
    repo,
    visibility,
    variable: body.variable,
    value: body.value,
    current,
    parsed: workflows.length > 0 ? parseRepoWorkflows(workflows) : null,
    policy,
    runners,
    waitP95ByLabel,
    cost,
    now,
  })
  if (!token && preview.blocked?.code === 'VARIABLE_UNREADABLE') {
    preview.blocked = { code: 'NO_GITHUB_TOKEN', message: 'No GitHub token is stored for this project. Store a fine-grained token with "Variables: Read and write" in the project settings.' }
  }
  return { preview, orgId }
}

function blockedStatus(code: string): 403 | 409 {
  return code === 'VARIABLE_NOT_ALLOWED' || code.startsWith('POLICY_') || code === 'EXTERNAL_CONTROLLER' ? 403 : 409
}

function requester(c: Context): string {
  const key = c.get('apiKeyId') as string | undefined
  return c.get('authMethod') === 'apiKey' ? `api_key:${key ?? 'unknown'}` : `user:${c.get('userId') as string}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy
// ─────────────────────────────────────────────────────────────────────────────

const controllerSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    owner: z.string().trim().max(80).default(''),
    repos: z.array(z.string().regex(REPO_RE, 'owner/repo')).min(1).max(50),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .strict()

export const policySchema = z
  .object({
    organizationId: z.string().uuid(),
    noPaidHostedOnPrivate: z.boolean(),
    hostedAllowedRepos: z.array(z.string().regex(REPO_RE, 'owner/repo')).max(200),
    externalControllers: z.array(controllerSchema).max(20),
    standbyRunners: z.array(z.string().regex(/^[A-Za-z0-9._*-]{1,100}$/, 'a runner name or label, * for any characters')).max(100),
    sourceNote: z.string().trim().max(300).nullable(),
  })
  .strict()

async function resolvePolicyOrg(c: Context, deps: CiPlacementRouteDeps, db: Db, requested: string | null): Promise<string | Refused> {
  const userId = c.get('userId') as string
  if (requested) {
    if (!UUID_RE.test(requested)) return refuse(jsonError(c, 'VALIDATION_ERROR', 'organization_id must be a uuid', 400))
    if (!(await orgRole(db, requested, userId))) return refuse(jsonError(c, 'FORBIDDEN', 'You are not a member of this organization.', 403))
    return requested
  }
  const projectId = c.req.query('project_id') ?? null
  if (projectId) {
    const access = await projectAccess(c, deps, db, projectId)
    if (isRefused(access)) return access
    const org = await projectOrg(db, access.projectId)
    return org ?? refuse(jsonError(c, 'NO_ORGANIZATION', 'This project belongs to no organization.', 409))
  }
  const ids = await deps.callerProjectIds(c, db, userId)
  const { data } = ids.length ? await db.from('projects').select('organization_id').in('id', ids) : { data: [] }
  const orgs = [...new Set(((data ?? []) as Array<{ organization_id: string | null }>).map((p) => p.organization_id).filter((x): x is string => !!x))]
  if (orgs.length !== 1) return refuse(jsonError(c, 'ORG_REQUIRED', orgs.length === 0 ? 'You can read no organization.' : 'You belong to several organizations; pass organization_id.', 400, { organizations: orgs }))
  return orgs[0]
}

function policyWire(orgId: string, policy: ReturnType<typeof normalizePolicy>, writable: boolean, role: string | null) {
  return {
    organizationId: orgId,
    policy,
    writable,
    canEdit: writable && (role === 'owner' || role === 'admin'),
    canLift: writable && role === 'owner',
  }
}

async function getPolicy(c: Context, deps: CiPlacementRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const org = await resolvePolicyOrg(c, deps, db, c.req.query('organization_id') ?? null)
  if (isRefused(org)) return org.refused
  try {
    const { policy, writable } = await loadPolicy(db, org)
    return c.json({ ok: true, data: policyWire(org, policy, writable, await orgRole(db, org, c.get('userId') as string)) })
  } catch {
    return jsonError(c, 'DB_ERROR', 'Could not read the CI policy.', 500)
  }
}

async function putPolicy(c: Context, deps: CiPlacementRouteDeps): Promise<Response> {
  if (c.get('authMethod') === 'apiKey') return jsonError(c, 'CONSOLE_ONLY', 'The CI policy is changed in the console, not with an API key.', 403)
  const db = deps.getServiceClient()
  const parsed = policySchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
  const body = parsed.data
  const userId = c.get('userId') as string
  const role = await orgRole(db, body.organizationId, userId)
  if (!role) return jsonError(c, 'FORBIDDEN', 'You are not a member of this organization.', 403)
  if (role !== 'owner' && role !== 'admin') return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can change the CI policy.', 403)
  let prior: ReturnType<typeof normalizePolicy>
  try {
    const loaded = await loadPolicy(db, body.organizationId)
    if (!loaded.writable) return jsonError(c, 'MIGRATION_PENDING', 'The CI policy can be saved once the database update 20261022130000_ci_placement is applied.', 409)
    prior = loaded.policy
  } catch {
    return jsonError(c, 'DB_ERROR', 'Could not read the CI policy.', 500)
  }
  // Lifting the no-spend rule is its own owner decision, never an admin's.
  if (prior?.noPaidHostedOnPrivate && !body.noPaidHostedOnPrivate && role !== 'owner') {
    return jsonError(c, 'OWNER_REQUIRED', 'Only an owner can turn off “no paid GitHub-hosted minutes on private repos”.', 403)
  }
  const now = deps.now().toISOString()
  const row = {
    organization_id: body.organizationId,
    no_paid_hosted_on_private: body.noPaidHostedOnPrivate,
    hosted_allowed_repos: [...new Set(body.hostedAllowedRepos)],
    external_controllers: body.externalControllers.map((x) => ({ name: x.name, owner: x.owner, repos: [...new Set(x.repos)], note: x.note ?? null })),
    standby_runners: [...new Set(body.standbyRunners)],
    source_note: body.sourceNote,
    updated_by: userId,
    updated_at: now,
  }
  const { error } = await db.from('ci_runner_policies').upsert(row, { onConflict: 'organization_id' })
  if (error) {
    if (isMissingObject(error)) return jsonError(c, 'MIGRATION_PENDING', 'The CI policy can be saved once the database update 20261022130000_ci_placement is applied.', 409)
    return jsonError(c, 'DB_ERROR', 'The CI policy could not be saved.', 500)
  }
  const lifted = !!prior?.noPaidHostedOnPrivate && !body.noPaidHostedOnPrivate
  void deps.logOrgAudit(db as never, {
    organizationId: body.organizationId,
    actorId: userId,
    action: 'settings.updated',
    resourceType: 'ci_runner_policy',
    resourceId: body.organizationId,
    metadata: { first_save: !prior, no_spend_lifted: lifted, no_paid_hosted_on_private: body.noPaidHostedOnPrivate, controllers: row.external_controllers.length, standby: row.standby_runners.length },
  }).catch(() => {})
  return c.json({ ok: true, data: policyWire(body.organizationId, normalizePolicy({ ...row, updated_at: now }), true, role) })
}

// ─────────────────────────────────────────────────────────────────────────────
// Placement
// ─────────────────────────────────────────────────────────────────────────────

async function getPlacement(c: Context, deps: CiPlacementRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const access = await projectAccess(c, deps, db, c.req.query('project_id') ?? c.req.query('projectId') ?? null)
  if (isRefused(access)) return access.refused
  const orgId = await projectOrg(db, access.projectId)
  if (!orgId) return jsonError(c, 'NO_ORGANIZATION', 'This project belongs to no organization.', 409)
  try {
    const [{ policy, writable }, repos, token] = await Promise.all([loadPolicy(db, orgId), boundRepos(db, access.projectId), deps.resolveToken(db, access.projectId)])
    let calls = PLACEMENT_READ_CALLS
    const out = []
    for (const repo of repos) {
      const [visibility, runners, workflows] = await Promise.all([repoVisibility(db, access.projectId, repo), repoRunners(db, repo), snapshotWorkflows(db as never, access.projectId, repo)])
      const parsed = parseRepoWorkflows(workflows)
      const counts = new Map<string, { jobs: number; fallbacks: Set<string> }>()
      for (const wf of parsed) {
        for (const j of wf.jobs) {
          if (j.kind !== 'follows_variable') continue
          for (const v of j.variables) {
            const e = counts.get(v) ?? { jobs: 0, fallbacks: new Set<string>() }
            e.jobs++
            if (j.fallbackLabel) e.fallbacks.add(j.fallbackLabel)
            counts.set(v, e)
          }
        }
      }
      const variables = []
      for (const [name, e] of [...counts.entries()].sort((a, b) => b[1].jobs - a[1].jobs)) {
        let current: VariableState | null = null
        if (token && calls > 0 && isAllowedPlacementVariable(name)) {
          calls--
          current = (await readActionsVariable({ fetch: deps.fetch }, token, repo, name).catch(() => ({ status: 0, state: null }))).state
        }
        variables.push({ name, jobs: e.jobs, fallbacks: [...e.fallbacks], allowed: isAllowedPlacementVariable(name), current })
      }
      const labels = new Map<string, { online: number; runners: number }>()
      for (const r of runners) {
        for (const l of r.labels ?? []) {
          if (l.toLowerCase() === 'self-hosted') continue
          if (!labels.has(l)) {
            const carriers = runnersWithLabel(runners, l)
            labels.set(l, { runners: carriers.length, online: carriers.filter((x) => x.status === 'online').length })
          }
        }
      }
      out.push({
        repo,
        visibility,
        variables,
        workflowsRead: workflows.length > 0,
        controller: externalControllerFor(policy, repo),
        labels: [...labels.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.online - a.online || a.label.localeCompare(b.label)),
      })
    }
    const { data: actions } = await db
      .from('connector_actions')
      .select('id, project_id, action, payload, payload_sha256, reason, status, requested_by, requested_at, approved_by, approved_at, expires_at, executed_at, result, error')
      .eq('organization_id', orgId)
      .eq('project_id', access.projectId)
      .in('action', [...PLACEMENT_ACTIONS])
      .order('requested_at', { ascending: false })
      .limit(20)
    const watchesRes = await db.from('ci_placement_watches').select('*').eq('project_id', access.projectId).order('started_at', { ascending: false }).limit(10)
    const role = c.get('authMethod') === 'apiKey' ? null : await orgRole(db, orgId, c.get('userId') as string)
    return c.json({
      ok: true,
      data: {
        projectId: access.projectId,
        organizationId: orgId,
        policy,
        policyWritable: writable,
        tokenStored: !!token,
        repos: out,
        requests: actions ?? [],
        watches: watchesRes.error ? [] : (watchesRes.data ?? []),
        canDecide: role === 'owner' || role === 'admin',
        canRequest: access.role !== 'viewer',
      },
    })
  } catch (err) {
    plog.error('ci placement read failed', { err: err instanceof Error ? err.message : String(err) })
    return jsonError(c, 'CI_PLACEMENT_FAILED', 'Mushi could not read where this project\'s CI runs. Try again in a minute.', 500)
  }
}

async function previewRoute(c: Context, deps: CiPlacementRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const parsed = previewSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
  const access = await projectAccess(c, deps, db, parsed.data.projectId)
  if (isRefused(access)) return access.refused
  const built = await previewFor(c, deps, db, parsed.data)
  if (isRefused(built)) return built.refused
  return c.json({ ok: true, data: built.preview })
}

async function requestRoute(c: Context, deps: CiPlacementRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const parsed = previewSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
  const access = await projectAccess(c, deps, db, parsed.data.projectId)
  if (isRefused(access)) return access.refused
  const viewer = denyViewerWrite(c, access.role, 'ask to change where CI runs')
  if (viewer) return viewer
  const rate = await deps.claimRateLimit(db, `project:${access.projectId}:ci_placement_request`, PLACEMENT_REQUESTS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `At most ${PLACEMENT_REQUESTS_PER_HOUR} CI placement requests an hour per project.`, 429)
  }
  const built = await previewFor(c, deps, db, parsed.data)
  if (isRefused(built)) return built.refused
  const { preview, orgId } = built
  if (preview.blocked || !preview.payload) {
    const b = preview.blocked ?? { code: 'NOT_REQUESTABLE', message: 'This change cannot be requested.' }
    return jsonError(c, b.code, b.message, blockedStatus(b.code), { preview })
  }
  const r = await requestLegacyConnectorAction(db as never, {
    organizationId: orgId,
    projectId: access.projectId,
    kind: 'github',
    action: preview.action,
    payload: preview.payload as unknown as Record<string, unknown>,
    requestedBy: requester(c),
    reason: parsed.data.reason ?? null,
  })
  if (!r.ok) return jsonError(c, r.code, r.message, r.status)
  return c.json(
    {
      ok: true,
      data: {
        id: r.value.id,
        status: 'pending_approval',
        payloadSha256: r.value.payloadSha256,
        preview,
        next: 'A team owner or admin approves it in the console (CI runners → Where CI runs), then runs it within an hour.',
      },
    },
    201,
  )
}

interface PlacementRow {
  id: string
  organization_id: string
  project_id: string | null
  connector_kind?: string | null
  action: string
  payload: Record<string, unknown>
  payload_sha256: string
  status: string
  result: Record<string, unknown> | null
  executed_at: string | null
}

async function loadPlacementRow(db: Db, id: string): Promise<PlacementRow | null> {
  if (!UUID_RE.test(id)) return null
  const { data } = await db.from('connector_actions').select('*').eq('id', id).maybeSingle()
  const row = (data as PlacementRow | null) ?? null
  if (!row || row.connector_kind !== 'github' || !(PLACEMENT_ACTIONS as readonly string[]).includes(row.action)) return null
  return row
}

async function decideRoute(c: Context, deps: CiPlacementRouteDeps, verb: 'approve' | 'reject' | 'execute'): Promise<Response> {
  if (c.get('authMethod') === 'apiKey') return jsonError(c, 'HUMAN_REQUIRED', 'Only a person signed in to the console can approve or run a CI placement change. An API key can only ask.', 403)
  const db = deps.getServiceClient()
  const row = await loadPlacementRow(db, c.req.param('id') ?? '')
  if (!row) return jsonError(c, 'NOT_FOUND', 'CI placement request not found.', 404)
  const userId = c.get('userId') as string
  const role = await orgRole(db, row.organization_id, userId)
  if (!role) return jsonError(c, 'NOT_FOUND', 'CI placement request not found.', 404)
  if (role !== 'owner' && role !== 'admin') return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can approve or run CI placement changes.', 403)
  if (verb === 'approve') {
    const body = (await c.req.json().catch(() => null)) as { payloadSha256?: unknown } | null
    const r = await approveConnectorAction(db as never, row.id, row.organization_id, userId, deps.now(), body?.payloadSha256)
    return r.ok ? c.json({ ok: true, data: r.value }) : jsonError(c, r.code, r.message, r.status)
  }
  if (verb === 'reject') {
    const r = await rejectConnectorAction(db as never, row.id, row.organization_id, userId)
    return r.ok ? c.json({ ok: true, data: null }) : jsonError(c, r.code, r.message, r.status)
  }
  const r = await executeConnectorAction(db as never, row.id, row.organization_id, userId, deps.execute)
  if (!r.ok) return jsonError(c, r.code, r.message, r.status)
  // Watch the next jobs (the change is done even if the watch cannot start).
  const p = row.payload as unknown as PlacementPayload
  const { error: watchErr } = await db.from('ci_placement_watches').insert({
    organization_id: row.organization_id,
    project_id: row.project_id,
    action_id: row.id,
    repo: p.repo,
    variable: p.name,
    previous_value: p.expected?.exists ? p.expected.value : null,
    new_value: p.value,
    expected_labels: p.expectedLabels ?? [],
    jobs: p.jobs ?? [],
    started_at: deps.now().toISOString(),
    status: 'watching',
  })
  if (watchErr) plog.warn('ci placement watch not started', { actionId: row.id, err: watchErr.message })
  // A revert closes the watch of the change it undoes.
  const revertOf = typeof (row.payload as { revertOf?: unknown }).revertOf === 'string' ? (row.payload as { revertOf: string }).revertOf : null
  if (revertOf) await db.from('ci_placement_watches').update({ status: 'reverted', updated_at: deps.now().toISOString() }).eq('action_id', revertOf)
  return c.json({ ok: true, data: { ...r.value, watching: !watchErr } })
}

async function revertRoute(c: Context, deps: CiPlacementRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const row = await loadPlacementRow(db, c.req.param('id') ?? '')
  if (!row || !row.project_id) return jsonError(c, 'NOT_FOUND', 'CI placement request not found.', 404)
  const access = await projectAccess(c, deps, db, row.project_id)
  if (isRefused(access)) return jsonError(c, 'NOT_FOUND', 'CI placement request not found.', 404)
  const viewer = denyViewerWrite(c, access.role, 'ask to revert a CI placement change')
  if (viewer) return viewer
  if (row.status !== 'executed') return jsonError(c, 'NOT_EXECUTED', `This change is ${row.status}; only a change that ran can be reverted.`, 409)
  const done = row.payload as unknown as PlacementPayload
  const left = (row.result as { next?: VariableState } | null)?.next
  if (!left) return jsonError(c, 'NO_RESULT', 'Mushi did not record what it left, so it cannot build a safe revert.', 409)
  const back = revertPayload(done, left)
  // The revert is a change like any other: the policy and the allowlist apply.
  const built = await previewFor(c, deps, db, { projectId: row.project_id, repo: done.repo, variable: done.name, value: back.value })
  if (isRefused(built)) return built.refused
  if (built.preview.blocked) {
    return jsonError(c, built.preview.blocked.code, built.preview.blocked.message, blockedStatus(built.preview.blocked.code), { preview: built.preview })
  }
  if (built.preview.current && !(built.preview.current.exists === left.exists && built.preview.current.value === left.value)) {
    return jsonError(c, 'VARIABLE_MOVED', `${done.name} changed since Mushi set it. Preview the change you want instead of reverting.`, 409)
  }
  const payload = { ...back, expected: built.preview.current ?? left, revertOf: row.id }
  const r = await requestLegacyConnectorAction(db as never, {
    organizationId: row.organization_id,
    projectId: row.project_id,
    kind: 'github',
    action: back.value === null ? 'delete_actions_variable' : 'set_actions_variable',
    payload: payload as unknown as Record<string, unknown>,
    requestedBy: requester(c),
    reason: `Revert of ${row.id}`,
  })
  if (!r.ok) return jsonError(c, r.code, r.message, r.status)
  await db.from('ci_placement_watches').update({ revert_action_id: r.value.id, updated_at: deps.now().toISOString() }).eq('action_id', row.id)
  return c.json({ ok: true, data: { id: r.value.id, status: 'pending_approval', payloadSha256: r.value.payloadSha256, revertOf: row.id } }, 201)
}
