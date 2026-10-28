/**
 * FILE: packages/server/supabase/functions/api/routes/work-status.ts
 * PURPOSE: Worker flags and the two console actions that answer them (ADR
 *          0048 amendment 2026-10-28), served by `api-ext` with the rest of
 *          work.ts:
 *
 *     GET  /v1/admin/work/stats              the sidebar badge: how many flags, how many
 *                                            danger, the worst one's title (mcp:read)
 *     POST /v1/admin/work/claims/:id/stop    "Stop this run": ends the claim; the machine's
 *                                            next heartbeat finds the lease gone and stops the
 *                                            agent (console session; the app's owner or admin,
 *                                            or the machine's owner; audited)
 *     POST /v1/admin/work/hosts/:id/recheck  "Re-check the account": the next heartbeat asks
 *                                            the machine to run `cursor-agent status` again
 *                                            (console session, the machine's owner)
 *
 *          The reads behind the flags (readFlagExtras, readWorkerFlags) are
 *          shared with GET /v1/admin/work/lanes and the per-app Home, so the
 *          badge, the Workers tab and Home count the same flags.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import type { getServiceClient } from '../../_shared/db.ts'
import type { logAudit } from '../../_shared/audit.ts'
import { ownerUserColumnReady, withOwnerUserColumn } from '../../_shared/byok-scope.ts'
import { laneConfigFromRow } from '../../_shared/work-lanes.ts'
import { deriveWorkerFlags, durationText, flagSummary, type FlagClaim, type FlagCreditExpiry, type FlagHost, type FlagLane, type FlagLocalRun, type WorkerFlag } from '../../_shared/work-flags.ts'

type Db = ReturnType<typeof getServiceClient>
type Ctx = Context<{ Variables: Variables }>
type Role = 'owner' | 'admin' | 'member' | 'viewer' | null

export interface WorkStatusDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  access: (c: Ctx, db: Db, userId: string, projectId: string) => Promise<{ allowed: boolean; role: Role }>
  projectIds: (c: Ctx, db: Db, userId: string) => Promise<string[]>
  logAudit: typeof logAudit
  now: () => Date
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IN_CHUNK = 100
/** `mushi work` runs (fix_attempts.agent) — the CLI's WORK_AGENT_KIND; only it sets status 'running'. */
const LOCAL_AGENT = 'mcp'
const LOCAL_RUN_LOOKBACK_MS = 2 * 86_400_000
const CREDIT_WINDOW_MS = 7 * 86_400_000

function err(c: Ctx, code: string, message: string, status: 400 | 403 | 404 | 409 | 500) {
  return c.json({ ok: false, error: { code, message } }, status)
}

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += IN_CHUNK) out.push(xs.slice(i, i + IN_CHUNK))
  return out
}

const isMissing = (e: unknown) => ['42P01', 'PGRST205', '42703', 'PGRST204'].includes((e as { code?: string } | null)?.code ?? '')

/**
 * `mushi work` runs of these apps still marked running from the last 2 days.
 * A failed read is an empty list: this flag adds to the page, it never breaks it.
 */
async function readLocalRuns(db: Db, projectIds: readonly string[], now: Date): Promise<FlagLocalRun[]> {
  const since = new Date(now.getTime() - LOCAL_RUN_LOOKBACK_MS).toISOString()
  const out: FlagLocalRun[] = []
  for (const part of chunks(projectIds)) {
    const { data, error } = await db
      .from('fix_attempts')
      .select('id, report_id, project_id, created_at')
      .in('project_id', part)
      .eq('agent', LOCAL_AGENT)
      .eq('status', 'running')
      .gte('created_at', since)
      .limit(100)
    if (error) return out
    for (const r of (data ?? []) as Array<{ id: string; report_id: string; project_id: string; created_at: string }>) {
      out.push({ fixId: r.id, reportId: r.report_id, projectId: r.project_id, createdAt: r.created_at })
    }
  }
  return out
}

/**
 * When the credits the lanes could spend run out: Cursor keys the caller sees
 * (their apps', their apps' organizations', or their own universal keys) whose
 * credits expire within 7 days, and lane stop dates in that window (a lane's
 * stop date is how a local account's expiry is set, ADR 0048).
 */
async function readCreditExpiries(db: Db, userId: string, projectIds: readonly string[], lanes: readonly FlagLane[], now: Date): Promise<FlagCreditExpiry[]> {
  const out: FlagCreditExpiry[] = []
  const until = new Date(now.getTime() + CREDIT_WINDOW_MS)
  for (const l of lanes) {
    if (l.config.stop_at && Date.parse(l.config.stop_at) > now.getTime() && Date.parse(l.config.stop_at) <= until.getTime()) {
      out.push({ label: `Lane ${l.name}'s stop date`, expiresAt: l.config.stop_at })
    }
  }
  if (projectIds.length === 0) return out
  try {
    const { data: projects } = await db.from('projects').select('id, organization_id').in('id', [...projectIds].slice(0, 500))
    const orgs = new Set(((projects ?? []) as Array<{ organization_id: string | null }>).map((p) => p.organization_id).filter((x): x is string => !!x))
    const apps = new Set(projectIds)
    const ready = await ownerUserColumnReady(db)
    const { data, error } = await db
      .from('byok_keys')
      .select(withOwnerUserColumn('id, label, project_id, organization_id, credits_expire_at', ready))
      .eq('provider_slug', 'cursor')
      .gt('credits_expire_at', now.toISOString())
      .lte('credits_expire_at', until.toISOString())
      .limit(100)
    if (error) return out
    for (const k of (data ?? []) as unknown as Array<{ label: string | null; project_id: string | null; organization_id: string | null; owner_user_id?: string | null; credits_expire_at: string }>) {
      const visible = (k.project_id && apps.has(k.project_id)) || (k.organization_id && orgs.has(k.organization_id)) || (k.owner_user_id && k.owner_user_id === userId)
      if (visible) out.push({ label: `Cursor key "${(k.label ?? 'unnamed').slice(0, 60)}"`, expiresAt: k.credits_expire_at })
    }
  } catch {
    // A failed read leaves out the keys; the lanes' stop dates still count.
  }
  return out
}

/** What GET /v1/admin/work/lanes already read, plus the two extra reads, as flags. */
export async function flagsFor(db: Db, userId: string, projectIds: readonly string[], rows: { hosts: FlagHost[]; lanes: FlagLane[]; claims: FlagClaim[] }, now: Date): Promise<WorkerFlag[]> {
  const [localRuns, credits] = await Promise.all([readLocalRuns(db, projectIds, now), readCreditExpiries(db, userId, projectIds, rows.lanes, now)])
  return deriveWorkerFlags({ ...rows, localRuns, credits, now })
}

interface HostRowLite {
  id: string
  owner_user_id: string
  hostname: string
  platform: string
  last_heartbeat_at: string
  status: Record<string, unknown> | null
  revoked_at: string | null
}

/** The rows a claim becomes in a flag (GET /v1/admin/work/lanes maps its own the same way). */
export function flagClaim(x: { id: string; lane_id: string; report_id: string | null; kind: string; status: string; claimed_at: string; lease_until: string; finished_at: string | null; outcome: string | null; failure_kind: string | null; detail: string | null; pr_url: string | null }): FlagClaim {
  return { id: x.id, laneId: x.lane_id, reportId: x.report_id, kind: x.kind, status: x.status, claimedAt: x.claimed_at, leaseUntil: x.lease_until, finishedAt: x.finished_at, outcome: x.outcome, failureKind: x.failure_kind, detail: x.detail, prUrl: x.pr_url }
}

/**
 * Every flag for these apps and the caller's own machines (the Home card and
 * the sidebar badge). Reads less than the Workers tab: no queues, no titles.
 * Missing tables (the migration not applied) read as no workers.
 */
export async function readWorkerFlags(db: Db, userId: string, projectIds: readonly string[], now: Date): Promise<{ flags: WorkerFlag[]; lanes: FlagLane[] }> {
  if (projectIds.length === 0) return { flags: [], lanes: [] }
  const laneRows: Array<Record<string, unknown>> = []
  for (const part of chunks(projectIds)) {
    const { data, error } = await db.from('work_lanes').select('id, host_id, project_id, name, model, mode, concurrency, paused, stop_at, drain, prune_own, status').in('project_id', part)
    if (error) {
      if (isMissing(error)) return { flags: [], lanes: [] }
      throw new Error('Could not read the lanes.')
    }
    laneRows.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const hostIds = [...new Set(laneRows.map((l) => l.host_id as string))]
  const [byId, mine] = await Promise.all([
    hostIds.length ? db.from('work_hosts').select('id, owner_user_id, hostname, platform, last_heartbeat_at, status, revoked_at').in('id', hostIds) : Promise.resolve({ data: [], error: null }),
    db.from('work_hosts').select('id, owner_user_id, hostname, platform, last_heartbeat_at, status, revoked_at').eq('owner_user_id', userId),
  ])
  if (byId.error || mine.error) throw new Error('Could not read the workers.')
  const hosts = new Map<string, HostRowLite>()
  for (const h of [...((byId.data ?? []) as HostRowLite[]), ...((mine.data ?? []) as HostRowLite[])]) hosts.set(h.id, h)
  const laneIds = laneRows.map((l) => l.id as string)
  const queued = new Map<string, number>()
  const claims: FlagClaim[] = []
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  for (const part of chunks(laneIds)) {
    const [q, cl] = await Promise.all([
      db.from('work_queue').select('lane_id').in('lane_id', part),
      db.from('work_claims').select('id, lane_id, report_id, kind, status, claimed_at, lease_until, finished_at, outcome, failure_kind, detail, pr_url').in('lane_id', part).gte('claimed_at', since).order('claimed_at', { ascending: false }).limit(500),
    ])
    if (q.error || cl.error) throw new Error('Could not read the runs.')
    for (const r of (q.data ?? []) as Array<{ lane_id: string }>) queued.set(r.lane_id, (queued.get(r.lane_id) ?? 0) + 1)
    claims.push(...((cl.data ?? []) as Array<Parameters<typeof flagClaim>[0]>).map(flagClaim))
  }
  const lanes: FlagLane[] = laneRows.map((l) => ({
    id: l.id as string,
    hostId: l.host_id as string,
    projectId: l.project_id as string,
    name: l.name as string,
    config: laneConfigFromRow(l as never),
    status: (l.status as Record<string, unknown> | null) ?? {},
    queued: queued.get(l.id as string) ?? 0,
  }))
  const flagHosts: FlagHost[] = [...hosts.values()].map((h) => ({ id: h.id, hostname: h.hostname, platform: h.platform, lastHeartbeatAt: h.last_heartbeat_at, revoked: !!h.revoked_at, status: h.status ?? {} }))
  const flags = await flagsFor(db, userId, projectIds, { hosts: flagHosts, lanes, claims }, now)
  return { flags, lanes }
}

async function stats(c: Ctx, deps: WorkStatusDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const userId = c.get('userId') as string
  const projectIds = await deps.projectIds(c, db, userId)
  try {
    const { flags } = await readWorkerFlags(db, userId, projectIds, deps.now())
    return c.json({ ok: true, data: flagSummary(flags) })
  } catch (e) {
    return err(c, 'DB_ERROR', e instanceof Error ? e.message : 'Could not read the workers.', 500)
  }
}

/**
 * "Stop this run": the claim ends now as `stopped`. The machine finds the
 * lease gone at its next heartbeat (within a minute) and stops the agent, and
 * a run past the agent stops before its next step; a git hook already running
 * ends at git's own time limit. Works with every daemon version: an ended
 * claim is what "lost" has always meant.
 */
async function stopRun(c: Ctx, deps: WorkStatusDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const now = deps.now()
  const userId = c.get('userId') as string
  const id = c.req.param('id') ?? ''
  if (!UUID_RE.test(id)) return err(c, 'VALIDATION_ERROR', 'claim id must be a uuid.', 400)
  const { data: claim, error } = await db.from('work_claims').select('id, lane_id, host_id, project_id, report_id, kind, status, claimed_at, lease_until').eq('id', id).maybeSingle()
  if (error) return err(c, 'DB_ERROR', 'Could not read the run.', 500)
  if (!claim) return err(c, 'NOT_FOUND', 'Run not found.', 404)
  const k = claim as { id: string; lane_id: string; host_id: string; project_id: string; report_id: string | null; kind: string; status: string; claimed_at: string; lease_until: string }
  const access = await deps.access(c, db, userId, k.project_id)
  if (!access.allowed) return err(c, 'NOT_FOUND', 'Run not found.', 404)
  const { data: host } = await db.from('work_hosts').select('owner_user_id, hostname').eq('id', k.host_id).maybeSingle()
  const hostRow = host as { owner_user_id: string; hostname: string } | null
  if (access.role !== 'owner' && access.role !== 'admin' && hostRow?.owner_user_id !== userId) {
    return err(c, 'FORBIDDEN', "Only the app's owner or an admin, or the machine's owner, stops a run.", 403)
  }
  if (k.status !== 'active' || Date.parse(k.lease_until) <= now.getTime()) return err(c, 'CLAIM_ENDED', 'This run already ended.', 409)
  const { data: lane } = await db.from('work_lanes').select('name, status').eq('id', k.lane_id).maybeSingle()
  const laneRow = lane as { name: string; status: Record<string, unknown> | null } | null
  const run = (Array.isArray(laneRow?.status?.inflight) ? (laneRow!.status!.inflight as Array<{ runId: string; stage: string }>) : []).find((r) => r.runId === k.id)
  const held = durationText(Math.round((now.getTime() - Date.parse(k.claimed_at)) / 1000))
  const detail = `Stopped from the console after ${held}${run ? ` (stage: ${run.stage})` : ''}.`
  const { data: ended } = await db
    .from('work_claims')
    .update({ status: 'done', outcome: 'stopped', failure_kind: null, detail, finished_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', k.id)
    .eq('status', 'active')
    .select('id')
  if (!ended || (ended as unknown[]).length === 0) return err(c, 'CLAIM_ENDED', 'This run already ended.', 409)
  await deps
    .logAudit(db, k.project_id, userId, 'fix_dispatch.cancelled', 'work_claim', k.id, { source: 'worker_stop', lane: laneRow?.name ?? null, host: hostRow?.hostname ?? null, report_id: k.report_id, kind: k.kind, held, stage: run?.stage ?? null })
    .catch(() => {})
  return c.json({ ok: true, data: { id: k.id, stopped: true, message: 'Stopped. The machine stops the agent at its next heartbeat, within a minute; a git hook already running ends at its time limit.' } })
}

/** "Re-check the account": stored on the host; the next heartbeat answer asks for a new `cursor-agent status`. */
async function recheck(c: Ctx, deps: WorkStatusDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const now = deps.now()
  const userId = c.get('userId') as string
  const id = c.req.param('id') ?? ''
  if (!UUID_RE.test(id)) return err(c, 'VALIDATION_ERROR', 'host id must be a uuid.', 400)
  const { data, error } = await db.from('work_hosts').select('id, owner_user_id, hostname, revoked_at').eq('id', id).maybeSingle()
  if (error) return err(c, 'DB_ERROR', 'Could not read the worker.', 500)
  const host = data as { id: string; owner_user_id: string; hostname: string; revoked_at: string | null } | null
  if (!host || host.owner_user_id !== userId) return err(c, 'NOT_FOUND', 'Worker not found (only its owner asks it to re-check).', 404)
  if (host.revoked_at) return err(c, 'CLAIM_ENDED', 'This worker was revoked.', 409)
  const { error: upErr } = await db.from('work_hosts').update({ recheck_requested_at: now.toISOString() }).eq('id', host.id)
  if (upErr) {
    if (isMissing(upErr)) return err(c, 'MIGRATION_PENDING', 'This server cannot store the request yet (migration 20261028120000_worker_recheck is not applied). Run `cursor-agent status` on the machine instead.', 409)
    return err(c, 'DB_ERROR', 'The request could not be stored.', 500)
  }
  return c.json({ ok: true, data: { id: host.id, message: `Asked. ${host.hostname} runs cursor-agent status within a minute or two and reports the result here.` } })
}

export function registerWorkStatusRoutes(app: Hono<{ Variables: Variables }>, deps: WorkStatusDeps): void {
  app.get('/v1/admin/work/stats', deps.adminOrApiKeyRead, (c) => stats(c as Ctx, deps))
  app.post('/v1/admin/work/claims/:id/stop', deps.jwtAuth, (c) => stopRun(c as Ctx, deps))
  app.post('/v1/admin/work/hosts/:id/recheck', deps.jwtAuth, (c) => recheck(c as Ctx, deps))
}
