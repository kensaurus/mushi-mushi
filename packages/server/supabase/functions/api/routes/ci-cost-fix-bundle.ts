/**
 * ci-cost-fix-bundle.ts — "Apply to every app" for the CI cost fixes (ADR 0047
 * amendment 2026-10-27). Served by `api-ext` (`/v1/admin/ci/*` is forwarded
 * there). One reviewed draft PR per repo, with a preview first.
 *
 *   GET  /v1/admin/ci/cost-fix-rollout       adminOrApiKey(mcp:read)
 *        ?project_id= one app, else every app the caller may change (viewers'
 *        apps are left out). Every advice item with an `autofix`, grouped per
 *        app and repo, with the estimated saving per item and per repo, its
 *        state (ready, PR still open, in progress) and, per repo, the reason
 *        its GitHub access cannot edit workflows when Mushi already knows it
 *        (rollout preview: _shared/ci-cost-fix-rollout.ts). Read-only.
 *   POST /v1/admin/ci/cost-fix-rollout       adminOrApiKey(mcp:write), non-viewers
 *        { repos: [{ projectId, repo, items: [{ workflowPath, kind }] }] }
 *        ≤ 10 repos, ≤ 20 items each. Rebuilds the advice server-side and
 *        queues only items still advised (evidence and saving come from it,
 *        never from the client), skipping an edit whose PR is still open or
 *        that is in flight. One bundle per repo (one PR), each counting once
 *        against the project's 10 CI fix PRs an hour. Fires ci-cost-fix-worker
 *        with { bundleId }. Answers per repo: queued (with its jobs), skipped
 *        (and why, per item) or an error in plain words.
 *   GET  /v1/admin/ci/cost-fix-bundles/:id       adminOrApiKey(mcp:read)
 *        The bundle: its PR, each fix's state, summary or refusal, and after
 *        the merge the saving measured per workflow. A bundle still queued
 *        after 2 minutes is fired again.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { buildCiOverview, loadCiOverviewRows } from '../../_shared/ci-overview.ts'
import { buildCiCompare } from '../../_shared/ci-compare.ts'
import { loadCiCompareInput } from '../../_shared/ci-compare-load.ts'
import type { CiOverviewAdvice } from '../../_shared/ci-overview-types.ts'
import { COST_FIX_JOB_COLUMNS, findProjectRepo, toCostFixView, type CostFixJobRow } from '../../_shared/ci-cost-fix-runner.ts'
import { BUNDLE_MAX_ITEMS, BUNDLE_MAX_REPOS, refreshCostFixBundle, toCostFixBundleView } from '../../_shared/ci-cost-fix-bundle.ts'
import { buildRolloutPreview, rolloutKey, type RolloutJobRow } from '../../_shared/ci-cost-fix-rollout.ts'
import { COST_FIXES_PER_HOUR, costFixRequestSchema, invokeCostFixWorker, REFIRE_AFTER_MS } from './ci-cost-fix.ts'
import { knownWorkflowsAbility } from '../../_shared/setup-gaps.ts'
import { callerCanAccessProject, callerProjectIds, jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'

const blog = log.child('ci-cost-fix-bundle-routes')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Apps whose roles the preview reads; more are left out and the preview says so. */
export const ROLLOUT_MAX_PROJECTS = 50
const ROLLOUT_JOB_COLUMNS = 'project_id, repo, workflow_path, kind, status, pr_url, merged_at, closed_at, error_code, created_at'

const shape = costFixRequestSchema.shape
export const bundleRequestSchema = z.object({
  repos: z
    .array(
      z.object({
        projectId: shape.projectId,
        repo: shape.repo,
        items: z.array(z.object({ workflowPath: shape.workflowPath, kind: shape.kind })).min(1).max(BUNDLE_MAX_ITEMS, `at most ${BUNDLE_MAX_ITEMS} fixes per repo`),
      }),
    )
    .min(1)
    .max(BUNDLE_MAX_REPOS, `at most ${BUNDLE_MAX_REPOS} repos per request`),
})

type Db = ReturnType<typeof getServiceClient>

export interface CiCostFixBundleRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  claimRateLimit: typeof claimTenantRateLimit
  callerCanAccessProject: typeof callerCanAccessProject
  callerProjectIds: typeof callerProjectIds
  findProjectRepo: typeof findProjectRepo
  /** Every advice item for these apps (the overview's and the cost comparison's); `partial` says what could not be read. */
  loadAdvice: (db: Db, projectIds: string[], now: Date) => Promise<{ advice: CiOverviewAdvice[]; partial: string | null }>
  /** What the setup check already knows about workflow edits in a repo (cache only, never a probe). */
  workflowsAbility: (projectId: string, repo: string, nowMs: number) => 'yes' | 'read_only' | 'no' | 'unknown' | null
  refreshBundle: (db: Db, rows: CostFixJobRow[]) => Promise<CostFixJobRow[]>
  invokeBundleWorker: (bundleId: string) => void
  logAudit: typeof logAudit
  now: () => Date
  newId: () => string
}

const DAY_MS = 24 * 60 * 60_000

/** The autofix advice of both CI views, as GET /v1/admin/ci/overview and /compare build it. */
export async function loadAutofixAdvice(db: Db, projectIds: string[], now: Date): Promise<{ advice: CiOverviewAdvice[]; partial: string | null }> {
  const from7 = new Date(now.getTime() - 7 * DAY_MS)
  const from30 = new Date(now.getTime() - 30 * DAY_MS)
  const [overview, compare] = await Promise.allSettled([
    loadCiOverviewRows(db as never, projectIds, from7).then((rows) => buildCiOverview(rows, { now, days: 7, from: from7, refreshedAt: rows.lastLiveSyncAt }).advice),
    loadCiCompareInput(db as never, projectIds, from30, now).then((loaded) => buildCiCompare({ ...loaded, now, days: 30, from: from30, to: now }).advice),
  ])
  if (overview.status === 'rejected' && compare.status === 'rejected') throw overview.reason
  const missing = [overview.status === 'rejected' ? 'the speed advice' : null, compare.status === 'rejected' ? 'the cost advice' : null].filter(Boolean)
  return {
    advice: [...(overview.status === 'fulfilled' ? overview.value : []), ...(compare.status === 'fulfilled' ? compare.value : [])].filter((a) => a.autofix),
    partial: missing.length > 0 ? `Mushi could not read ${missing.join(' or ')} just now, so some fixes may be missing. Try again in a minute.` : null,
  }
}

export const defaultCiCostFixBundleRouteDeps: CiCostFixBundleRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  claimRateLimit: claimTenantRateLimit,
  callerCanAccessProject,
  callerProjectIds,
  findProjectRepo,
  loadAdvice: loadAutofixAdvice,
  workflowsAbility: knownWorkflowsAbility,
  refreshBundle: (db, rows) => refreshCostFixBundle(db as never, rows),
  invokeBundleWorker: (bundleId) => invokeCostFixWorker({ bundleId }),
  logAudit,
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
}

export function registerCiCostFixBundleRoutes(app: Hono<{ Variables: Variables }>, deps: CiCostFixBundleRouteDeps = defaultCiCostFixBundleRouteDeps): void {
  app.get('/v1/admin/ci/cost-fix-rollout', deps.adminOrApiKeyRead, (c) => previewRollout(c, deps))
  app.post('/v1/admin/ci/cost-fix-rollout', deps.adminOrApiKeyWrite, (c) => openBundles(c, deps))
  app.get('/v1/admin/ci/cost-fix-bundles/:id', deps.adminOrApiKeyRead, (c) => getBundle(c, deps))
}

const missingObject = (message: string) => /ci_cost_fix_jobs|bundle_id/.test(message) && /does not exist|schema cache/i.test(message)

/** The apps among `ids` the caller may change (not a viewer), at most ROLLOUT_MAX_PROJECTS. */
async function writableProjects(c: Context, deps: CiCostFixBundleRouteDeps, db: Db, ids: string[]): Promise<{ writable: string[]; truncated: boolean }> {
  const userId = c.get('userId') as string
  const checked = await Promise.all(ids.slice(0, ROLLOUT_MAX_PROJECTS).map(async (id) => ({ id, access: await deps.callerCanAccessProject(c, db, userId, id) })))
  return { writable: checked.filter((p) => p.access.allowed && p.access.role !== 'viewer').map((p) => p.id), truncated: ids.length > ROLLOUT_MAX_PROJECTS }
}

async function previewRollout(c: Context, deps: CiCostFixBundleRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const userId = c.get('userId') as string
  const requested = c.req.query('project_id') ?? c.req.query('projectId') ?? null
  if (requested && !UUID_RE.test(requested)) return jsonError(c, 'VALIDATION_ERROR', 'project_id must be a uuid', 400)
  const ids = await deps.callerProjectIds(c, db, userId)
  if (requested && !ids.includes(requested)) return jsonError(c, 'FORBIDDEN', 'You cannot read this project.', 403)
  const { writable, truncated } = await writableProjects(c, deps, db, requested ? [requested] : ids)
  const now = deps.now()
  const caps = { reposPerRequest: BUNDLE_MAX_REPOS, itemsPerRepo: BUNDLE_MAX_ITEMS }
  if (writable.length === 0) {
    return c.json({ ok: true, data: buildRolloutPreview({ now, advice: [], projects: [], jobs: [], workflowsAbility: () => null, caps }) })
  }

  const [names, jobsRes] = await Promise.all([
    db.from('projects').select('id, name').in('id', writable),
    db.from('ci_cost_fix_jobs').select(ROLLOUT_JOB_COLUMNS).in('project_id', writable).order('created_at', { ascending: false }).limit(500),
  ])
  if (jobsRes.error && !missingObject(jobsRes.error.message)) return jsonError(c, 'DB_ERROR', 'Could not read the CI fixes Mushi already opened.', 500)
  let loaded: { advice: CiOverviewAdvice[]; partial: string | null }
  try {
    loaded = await deps.loadAdvice(db, writable, now)
  } catch (err) {
    blog.error('rollout advice read failed', { err: err instanceof Error ? err.message : String(err) })
    return jsonError(c, 'CI_ADVICE_FAILED', 'The CI advice could not be read. Try again in a minute.', 500)
  }
  const nowMs = now.getTime()
  const partial = [loaded.partial, truncated ? `Only your first ${ROLLOUT_MAX_PROJECTS} apps are included.` : null].filter(Boolean).join(' ') || null
  return c.json({
    ok: true,
    data: buildRolloutPreview({
      now,
      advice: loaded.advice,
      projects: ((names.data ?? []) as Array<{ id: string; name: string | null }>).filter((p) => writable.includes(p.id)),
      jobs: (jobsRes.error ? [] : (jobsRes.data ?? [])) as RolloutJobRow[],
      workflowsAbility: (projectId, repo) => deps.workflowsAbility(projectId, repo, nowMs),
      caps,
      partial,
    }),
  })
}

interface SkippedItem {
  workflowPath: string
  kind: string
  code: 'NOT_ADVISED' | 'PR_ALREADY_OPEN' | 'COST_FIX_IN_PROGRESS'
  message: string
  prUrl: string | null
}

interface RepoResult {
  projectId: string
  repo: string
  status: 'queued' | 'skipped' | 'error'
  bundleId: string | null
  jobs: ReturnType<typeof toCostFixView>[]
  skipped: SkippedItem[]
  error: { code: string; message: string } | null
}

async function openBundles(c: Context, deps: CiCostFixBundleRouteDeps): Promise<Response> {
  const raw = await c.req.json().catch(() => null)
  const parsed = bundleRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; ').slice(0, 300), 400)
  }
  const groups = parsed.data.repos
  const seen = new Set<string>()
  for (const g of groups) {
    const k = `${g.projectId}:${g.repo.toLowerCase()}`
    if (seen.has(k)) return jsonError(c, 'VALIDATION_ERROR', `${g.repo} is listed twice; put all its fixes in one entry.`, 400)
    seen.add(k)
  }

  const db = deps.getServiceClient()
  const userId = c.get('userId') as string
  const byApiKey = c.get('authMethod') === 'apiKey'
  const projectIds = [...new Set(groups.map((g) => g.projectId))]
  const access = new Map(await Promise.all(projectIds.map(async (id) => [id, await deps.callerCanAccessProject(c, db, userId, id)] as const)))
  const writable = projectIds.filter((id) => access.get(id)?.allowed && access.get(id)?.role !== 'viewer')

  const now = deps.now()
  let adviceByKey = new Map<string, CiOverviewAdvice>()
  let activeJobs: RolloutJobRow[] = []
  if (writable.length > 0) {
    try {
      const { advice } = await deps.loadAdvice(db, writable, now)
      adviceByKey = new Map(advice.filter((a) => a.autofix).map((a) => [rolloutKey(a.autofix!), a]))
    } catch (err) {
      blog.error('bundle advice read failed', { err: err instanceof Error ? err.message : String(err) })
      return jsonError(c, 'CI_ADVICE_FAILED', 'The CI advice could not be read, so nothing was opened. Try again in a minute.', 500)
    }
    const { data, error } = await db
      .from('ci_cost_fix_jobs')
      .select(ROLLOUT_JOB_COLUMNS)
      .in('project_id', writable)
      .in('status', ['queued', 'running', 'pr_opened'])
      .is('merged_at', null)
      .is('closed_at', null)
      .limit(1000)
    if (error && !missingObject(error.message)) return jsonError(c, 'DB_ERROR', 'Could not read the CI fixes Mushi already opened.', 500)
    activeJobs = (error ? [] : (data ?? [])) as RolloutJobRow[]
  }

  const results: RepoResult[] = []
  for (const g of groups) {
    const result: RepoResult = { projectId: g.projectId, repo: g.repo, status: 'error', bundleId: null, jobs: [], skipped: [], error: null }
    results.push(result)
    const a = access.get(g.projectId)
    if (!a?.allowed) {
      result.error = { code: 'NOT_FOUND', message: 'Project not found.' }
      continue
    }
    if (a.role === 'viewer') {
      result.error = { code: 'FORBIDDEN', message: 'Viewers have read-only access, so they cannot open CI fix pull requests. Ask a team owner or admin for member access.' }
      continue
    }
    const repo = await deps.findProjectRepo(db as never, g.projectId, g.repo)
    if (!repo) {
      result.error = { code: 'REPO_NOT_IN_PROJECT', message: `${g.repo} is not connected to this project.` }
      continue
    }
    const repoName = `${repo.ref.owner}/${repo.ref.repo}`
    result.repo = repoName

    const queue: Array<{ workflowPath: string; kind: string; advice: CiOverviewAdvice }> = []
    const wanted = new Set<string>()
    for (const item of g.items) {
      const key = rolloutKey({ projectId: g.projectId, repo: repoName, workflowPath: item.workflowPath, kind: item.kind })
      if (wanted.has(key)) continue
      wanted.add(key)
      const same = activeJobs.filter((j) => rolloutKey({ projectId: j.project_id, repo: j.repo, workflowPath: j.workflow_path, kind: j.kind }) === key)
      const open = same.find((j) => j.status === 'pr_opened')
      const advice = adviceByKey.get(key)
      if (open) {
        result.skipped.push({ ...item, code: 'PR_ALREADY_OPEN', message: 'Mushi already opened this fix. Review and merge that pull request.', prUrl: open.pr_url })
      } else if (same.length > 0) {
        result.skipped.push({ ...item, code: 'COST_FIX_IN_PROGRESS', message: 'Mushi is already opening this fix.', prUrl: null })
      } else if (!advice) {
        result.skipped.push({ ...item, code: 'NOT_ADVISED', message: 'Mushi no longer advises this fix for this workflow (the advice may have changed). Refresh the preview.', prUrl: null })
      } else {
        queue.push({ ...item, advice })
      }
    }
    if (queue.length === 0) {
      result.status = 'skipped'
      continue
    }

    const rate = await deps.claimRateLimit(db as never, `project:${g.projectId}:ci_cost_fix`, COST_FIXES_PER_HOUR, 3600)
    if (!rate.allowed) {
      result.error = { code: 'RATE_LIMITED', message: `Mushi opens at most ${COST_FIXES_PER_HOUR} CI fix pull requests an hour per project. Try this repo again later.` }
      continue
    }
    const bundleId = deps.newId()
    const { data: inserted, error } = await db
      .from('ci_cost_fix_jobs')
      .insert(
        queue.map((q) => ({
          project_id: g.projectId,
          requested_by: byApiKey ? null : userId,
          repo: repoName,
          workflow_path: q.workflowPath,
          kind: q.kind,
          status: 'queued',
          evidence: q.advice.evidence.slice(0, 2000),
          month_saving_usd: q.advice.monthSavingUsd == null || q.advice.monthSavingUsd < 0 ? null : Math.round(q.advice.monthSavingUsd * 100) / 100,
          bundle_id: bundleId,
        })),
      )
      .select(COST_FIX_JOB_COLUMNS)
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        result.error = { code: 'COST_FIX_IN_PROGRESS', message: 'Mushi is already opening one of these fixes. Wait a moment and refresh the preview.' }
      } else if (missingObject(error.message)) {
        result.error = { code: 'MIGRATION_PENDING', message: 'Opening several CI fixes in one pull request is not set up on this server yet.' }
      } else {
        blog.error('bundle insert failed', { projectId: g.projectId, err: error.message })
        result.error = { code: 'DB_ERROR', message: 'Could not queue the fixes.' }
      }
      continue
    }
    deps.invokeBundleWorker(bundleId)
    void deps
      .logAudit(db as never, g.projectId, userId, 'settings.updated', 'ci_cost_fix_bundle', bundleId, {
        repo: repoName,
        items: queue.map((q) => ({ workflowPath: q.workflowPath, kind: q.kind })),
      }, { actorType: byApiKey ? 'api_key' : 'user' })
      .catch(() => null)
    result.status = 'queued'
    result.bundleId = bundleId
    result.jobs = ((inserted ?? []) as CostFixJobRow[]).map(toCostFixView)
  }

  const queued = results.filter((r) => r.status === 'queued').length
  return c.json({ ok: true, data: { results, queued } }, queued > 0 ? 202 : 200)
}

async function getBundle(c: Context, deps: CiCostFixBundleRouteDeps): Promise<Response> {
  const id = c.req.param('id') ?? ''
  if (!UUID_RE.test(id)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const db = deps.getServiceClient()
  const { data, error } = await db.from('ci_cost_fix_jobs').select(COST_FIX_JOB_COLUMNS).eq('bundle_id', id).order('created_at', { ascending: true }).limit(100)
  if (error && !missingObject(error.message)) return jsonError(c, 'DB_ERROR', 'Could not read the bundle.', 500)
  let rows = (error ? [] : (data ?? [])) as CostFixJobRow[]
  if (rows.length === 0) return jsonError(c, 'NOT_FOUND', 'Bundle not found', 404)
  const access = await deps.callerCanAccessProject(c, db, c.get('userId') as string, rows[0].project_id)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Bundle not found', 404)

  const now = deps.now().getTime()
  if (rows.some((r) => r.status === 'queued' && now - Date.parse(r.created_at) > REFIRE_AFTER_MS)) {
    deps.invokeBundleWorker(id)
  } else if (rows.some((r) => r.status === 'pr_opened')) {
    rows = await deps.refreshBundle(db, rows)
  }
  return c.json({ ok: true, data: { bundle: toCostFixBundleView(id, rows) } })
}
