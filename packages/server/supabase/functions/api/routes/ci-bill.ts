/**
 * ci-bill.ts — the real GitHub Actions bill (2026-10-27, follow-up to Plan 022).
 *
 *   GET  /v1/admin/ci/bill    adminOrApiKey(mcp:read)
 *        ?project_id=&days=30 (1-90) — what GitHub charged for Actions, from
 *        ci_billing_daily: net, gross and discount totals, per repo, per SKU
 *        and per day, this calendar month, the previous period (only when
 *        Mushi holds all of it), each owner's sync status and the reason a
 *        bill is missing, and the agent PR share (estimated from ci_jobs).
 *        Scope as the overview: the project, or every project the caller
 *        can read; the bill shown is every GitHub owner those projects'
 *        repos belong to, within their organizations. Bill rows are
 *        organization data: a caller who is not a member of the
 *        organization sees only the rows of its projects' repos
 *        (`repoScoped`).
 *   POST /v1/admin/ci/bill    adminOrApiKey(mcp:write), non-viewers, 30/h
 *        `mushi runner bill --push`: one month of usage items the user read
 *        with their own gh login. The owner must own a repo the project is
 *        bound to. Stored with source 'cli'.
 *
 * Runs in api-ext (`/v1/admin/ci/*` is forwarded from api).
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { isMissingObject } from '../../_shared/ci-compare-load.ts'
import { readAllPages } from '../../_shared/paged-read.ts'
import {
  BILL_MAX_DAYS,
  billingRowsFromUsage,
  buildCiBill,
  DAY_MS,
  isGithubLogin,
  MAX_USAGE_ITEMS,
  nextCoveredFrom,
  type BillSyncRow,
  type StoredBillRow,
} from '../../_shared/ci-billing.ts'
import { agentMinutes, loadCostFacts } from '../../_shared/ci-cost-facts.ts'
import type { RepoPermissions } from '../../_shared/ci-collector.ts'
import { callerCanAccessProject, callerProjectIds, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const blog = log.child('ci-bill')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const CI_BILL_PUSHES_PER_HOUR = 30
/** Bill rows read for one response. 90 + 90 days × a few dozen repo-SKU pairs fits well inside. */
const MAX_BILL_ROWS = 50_000
const UPSERT_CHUNK = 500
const MIGRATION_PENDING = 'The bill can be stored once the database update 20261027091500_ci_billing_real_bill is applied.'

type Db = ReturnType<typeof getServiceClient>

export interface CiBillRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  claimRateLimit: typeof claimTenantRateLimit
  callerProjectIds: typeof callerProjectIds
  callerCanAccessProject: typeof callerCanAccessProject
  now: () => Date
}

export const defaultCiBillDeps: CiBillRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  claimRateLimit: claimTenantRateLimit,
  callerProjectIds,
  callerCanAccessProject,
  now: () => new Date(),
}

export function registerCiBillRoutes(app: Hono<{ Variables: Variables }>, deps: CiBillRouteDeps = defaultCiBillDeps): void {
  app.get('/v1/admin/ci/bill', deps.adminOrApiKeyRead, (c) => getBill(c, deps))
  app.post('/v1/admin/ci/bill', deps.adminOrApiKeyWrite, (c) => pushBill(c, deps))
}

function ownerOfRepoUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m && isGithubLogin(m[1]) ? m[1] : null
}

interface ScopeOwners {
  /** organization → lowercased owner → the owner as first spelled in a bound repo URL */
  owners: Map<string, Map<string, string>>
  /** organization → the lowercased owner/repo names bound to the scoped projects */
  repos: Map<string, Set<string>>
}

/** The organizations of the projects, the GitHub owners of their bound repos, and those repos. */
async function scopeOwners(db: Db, projectIds: string[]): Promise<ScopeOwners> {
  const out: ScopeOwners = { owners: new Map(), repos: new Map() }
  if (projectIds.length === 0) return out
  const [projects, repos] = await Promise.all([
    db.from('projects').select('id, organization_id').in('id', projectIds),
    db.from('project_repos').select('project_id, repo_url').in('project_id', projectIds),
  ])
  if (projects.error) throw new Error(`projects read failed: ${projects.error.message}`)
  if (repos.error) throw new Error(`project_repos read failed: ${repos.error.message}`)
  const orgOf = new Map(((projects.data ?? []) as Array<{ id: string; organization_id: string | null }>).map((p) => [p.id, p.organization_id]))
  for (const r of (repos.data ?? []) as Array<{ project_id: string; repo_url: string | null }>) {
    const org = orgOf.get(r.project_id)
    const owner = ownerOfRepoUrl(r.repo_url)
    if (!org || !owner) continue
    const owners = out.owners.get(org) ?? new Map<string, string>()
    if (!owners.has(owner.toLowerCase())) owners.set(owner.toLowerCase(), owner)
    out.owners.set(org, owners)
    const repo = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([^/\s]+\/[^/\s#?]+?)(?:\.git)?\/?$/i.exec(String(r.repo_url).trim())?.[1]
    if (repo) out.repos.set(org, (out.repos.get(org) ?? new Set<string>()).add(repo.toLowerCase()))
  }
  return out
}

/**
 * The organizations the caller is a member of. Bill rows are organization
 * data (RLS: is_org_member); a caller who only belongs to some projects sees
 * the rows of those projects' repos, never the rest of the owner's bill.
 */
async function memberOrgs(db: Db, userId: string, orgIds: string[]): Promise<Set<string>> {
  if (orgIds.length === 0 || !userId) return new Set()
  const { data, error } = await db.from('organization_members').select('organization_id').eq('user_id', userId).in('organization_id', orgIds)
  if (error) throw new Error(`organization_members read failed: ${error.message}`)
  return new Set(((data ?? []) as Array<{ organization_id: string }>).map((m) => m.organization_id))
}

async function getBill(c: Context, deps: CiBillRouteDeps): Promise<Response> {
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const requested = c.req.query('project_id') ?? c.req.query('projectId') ?? null
  if (requested && !UUID_RE.test(requested)) return jsonError(c, 'VALIDATION_ERROR', 'project_id must be a uuid', 400)
  const daysRaw = Number(c.req.query('days') ?? 30)
  const days = Number.isFinite(daysRaw) ? Math.min(BILL_MAX_DAYS, Math.max(1, Math.round(daysRaw))) : 30
  const projectIds = await deps.callerProjectIds(c, db, userId)
  if (requested && !projectIds.includes(requested)) return jsonError(c, 'FORBIDDEN', 'You cannot read this project.', 403)
  const scope = requested ? [requested] : projectIds
  const now = deps.now()

  try {
    const scoped = await scopeOwners(db, scope)
    const orgIds = [...scoped.owners.keys()]
    const members = await memberOrgs(db, userId, orgIds)
    const wanted = (org: string, owner: string) => scoped.owners.get(org)?.has(owner.toLowerCase()) ?? false
    const visible = (org: string, repo: string) => members.has(org) || (scoped.repos.get(org)?.has(repo.toLowerCase()) ?? false)
    let sync: BillSyncRow[] = []
    let rows: StoredBillRow[] = []
    let pending = false
    if (orgIds.length > 0) {
      const syncRes = await db
        .from('ci_billing_sync')
        .select('organization_id, owner, owner_type, last_ok_at, last_attempt_at, last_error, last_source, covered_from')
        .in('organization_id', orgIds)
      if (syncRes.error) {
        if (!isMissingObject(syncRes.error)) throw new Error(`ci_billing_sync read failed: ${syncRes.error.message}`)
        pending = true
      } else {
        sync = ((syncRes.data ?? []) as Array<BillSyncRow & { organization_id: string }>).filter((s) => wanted(s.organization_id, s.owner))
      }
      if (!pending) {
        const since = new Date(now.getTime() - (2 * days + 1) * DAY_MS).toISOString().slice(0, 10)
        const read = await readAllPages<StoredBillRow & { organization_id: string }>(
          (lo, hi, count) =>
            db
              .from('ci_billing_daily')
              .select('id, organization_id, owner, day, repo, sku, unit, quantity, gross_usd, discount_usd, net_usd, source', { count })
              .in('organization_id', orgIds)
              .gte('day', since)
              .order('day', { ascending: true })
              .order('id', { ascending: true })
              .range(lo, hi),
          { what: 'ci_billing_daily', maxRows: MAX_BILL_ROWS },
        )
        rows = read.rows.filter((r) => wanted(r.organization_id, r.owner) && visible(r.organization_id, r.repo))
      }
    }

    // The agent PR share comes from the jobs Mushi recorded (kept 30 days).
    const factDays = Math.min(days, 30)
    const facts = await loadCostFacts(db as never, scope, new Date(now.getTime() - factDays * DAY_MS), now)
    let agent: { billedMinutes: number; agentBilledMinutes: number } | null = null
    if (facts.facts && scope.length > 0) {
      const state = await db.from('ci_collector_state').select('permissions').in('project_id', scope)
      const vis = new Map<string, 'public' | 'private' | 'unknown'>()
      for (const s of (state.error ? [] : (state.data ?? [])) as Array<{ permissions: Record<string, RepoPermissions> | null }>) {
        for (const [repo, p] of Object.entries(s.permissions ?? {})) if (p?.visibility) vis.set(repo.toLowerCase(), p.visibility)
      }
      agent = agentMinutes(facts.facts, (repo) => vis.get(repo.toLowerCase()) ?? 'unknown')
    }

    const bill = buildCiBill({ now, days, rows, sync, agent })
    bill.repoScoped = orgIds.some((o) => !members.has(o))
    if (pending && !bill.available) bill.unavailableReason = MIGRATION_PENDING
    return c.json({ ok: true, data: bill })
  } catch (err) {
    blog.error('ci bill read failed', { err: err instanceof Error ? err.message : String(err) })
    return jsonError(c, 'CI_BILL_FAILED', 'The CI bill could not be read. Try again in a minute.', 500)
  }
}

const usageItemSchema = z.object({
  date: z.string().max(40),
  product: z.string().max(60),
  sku: z.string().max(100),
  quantity: z.number().finite(),
  unitType: z.string().max(40).optional(),
  pricePerUnit: z.number().finite().optional(),
  grossAmount: z.number().finite(),
  discountAmount: z.number().finite(),
  netAmount: z.number().finite(),
  repositoryName: z.string().max(200).nullable().optional(),
})

export const billPushSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    owner: z.string().refine(isGithubLogin, 'a GitHub user or organization login'),
    ownerType: z.enum(['User', 'Organization']).optional(),
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
    items: z.array(usageItemSchema).max(MAX_USAGE_ITEMS),
  })
  .strict()

async function pushBill(c: Context, deps: CiBillRouteDeps): Promise<Response> {
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const parsed = billPushSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
  }
  const body = parsed.data
  const keyProject = (c.get('projectId') as string | null | undefined) ?? null
  if (keyProject && body.projectId && keyProject !== body.projectId) return jsonError(c, 'FORBIDDEN', 'This key belongs to another project.', 403)
  const projectId = keyProject ?? body.projectId ?? null
  if (!projectId) return jsonError(c, 'PROJECT_REQUIRED', 'Pass projectId (or use a key bound to a project).', 400)

  const access = await deps.callerCanAccessProject(c, db, userId, projectId)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
  const viewer = denyViewerWrite(c, access.role, 'upload the CI bill')
  if (viewer) return viewer

  const monthKey = `${body.year}-${String(body.month).padStart(2, '0')}`
  const outside = body.items.find((i) => i.date.slice(0, 7) !== monthKey)
  if (outside) return jsonError(c, 'VALIDATION_ERROR', `Every item must fall in ${monthKey}; one is dated ${outside.date.slice(0, 10)}.`, 400)

  const rate = await deps.claimRateLimit(db, `project:${projectId}:ci_bill_push`, CI_BILL_PUSHES_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `At most ${CI_BILL_PUSHES_PER_HOUR} bill uploads an hour per project.`, 429)
  }

  let orgId: string
  let owner: string
  try {
    const entry = [...(await scopeOwners(db, [projectId])).owners.entries()][0]
    if (!entry) return jsonError(c, 'NO_REPO', 'Bind a GitHub repository to this project first (Projects → Repository).', 409)
    const bound = entry[1].get(body.owner.toLowerCase())
    if (!bound) {
      return jsonError(c, 'OWNER_NOT_BOUND', `${body.owner} owns none of this project's repositories (${[...entry[1].values()].join(', ')}). Push the bill of a repo owner the project uses.`, 400)
    }
    orgId = entry[0]
    // Stored lowercase, as the collector does: one owner, one bill.
    owner = bound.toLowerCase()
  } catch (err) {
    blog.error('ci bill push scope failed', { projectId, err: err instanceof Error ? err.message : String(err) })
    return jsonError(c, 'DB_ERROR', 'Could not read the project.', 500)
  }

  const now = deps.now()
  const { rows, skipped, invalid } = billingRowsFromUsage(owner, body.items)
  const fetchedAt = now.toISOString()
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => ({ ...r, organization_id: orgId, source: 'cli', fetched_at: fetchedAt }))
    const { error } = await db.from('ci_billing_daily').upsert(chunk, { onConflict: 'organization_id,owner,day,repo,sku' })
    if (error) {
      if (isMissingObject(error)) return jsonError(c, 'MIGRATION_PENDING', MIGRATION_PENDING, 409)
      blog.error('ci bill push upsert failed', { projectId, err: error.message })
      return jsonError(c, 'DB_ERROR', 'The bill could not be stored.', 500)
    }
  }

  const { data: prior, error: priorErr } = await db
    .from('ci_billing_sync')
    .select('covered_from, last_ok_at, owner_type')
    .eq('organization_id', orgId)
    .eq('owner', owner)
    .maybeSingle()
  if (priorErr) {
    if (isMissingObject(priorErr)) return jsonError(c, 'MIGRATION_PENDING', MIGRATION_PENDING, 409)
    return jsonError(c, 'DB_ERROR', 'Could not read the bill status.', 500)
  }
  const p = prior as { covered_from: string | null; last_ok_at: string | null; owner_type: string | null } | null
  const coveredFrom = nextCoveredFrom(p?.covered_from ?? null, [{ year: body.year, month: body.month, ok: true }], now, p?.last_ok_at ?? null)
  const { error: syncErr } = await db.from('ci_billing_sync').upsert(
    {
      organization_id: orgId,
      owner,
      owner_type: body.ownerType ?? p?.owner_type ?? null,
      last_attempt_at: fetchedAt,
      last_ok_at: fetchedAt,
      last_error: null,
      last_source: 'cli',
      covered_from: coveredFrom,
      updated_at: fetchedAt,
    },
    { onConflict: 'organization_id,owner' },
  )
  if (syncErr) {
    blog.error('ci bill push sync upsert failed', { projectId, err: syncErr.message })
    return jsonError(c, 'DB_ERROR', 'The bill was stored but its status could not be saved.', 500)
  }
  const net = Math.round(rows.reduce((n, r) => n + r.net_usd, 0) * 100) / 100
  return c.json({ ok: true, data: { owner, month: monthKey, rows: rows.length, skipped, invalid, netUsd: net, coveredFrom } })
}
