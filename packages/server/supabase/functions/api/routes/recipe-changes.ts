/**
 * recipe-changes.ts — push changes (Plan 019 Phase 3) and the act path
 * (Plan 020 Phase 4), all behind a human.
 *
 *   POST /v1/admin/projects/:id/recipe/changes            adminOrApiKey(mcp:write)  dry run by default; dryRun:false opens ONE draft PR
 *   GET  /v1/admin/projects/:id/recipe/changes/:jobId     adminOrApiKey(mcp:read)
 *   POST /v1/admin/orgs/:orgId/portfolio/changes          adminOrApiKey(mcp:write)  "fix once": one draft PR per repo (≤ 10), shared batch_id
 *   GET  /v1/admin/orgs/:orgId/releases                   adminOrApiKey(mcp:read)   release calendar + the batch to release now vs next (read-only)
 *   GET  /v1/admin/orgs/:orgId/connector-actions          adminOrApiKey(mcp:read)
 *   POST /v1/admin/orgs/:orgId/connector-actions          adminOrApiKey(mcp:write)  REQUEST an action; nothing runs
 *   POST /v1/admin/orgs/:orgId/connector-actions/:id/approve   console JWT only, owner/admin
 *   POST /v1/admin/orgs/:orgId/connector-actions/:id/reject    console JWT only, owner/admin
 *   POST /v1/admin/orgs/:orgId/connector-actions/:id/execute   console JWT only, owner/admin; runs once
 *
 * Every PR is a draft (markReady:false) to allowlisted paths; nothing merges
 * or publishes. An API key (and so MCP) can request an action but never
 * approve or execute it.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { createPrFromFiles, findOpenPrByHeadPrefix } from '../../_shared/github-pr.ts'
import { getDefaultHead, readRepoFile, resolveRecipeRepo } from '../../_shared/recipe-github.ts'
import { MAX_BATCH_REPOS, planRecipeChange, RECIPE_CHANGE_ELEMENTS, runRecipeChange, type ChangeDeps } from '../../_shared/recipe-change.ts'
import { approveConnectorAction, executeConnectorAction, rejectConnectorAction, requestConnectorAction, type ExecuteDeps } from '../../_shared/connector-actions.ts'
import { calendarAppsFrom, releaseCalendar } from '../../_shared/store-review.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { portfolioAccess } from './portfolio.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Db = ReturnType<typeof getServiceClient>

export interface RecipeChangeRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  change: ChangeDeps
  execute: ExecuteDeps
}

export const defaultRecipeChangeDeps: RecipeChangeRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  change: { resolveRepo: resolveRecipeRepo, getDefaultHead, readRepoFile, createPr: createPrFromFiles, findOpenPr: findOpenPrByHeadPrefix, now: () => new Date() },
  execute: { fetch: (url, init) => fetch(url, init), now: () => new Date() },
}

const editSchema = z.object({ path: z.string().min(1).max(400), content: z.string().max(512 * 1024), reason: z.string().max(200).optional() })
const changeSchema = z.object({
  element: z.enum(RECIPE_CHANGE_ELEMENTS),
  edits: z.array(editSchema).min(1).max(30),
  dryRun: z.boolean().default(true),
  title: z.string().min(1).max(120).optional(),
}).strict()
const batchSchema = z.object({
  element: z.enum(RECIPE_CHANGE_ELEMENTS),
  changes: z.array(z.object({ projectId: z.string().uuid(), edits: z.array(editSchema).min(1).max(30) })).min(1).max(MAX_BATCH_REPOS),
  dryRun: z.boolean().default(true),
  title: z.string().min(1).max(120).optional(),
}).strict()
const actionSchema = z.object({
  connectorId: z.string().uuid(),
  action: z.string().min(1).max(60),
  payload: z.record(z.string(), z.unknown()).refine((p) => JSON.stringify(p).length <= 8192, 'payload is over 8 KB'),
  projectId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
}).strict()

function requester(c: Context): string {
  return c.get('authMethod') === 'apiKey' ? `mcp:${String(c.get('apiKeyPrefix') ?? 'key')}` : `user:${String(c.get('userId'))}`
}

async function isOrgAdmin(db: Db, orgId: string, userId: string): Promise<boolean> {
  const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  const role = (data as { role?: string } | null)?.role
  return role === 'owner' || role === 'admin'
}

/** Approve / reject / execute: a person in the console, never a key. */
async function humanAdmin(c: Context, db: Db): Promise<{ ok: true; orgId: string; userId: string } | { ok: false; response: Response }> {
  if (c.get('authMethod') === 'apiKey') return { ok: false, response: jsonError(c, 'HUMAN_REQUIRED', 'Only a person signed in to the console can approve or run an action. An API key can only ask.', 403) }
  const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
  if (!access.ok) return access
  const userId = c.get('userId') as string
  if (!(await isOrgAdmin(db, access.orgId, userId))) return { ok: false, response: jsonError(c, 'FORBIDDEN', 'Only team owners and admins can approve or run actions.', 403) }
  return { ok: true, orgId: access.orgId, userId }
}

function issues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500)
}

export function registerRecipeChangeRoutes(app: Hono<{ Variables: Variables }>, deps: RecipeChangeRouteDeps = defaultRecipeChangeDeps): void {
  app.post('/v1/admin/projects/:id/recipe/changes', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const projectId = c.req.param('id') ?? ''
    if (!UUID_RE.test(projectId)) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
    const access = await callerCanAccessProject(c, db, c.get('userId') as string, projectId)
    if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
    const parsed = changeSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
    const body = parsed.data
    if (!body.dryRun && c.get('authMethod') !== 'apiKey' && access.role !== 'owner' && access.role !== 'admin') {
      return jsonError(c, 'FORBIDDEN', 'Only project owners and admins can open recipe PRs.', 403)
    }
    if (body.dryRun) {
      const plan = await planRecipeChange(db, projectId, body.element, body.edits, deps.change).catch((err) => ({ ok: false, reason: (err as Error).message, files: [], denied: [] }))
      return c.json({ ok: true, data: { dryRun: true, ok: plan.ok, reason: plan.reason, files: plan.files.map(({ before: _b, after: _a, ...f }) => f), denied: plan.denied } })
    }
    const job = await runRecipeChange(db, { projectId, element: body.element, edits: body.edits, title: body.title ?? `chore(recipe): update ${body.element}`, requestedBy: requester(c) }, deps.change)
    if (job.status === 'rejected' && /not writable/i.test(job.error ?? '')) return jsonError(c, 'PATH_NOT_WRITABLE', job.error!, 400, { jobId: job.jobId })
    return c.json({ ok: true, data: job }, job.status === 'pr_opened' ? 201 : 200)
  })

  app.get('/v1/admin/projects/:id/recipe/changes/:jobId', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const projectId = c.req.param('id') ?? ''
    const jobId = c.req.param('jobId') ?? ''
    if (!UUID_RE.test(projectId) || !UUID_RE.test(jobId)) return jsonError(c, 'NOT_FOUND', 'Not found', 404)
    const access = await callerCanAccessProject(c, db, c.get('userId') as string, projectId)
    if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Not found', 404)
    const { data } = await db.from('recipe_change_jobs').select('id, element, status, pr_url, pr_number, branch, error, batch_id, created_at, finished_at').eq('id', jobId).eq('project_id', projectId).maybeSingle()
    if (!data) return jsonError(c, 'NOT_FOUND', 'Not found', 404)
    return c.json({ ok: true, data })
  })

  app.post('/v1/admin/orgs/:orgId/portfolio/changes', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const parsed = batchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
    const body = parsed.data
    for (const ch of body.changes) if (!access.projectIds.includes(ch.projectId)) return jsonError(c, 'NOT_FOUND', 'A project is not in this team.', 404)
    if (body.dryRun) {
      const plans = []
      for (const ch of body.changes) {
        const plan = await planRecipeChange(db, ch.projectId, body.element, ch.edits, deps.change).catch((err) => ({ ok: false, reason: (err as Error).message, files: [], denied: [] }))
        plans.push({ projectId: ch.projectId, ok: plan.ok, reason: plan.reason, files: plan.files.map(({ before: _b, after: _a, ...f }) => f), denied: plan.denied })
      }
      return c.json({ ok: true, data: { dryRun: true, plans } })
    }
    if (c.get('authMethod') !== 'apiKey' && !(await isOrgAdmin(db, access.orgId, c.get('userId') as string))) {
      return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can open PRs across apps.', 403)
    }
    const batchId = crypto.randomUUID()
    const results = []
    // One repo failing never rolls back the others; each result says what happened.
    for (const ch of body.changes) {
      results.push(await runRecipeChange(db, { projectId: ch.projectId, element: body.element, edits: ch.edits, title: body.title ?? `chore(recipe): update ${body.element}`, requestedBy: requester(c), batchId }, deps.change))
    }
    return c.json({ ok: true, data: { batchId, opened: results.filter((r) => r.status === 'pr_opened').length, results } })
  })

  app.get('/v1/admin/orgs/:orgId/releases', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const ids = access.projectIds.slice(0, 50)
    if (ids.length === 0) return c.json({ ok: true, data: { rows: [], batchSuggestion: null } })
    const reads = await Promise.all([
      db.from('projects').select('id, name').in('id', ids),
      db.from('deploy_observations').select('project_id, observed_version, observed_at, ok').in('project_id', ids).order('observed_at', { ascending: false }).limit(500),
      db.from('fix_attempts').select('project_id, merged_at, files_changed').in('project_id', ids).order('merged_at', { ascending: false, nullsFirst: false }).limit(500),
      db.from('ci_workflow_runs').select('project_id, est_billable_minutes').in('project_id', ids).limit(5000),
      db.from('connector_snapshots').select('project_id, kind, snapshot').in('project_id', ids).in('kind', ['app_store_connect', 'play_console']).eq('is_current', true).eq('ok', true),
    ])
    // A failed read must not turn into "nothing is waiting to ship".
    if (reads.some((r) => r.error)) return jsonError(c, 'DB_ERROR', 'The release calendar could not be read. Try again in a minute.', 500)
    const [{ data: projects }, { data: obs }, { data: fixes }, { data: runs }, { data: snaps }] = reads
    const apps = calendarAppsFrom(
      (projects ?? []) as Array<{ id: string; name: string | null }>,
      (obs ?? []) as Array<{ project_id: string; observed_version: string | null; observed_at: string; ok: boolean }>,
      (fixes ?? []) as Array<{ project_id: string; merged_at: string | null; files_changed?: unknown }>,
      (snaps ?? []) as unknown as Parameters<typeof calendarAppsFrom>[3],
    )
    const minutes: Record<string, number> = {}
    for (const id of ids) {
      const rs = ((runs ?? []) as Array<{ project_id: string; est_billable_minutes: number | null }>).filter((r) => r.project_id === id && r.est_billable_minutes != null)
      if (rs.length) minutes[id] = Math.round(rs.reduce((n, r) => n + Number(r.est_billable_minutes), 0) / rs.length)
    }
    return c.json({ ok: true, data: { ...releaseCalendar(apps, minutes), note: 'CI minutes are estimated from past runs. Mushi proposes the batch; your CI builds and submits.' } })
  })

  app.get('/v1/admin/orgs/:orgId/connector-actions', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const { data } = await db.from('connector_actions')
      .select('id, connector_instance_id, project_id, action, payload, payload_sha256, reason, status, requested_by, requested_at, approved_by, approved_at, expires_at, executed_at, result, error')
      .eq('organization_id', access.orgId).order('requested_at', { ascending: false }).limit(100)
    return c.json({ ok: true, data: { actions: data ?? [] } })
  })

  app.post('/v1/admin/orgs/:orgId/connector-actions', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const parsed = actionSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', issues(parsed.error), 400)
    const body = parsed.data
    if (body.projectId && !access.projectIds.includes(body.projectId)) return jsonError(c, 'NOT_FOUND', 'That project is not in this team.', 404)
    const r = await requestConnectorAction(db, { organizationId: access.orgId, instanceId: body.connectorId, action: body.action, payload: body.payload, requestedBy: requester(c), reason: body.reason, projectId: body.projectId })
    if (!r.ok) return jsonError(c, r.code, r.message, r.status)
    return c.json({ ok: true, data: { id: r.value.id, status: 'pending_approval', payloadSha256: r.value.payloadSha256, next: 'A team owner or admin approves it in the console, then runs it.' } }, 201)
  })

  for (const verb of ['approve', 'reject', 'execute'] as const) {
    app.post(`/v1/admin/orgs/:orgId/connector-actions/:actionId/${verb}`, deps.jwtAuth, async (c) => {
      const db = deps.getServiceClient()
      const who = await humanAdmin(c, db)
      if (!who.ok) return who.response
      const id = c.req.param('actionId') ?? ''
      if (!UUID_RE.test(id)) return jsonError(c, 'NOT_FOUND', 'Action not found.', 404)
      const r = verb === 'approve'
        ? await approveConnectorAction(db, id, who.orgId, who.userId, deps.execute.now())
        : verb === 'reject'
          ? await rejectConnectorAction(db, id, who.orgId, who.userId)
          : await executeConnectorAction(db, id, who.orgId, who.userId, deps.execute)
      if (!r.ok) return jsonError(c, r.code, r.message, r.status)
      return c.json({ ok: true, data: r.value })
    })
  }
}
