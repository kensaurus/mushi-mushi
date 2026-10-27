/**
 * repo-housekeeping.ts — repo clean-up from the console (ADR 0051, console
 * ops plan P4). Served by api-ext; `api` forwards /v1/admin/projects/:id/repo-cleanup*.
 *
 *   GET  /v1/admin/projects/:id/repo-cleanup                 adminOrApiKey(mcp:read)
 *        ?staleDays=7..90 (default 14) — per bound repo: the branches and PRs
 *        a clean-up may touch, each with its reason and commit; what was kept
 *        and why; the "Automatically delete head branches" setting; recent
 *        clean-ups with their per-item results; branches Mushi can restore.
 *   POST /v1/admin/projects/:id/repo-cleanup/requests        adminOrApiKey(mcp:write), non-viewers
 *        { action: delete_branches | close_prs | set_delete_branch_on_merge,
 *          repo, keys?, staleDays?, reason? } — rebuilds the preview
 *        server-side and stores exactly the chosen candidates (≤ 50) as a
 *        pending connector action. 5 an hour per app. Nothing changes on GitHub.
 *   POST /v1/admin/projects/:id/repo-cleanup/restore         adminOrApiKey(mcp:write), non-viewers
 *        { itemIds } — asks to recreate branches Mushi deleted, at the commit
 *        it recorded (its own approval; not counted against the 5).
 *   POST /v1/admin/projects/:id/repo-cleanup/requests/:actionId/approve   console JWT, owner/admin  { payloadSha256 }
 *   POST /v1/admin/projects/:id/repo-cleanup/requests/:actionId/reject    console JWT, owner/admin
 *   POST /v1/admin/projects/:id/repo-cleanup/requests/:actionId/execute   console JWT, owner/admin
 *        Runs once within the hour (the shared connector-action approve and
 *        execute; the executor is _shared/repo-housekeeping-run.ts). Answers
 *        with the result, or 202 while a long run goes on in the background.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { resolveProjectGithubToken } from '../../_shared/github.ts'
import { runInBackground } from '../../_shared/background.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { closePull, ghClient } from '../../_shared/repo-housekeeping-github.ts'
import {
  approveConnectorAction,
  executeConnectorAction,
  rejectConnectorAction,
  requestLegacyConnectorAction,
  type ExecuteDeps,
} from '../../_shared/connector-actions.ts'
import { isHousekeepingAction } from '../../_shared/repo-housekeeping-acts.ts'
import {
  clampStaleDays,
  HOUSEKEEPING_ACTIONS_PER_HOUR,
  MAX_HOUSEKEEPING_ITEMS,
  SETTING_KEY,
  type ClosePrsPayload,
  type DeleteBranchesPayload,
  type RestorePayload,
  type SettingPayload,
} from '../../_shared/repo-housekeeping.ts'
import {
  ACTION_COLUMNS,
  boundRepos,
  isMissingTable,
  loadActions,
  loadRecorded,
  loadReviews,
  loadRiding,
  pendingKeys,
  previewRepo,
  type HousekeepingActionRow,
  type RepoPreview,
} from '../../_shared/repo-housekeeping-load.ts'
import { runHousekeepingAction, type HousekeepingRunDeps } from '../../_shared/repo-housekeeping-run.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const hlog = log.child('repo-cleanup')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** How long execute waits for the run before answering 202 (the run goes on). */
export const EXECUTE_WAIT_MS = 25_000
const ITEMS_SHOWN = 300

export const RACE_NOTE =
  'Mushi asks GitHub to delete a branch only if it still points at the commit shown. Where GitHub cannot check that for your token, Mushi reads the branch again just before deleting it, so a push in that second could be lost. Restore brings back the commit shown.'

type Db = ReturnType<typeof getServiceClient>
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface RepoHousekeepingRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  callerCanAccessProject: typeof callerCanAccessProject
  fetch: FetchLike
  now: () => Date
  /** The project's stored GitHub token (ADR 0037's legacy-backed path: never the App installation or the platform token). */
  token: (db: Db, projectId: string) => Promise<string | null>
  claimRateLimit: typeof claimTenantRateLimit
  sleep: (ms: number) => Promise<void>
  executeWaitMs?: number
}

export const defaultRepoHousekeepingDeps: RepoHousekeepingRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  callerCanAccessProject,
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  token: (db, projectId) => resolveProjectGithubToken(db, projectId, null, { allowEnvFallback: false }),
  claimRateLimit: claimTenantRateLimit,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

function runDeps(deps: RepoHousekeepingRouteDeps): HousekeepingRunDeps {
  return {
    fetch: deps.fetch,
    now: deps.now,
    sleep: deps.sleep,
    token: deps.token,
    closePull: (token, repo, n) => closePull(ghClient(deps.fetch, token), repo, n),
  }
}

function executeDeps(deps: RepoHousekeepingRouteDeps): ExecuteDeps {
  const rd = runDeps(deps)
  return { fetch: deps.fetch, now: deps.now, housekeepingAct: (input) => runHousekeepingAction(input, rd) }
}

export function registerRepoHousekeepingRoutes(app: Hono<{ Variables: Variables }>, deps: RepoHousekeepingRouteDeps = defaultRepoHousekeepingDeps): void {
  app.get('/v1/admin/projects/:id/repo-cleanup', deps.adminOrApiKeyRead, (c) => previewRoute(c, deps))
  app.post('/v1/admin/projects/:id/repo-cleanup/requests', deps.adminOrApiKeyWrite, (c) => requestRoute(c, deps))
  app.post('/v1/admin/projects/:id/repo-cleanup/restore', deps.adminOrApiKeyWrite, (c) => restoreRoute(c, deps))
  for (const verb of ['approve', 'reject', 'execute'] as const) {
    app.post(`/v1/admin/projects/:id/repo-cleanup/requests/:actionId/${verb}`, deps.jwtAuth, (c) => decideRoute(c, deps, verb))
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function projectOrg(db: Db, projectId: string): Promise<string | null> {
  const { data } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  return (data as { organization_id: string | null } | null)?.organization_id ?? null
}

async function orgRole(db: Db, orgId: string, userId: string): Promise<string | null> {
  const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  return (data as { role?: string } | null)?.role ?? null
}

type Access = { projectId: string; orgId: string; role: string | null }

async function access(c: Context, deps: RepoHousekeepingRouteDeps, db: Db): Promise<Access | { refused: Response }> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return { refused: jsonError(c, 'VALIDATION_ERROR', 'The project id must be a uuid.', 400) }
  const a = await deps.callerCanAccessProject(c, db, c.get('userId') as string, projectId)
  if (!a.allowed) return { refused: jsonError(c, 'NOT_FOUND', 'Project not found.', 404) }
  const orgId = await projectOrg(db, projectId)
  if (!orgId) return { refused: jsonError(c, 'NO_ORGANIZATION', 'This project belongs to no organization.', 409) }
  return { projectId, orgId, role: (a.role as string | null | undefined) ?? null }
}

function requester(c: Context): string {
  const key = c.get('apiKeyId') as string | undefined
  return c.get('authMethod') === 'apiKey' ? `api_key:${key ?? 'unknown'}` : `user:${c.get('userId') as string}`
}

function wireAction(a: HousekeepingActionRow) {
  const payload = a.payload as { repo?: string; items?: unknown[] }
  return {
    id: a.id,
    action: a.action,
    repo: payload.repo ?? null,
    itemCount: Array.isArray(payload.items) ? payload.items.length : 1,
    payload: a.payload,
    payloadSha256: a.payload_sha256,
    reason: a.reason,
    status: a.status,
    requestedBy: a.requested_by,
    requestedAt: a.requested_at,
    approvedAt: a.approved_at,
    expiresAt: a.expires_at,
    executedAt: a.executed_at,
    result: a.result,
    error: a.error,
  }
}

interface ItemRow {
  id: string
  action_id: string
  repo: string
  action: string
  item_key: string
  branch: string | null
  pr_number: number | null
  expected_sha: string | null
  deleted_sha: string | null
  method: string | null
  outcome: string
  detail: string | null
  restored_at: string | null
  created_at: string
}

/** Recent item rows, or null while the table is not applied. */
async function loadItems(db: Db, projectId: string): Promise<ItemRow[] | null> {
  const { data, error } = await db
    .from('repo_housekeeping_items')
    .select('id, action_id, repo, action, item_key, branch, pr_number, expected_sha, deleted_sha, method, outcome, detail, restored_at, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(ITEMS_SHOWN)
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(`repo_housekeeping_items read failed: ${error.message}`)
  }
  return (data ?? []) as ItemRow[]
}

const restorable = (r: ItemRow) => r.action === 'delete_branches' && !!r.deleted_sha && !!r.branch && !r.restored_at && (r.outcome === 'done' || r.outcome === 'pending')

/** The full preview: every bound repo. */
async function buildPreview(db: Db, deps: RepoHousekeepingRouteDeps, projectId: string, staleDays: number, actions: HousekeepingActionRow[], onlyRepo?: string): Promise<RepoPreview[]> {
  const [repos, recorded, riding] = await Promise.all([boundRepos(db, projectId), loadRecorded(db, projectId), loadRiding(db, projectId)])
  const reviews = await loadReviews(db, projectId, [...new Set(recorded.attempts.filter((a) => !a.merged).map((a) => a.id))])
  const pending = pendingKeys(actions)
  const out: RepoPreview[] = []
  for (const repo of repos) {
    if (onlyRepo && repo !== onlyRepo) continue
    out.push(await previewRepo(db, { fetch: deps.fetch, now: deps.now, token: deps.token }, { projectId, repo, recorded, reviews, riding: riding.get(repo) ?? new Set(), pending, staleDays }))
  }
  return out
}

async function previewRoute(c: Context, deps: RepoHousekeepingRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const a = await access(c, deps, db)
  if ('refused' in a) return a.refused
  const staleDays = clampStaleDays(c.req.query('staleDays'))
  try {
    const actions = await loadActions(db, a.projectId)
    const [repos, items] = await Promise.all([buildPreview(db, deps, a.projectId, staleDays, actions), loadItems(db, a.projectId)])
    const role = c.get('authMethod') === 'apiKey' ? null : await orgRole(db, a.orgId, c.get('userId') as string)
    const pendingRestore = new Set(
      actions.filter((x) => x.action === 'restore_branches' && ['pending_approval', 'approved', 'executing'].includes(x.status))
        .flatMap((x) => ((x.payload as { items?: Array<{ itemId?: string }> }).items ?? []).map((i) => i.itemId ?? '')),
    )
    return c.json({
      ok: true,
      data: {
        projectId: a.projectId,
        organizationId: a.orgId,
        staleDays,
        repos,
        actions: actions.map(wireAction),
        items: items ?? [],
        restorable: (items ?? []).filter((r) => restorable(r) && !pendingRestore.has(r.id)),
        migrationPending: items === null,
        canDecide: role === 'owner' || role === 'admin',
        canRequest: a.role !== 'viewer',
        limits: { maxItems: MAX_HOUSEKEEPING_ITEMS, perHour: HOUSEKEEPING_ACTIONS_PER_HOUR, approvalMinutes: 60 },
        raceNote: RACE_NOTE,
      },
    })
  } catch (err) {
    hlog.error('repo clean-up preview failed', { projectId: a.projectId, err: err instanceof Error ? err.message : String(err) })
    return jsonError(c, 'REPO_CLEANUP_FAILED', 'Mushi could not build the clean-up list. Try again in a minute.', 500)
  }
}

const requestSchema = z
  .object({
    action: z.enum(['delete_branches', 'close_prs', 'set_delete_branch_on_merge']),
    repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'owner/repo'),
    keys: z.array(z.string().min(1).max(300)).min(1).max(MAX_HOUSEKEEPING_ITEMS).optional(),
    staleDays: z.number().int().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()

/** Clean-ups (restores excepted) run for this app in the last hour; null when unreadable. */
async function runsLastHour(db: Db, projectId: string, now: Date): Promise<number | null> {
  const { data, error } = await db
    .from('connector_actions')
    .select('id')
    .eq('project_id', projectId)
    .in('action', ['delete_branches', 'close_prs', 'set_delete_branch_on_merge'])
    .gt('executed_at', new Date(now.getTime() - 3600_000).toISOString())
  return error ? null : ((data ?? []) as unknown[]).length
}

async function store(c: Context, db: Db, a: Access, action: string, payload: Record<string, unknown>, reason: string | null): Promise<Response> {
  const r = await requestLegacyConnectorAction(db as never, { organizationId: a.orgId, projectId: a.projectId, kind: 'github', action, payload, requestedBy: requester(c), reason })
  if (!r.ok) return jsonError(c, r.code, r.message, r.status)
  return c.json({ ok: true, data: { id: r.value.id, status: 'pending_approval', payloadSha256: r.value.payloadSha256, payload, next: 'A team owner or admin approves it in the console (Repo → Clean up), then runs it within an hour.' } }, 201)
}

async function requestRoute(c: Context, deps: RepoHousekeepingRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const a = await access(c, deps, db)
  if ('refused' in a) return a.refused
  const viewer = denyViewerWrite(c, a.role, 'ask for a repo clean-up')
  if (viewer) return viewer
  const parsed = requestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
  const body = parsed.data
  const repo = body.repo.toLowerCase()
  const rate = await deps.claimRateLimit(db as never, `project:${a.projectId}:repo_cleanup_request`, HOUSEKEEPING_ACTIONS_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `At most ${HOUSEKEEPING_ACTIONS_PER_HOUR} clean-ups an hour per app.`, 429)
  }
  const staleDays = clampStaleDays(body.staleDays)
  let preview: RepoPreview | undefined
  try {
    const actions = await loadActions(db, a.projectId)
    preview = (await buildPreview(db, deps, a.projectId, staleDays, actions, repo))[0]
  } catch (err) {
    hlog.error('repo clean-up request preview failed', { projectId: a.projectId, err: err instanceof Error ? err.message : String(err) })
    return jsonError(c, 'REPO_CLEANUP_FAILED', 'Mushi could not build the clean-up list. Try again in a minute.', 500)
  }
  if (!preview) return jsonError(c, 'REPO_NOT_IN_PROJECT', `${body.repo} is not connected to this app.`, 404)
  if (preview.error) return jsonError(c, 'GITHUB_UNREADABLE', preview.error, 409)
  const reason = body.reason ?? null

  if (body.action === 'set_delete_branch_on_merge') {
    if (preview.deleteBranchOnMerge) return jsonError(c, 'ALREADY_ON', '"Automatically delete head branches" is already on for this repository.', 409)
    if (preview.settingPending) return jsonError(c, 'ALREADY_ASKED', 'Turning this on is already waiting for a decision.', 409)
    const payload: SettingPayload = { repo, setting: 'delete_branch_on_merge', value: true, expected: false }
    return store(c, db, a, body.action, payload as unknown as Record<string, unknown>, reason)
  }

  const pool: Array<{ key: string }> = body.action === 'delete_branches' ? preview.branches : preview.prs
  const keys = body.keys ?? pool.slice(0, MAX_HOUSEKEEPING_ITEMS).map((x) => x.key)
  if (keys.length === 0) return jsonError(c, 'NOTHING_TO_CLEAN', 'Nothing in this repository needs cleaning up now.', 409)
  if (keys.length > MAX_HOUSEKEEPING_ITEMS) return jsonError(c, 'TOO_MANY_ITEMS', `At most ${MAX_HOUSEKEEPING_ITEMS} items in one clean-up.`, 400)
  const missing = keys.filter((k) => !pool.some((x) => x.key === k))
  if (missing.length > 0) {
    const why = new Map(preview.kept.map((k) => [k.key, k.reason]))
    return jsonError(c, 'NOT_A_CANDIDATE', `${missing.length} item${missing.length === 1 ? ' is' : 's are'} not on the clean-up list now. Reload the preview.`, 409, {
      items: missing.slice(0, 20).map((k) => ({ key: k, reason: why.get(k) ?? 'Not something Mushi recorded, or no longer there.' })),
    })
  }
  const chosen = new Set(keys)
  if (body.action === 'delete_branches') {
    const payload: DeleteBranchesPayload = {
      repo,
      defaultBranch: preview.defaultBranch ?? '',
      items: preview.branches.filter((b) => chosen.has(b.key)).map((b) => ({ key: b.key, branch: b.branch, headSha: b.headSha, prNumber: b.prNumber, prState: b.prState, reason: b.reason })),
    }
    return store(c, db, a, body.action, payload as unknown as Record<string, unknown>, reason)
  }
  const payload: ClosePrsPayload = {
    repo,
    staleDays,
    items: preview.prs.filter((p) => chosen.has(p.key)).map((p) => ({ key: p.key, prNumber: p.prNumber, headSha: p.headSha, branch: p.branch, fixAttemptId: p.fixAttemptId, reason: p.reason })),
  }
  return store(c, db, a, body.action, payload as unknown as Record<string, unknown>, reason)
}

const restoreSchema = z
  .object({
    itemIds: z.array(z.string().regex(UUID_RE, 'uuid')).min(1).max(MAX_HOUSEKEEPING_ITEMS),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()

async function restoreRoute(c: Context, deps: RepoHousekeepingRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const a = await access(c, deps, db)
  if ('refused' in a) return a.refused
  const viewer = denyViewerWrite(c, a.role, 'ask to restore branches')
  if (viewer) return viewer
  const parsed = restoreSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
  const ids = [...new Set(parsed.data.itemIds)]
  const { data, error } = await db
    .from('repo_housekeeping_items')
    .select('id, action_id, project_id, repo, action, item_key, branch, deleted_sha, outcome, restored_at')
    .in('id', ids)
  if (error) {
    if (isMissingTable(error)) return jsonError(c, 'MIGRATION_PENDING', 'Restore needs the database update 20261027183000_repo_housekeeping_items first.', 409)
    return jsonError(c, 'DB_ERROR', 'Mushi could not read its clean-up log.', 500)
  }
  const rows = ((data ?? []) as Array<ItemRow & { project_id: string }>).filter((r) => r.project_id === a.projectId)
  const bad = ids.filter((id) => !rows.some((r) => r.id === id && restorable(r)))
  if (bad.length > 0) return jsonError(c, 'NOT_RESTORABLE', `${bad.length} item${bad.length === 1 ? ' is' : 's are'} not a branch Mushi deleted for this app, or already restored.`, 409, { itemIds: bad })
  const repos = [...new Set(rows.map((r) => r.repo))]
  if (repos.length !== 1) return jsonError(c, 'ONE_REPO', 'Restore branches of one repository at a time.', 400)
  let actions: HousekeepingActionRow[]
  try {
    actions = await loadActions(db, a.projectId)
  } catch {
    return jsonError(c, 'DB_ERROR', 'Mushi could not read its clean-ups.', 500)
  }
  const waiting = new Set(actions.filter((x) => x.action === 'restore_branches' && ['pending_approval', 'approved', 'executing'].includes(x.status))
    .flatMap((x) => ((x.payload as { items?: Array<{ itemId?: string }> }).items ?? []).map((i) => i.itemId ?? '')))
  if (ids.some((id) => waiting.has(id))) return jsonError(c, 'ALREADY_ASKED', 'Restoring some of these is already waiting for a decision.', 409)
  const payload: RestorePayload = {
    repo: repos[0],
    restoreOf: rows[0].action_id,
    items: ids.map((id) => {
      const r = rows.find((x) => x.id === id) as ItemRow
      return { key: `branch:${r.branch}`, itemId: r.id, branch: r.branch as string, sha: r.deleted_sha as string }
    }),
  }
  return store(c, db, a, 'restore_branches', payload as unknown as Record<string, unknown>, parsed.data.reason ?? 'Restore branches Mushi deleted')
}

async function decideRoute(c: Context, deps: RepoHousekeepingRouteDeps, verb: 'approve' | 'reject' | 'execute'): Promise<Response> {
  if (c.get('authMethod') === 'apiKey') return jsonError(c, 'HUMAN_REQUIRED', 'Only a person signed in to the console can approve or run a repo clean-up. An API key can only ask.', 403)
  const db = deps.getServiceClient()
  const projectId = c.req.param('id') ?? ''
  const id = c.req.param('actionId') ?? ''
  if (!UUID_RE.test(projectId) || !UUID_RE.test(id)) return jsonError(c, 'NOT_FOUND', 'Clean-up not found.', 404)
  const { data } = await db.from('connector_actions').select(ACTION_COLUMNS).eq('id', id).maybeSingle()
  const row = (data as HousekeepingActionRow | null) ?? null
  if (!row || row.project_id !== projectId || row.connector_kind !== 'github' || !isHousekeepingAction(row.action)) return jsonError(c, 'NOT_FOUND', 'Clean-up not found.', 404)
  const userId = c.get('userId') as string
  const role = await orgRole(db, row.organization_id, userId)
  if (!role) return jsonError(c, 'NOT_FOUND', 'Clean-up not found.', 404)
  if (role !== 'owner' && role !== 'admin') return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can approve or run a repo clean-up.', 403)
  if (verb === 'approve') {
    const body = (await c.req.json().catch(() => null)) as { payloadSha256?: unknown } | null
    const r = await approveConnectorAction(db as never, row.id, row.organization_id, userId, deps.now(), body?.payloadSha256)
    return r.ok ? c.json({ ok: true, data: r.value }) : jsonError(c, r.code, r.message, r.status)
  }
  if (verb === 'reject') {
    const r = await rejectConnectorAction(db as never, row.id, row.organization_id, userId)
    return r.ok ? c.json({ ok: true, data: null }) : jsonError(c, r.code, r.message, r.status)
  }
  // The hourly cap is checked before the run claims the approval, so a refusal here leaves it usable.
  if (row.action !== 'restore_branches') {
    const ran = await runsLastHour(db, projectId, deps.now())
    if (ran === null) return jsonError(c, 'DB_ERROR', 'Mushi could not count this app’s clean-ups. Try again in a minute.', 500)
    if (ran >= HOUSEKEEPING_ACTIONS_PER_HOUR) return jsonError(c, 'RATE_LIMITED', `At most ${HOUSEKEEPING_ACTIONS_PER_HOUR} clean-ups run an hour per app. It stays approved until its approval ends; run it after the hour.`, 429)
  }
  const run = executeConnectorAction(db as never, row.id, row.organization_id, userId, executeDeps(deps))
  let timer: ReturnType<typeof setTimeout> | undefined
  const done = await Promise.race([run, new Promise<null>((r) => (timer = setTimeout(() => r(null), deps.executeWaitMs ?? EXECUTE_WAIT_MS)))])
  clearTimeout(timer)
  if (done === null) {
    runInBackground(run, 'repo-cleanup-execute')
    return c.json({ ok: true, data: { id: row.id, status: 'executing', next: 'Still running. Each item\'s result appears in Repo → Clean up as it finishes.' } }, 202)
  }
  return done.ok ? c.json({ ok: true, data: done.value }) : jsonError(c, done.code, done.message, done.status)
}
