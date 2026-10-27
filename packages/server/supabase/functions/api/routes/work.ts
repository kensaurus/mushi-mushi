/**
 * FILE: packages/server/supabase/functions/api/routes/work.ts
 * PURPOSE: Local workers (ADR 0048, console ops plan P2), served by `api-ext`
 *          (deploy size limit; `api` forwards these paths).
 *
 *   The daemon (`mushi work --daemon`), with a worker:run key only:
 *     POST /v1/worker/heartbeat            register the host and its lanes, renew leases;
 *                                          answers each lane's closed settings and the host guards
 *     POST /v1/worker/claim                { laneId } by the lane's mode (P3): fix and skill take a
 *                                          report (the queue first, then ranked ones for fix);
 *                                          conflicts a merge-queue conflict (ADR 0049); audit
 *                                          one audit pass (ADR 0050)
 *     POST /v1/worker/claims/:id/renew     extend the lease
 *     POST /v1/worker/claims/:id/done      { outcome, failureKind?, fixId?, prUrl?, detail?, headAfter? }
 *     POST /v1/worker/claims/:id/findings  an audit claim files one reproduced finding (code_audit)
 *     POST /v1/worker/revoke               the key revokes itself (`mushi worker revoke`)
 *
 *   The console and the CLI:
 *     GET    /v1/admin/work/lanes          ?projectId= hosts, lanes, queues, recent runs (mcp:read)
 *     PATCH  /v1/admin/work/lanes/:id      lane settings (console session, non-viewers)
 *     PUT    /v1/admin/work/lanes/:id/queue { reportIds, append? } (console session, non-viewers)
 *     PATCH  /v1/admin/work/hosts/:id      host guards (console session, the host's owner)
 *     DELETE /v1/admin/work/hosts/:id      revoke a host and its key (console session, the owner)
 *     POST   /v1/admin/work/key            { projectIds, label? } mint a worker:run key (mcp:write)
 *
 * Control is pull-only: the server never reaches the machine, and its answer
 * holds values from a closed set (_shared/work-lanes.ts), never a command or
 * a path. The lease (_shared/work-claims.ts) is what every other dispatcher
 * reads, so a report a lane holds gets no cloud agent at the same time.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { hashApiKey } from '../../_shared/api-key-mint.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { composeFixPacket, fixPacketContextFromReport } from '../../_shared/fix-packet.ts'
import { activeWorkClaims, enqueueReports, queuedForLocalLanes, WORK_LEASE_MS, type QueueLane } from '../../_shared/work-claims.ts'
import { AUDIT_FINDINGS_PER_HOUR, outcomeKindRefusal, parseAuditFinding } from '../../_shared/work-modes.ts'
import { auditFiledLastHour, fileAuditFinding } from './work-audit.ts'
import { claimConflict, endConflictClaim, type ModeLane } from '../../_shared/work-conflicts.ts'
import {
  claimFirstFree,
  hasLiveAttempt,
  hostGuardsFrom,
  hostOnline,
  inLocalCooldown,
  laneClaimBlock,
  laneConfigFromRow,
  mayAutoRequeue,
  parseClaimDone,
  parseHeartbeat,
  parseHostGuards,
  parseLaneSettings,
  rankWorkCandidates,
  type AttemptLite,
  type LaneConfig,
} from '../../_shared/work-lanes.ts'
import { callerCanAccessProject, callerProjectIds } from '../shared.ts'

const wlog = log.child('work-routes')

type Db = ReturnType<typeof getServiceClient>
type Ctx = Context<{ Variables: Variables }>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IN_CHUNK = 100
/** Reports a claim considers per pass: the lane's queue head, then this many ranked candidates per status. */
const QUEUE_HEAD = 20
const CANDIDATES_PER_STATUS = 50
/** Reports in a queue at once, per lane. */
export const QUEUE_MAX = 50
const CLOSED_STATUSES = new Set(['fixed', 'verified', 'dismissed'])
export const WORKER_KEY_SCOPES = ['worker:run'] as const
export const WORKER_KEY_MINTS_PER_HOUR = 10
const HEARTBEATS_PER_MINUTE = 10
const CLAIMS_PER_MINUTE = 30
const RECENT_DAYS = 7

type Role = 'owner' | 'admin' | 'member' | 'viewer' | null

/** A new lane's settings until the console changes them (the machine may propose some on first registration). */
const NEW_LANE_DEFAULTS: LaneConfig = { paused: false, concurrency: 1, model: null, mode: 'fix', stop_at: null, drain: false, prune_own: false }

export interface WorkRouteDeps {
  getServiceClient: () => Db
  /** A worker:run key (JWTs fall through and are refused in workerOnly). */
  workerAuth: MiddlewareHandler
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  access: (c: Ctx, db: Db, userId: string, projectId: string) => Promise<{ allowed: boolean; role: Role }>
  projectIds: (c: Ctx, db: Db, userId: string) => Promise<string[]>
  claimRateLimit: (db: Db, key: string, limit: number, windowSec: number) => Promise<{ allowed: boolean; retryAfterSec?: number }>
  logAudit: typeof logAudit
  /** Files a reproduced audit finding (work-modes.ts); injectable for tests. */
  fileFinding: typeof fileAuditFinding
  now: () => Date
}

export const defaultWorkRouteDeps: WorkRouteDeps = {
  getServiceClient,
  workerAuth: adminOrApiKey({ scope: 'worker:run' }) as MiddlewareHandler,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  access: (c, db, userId, projectId) => callerCanAccessProject(c, db, userId, projectId),
  projectIds: (c, db, userId) => callerProjectIds(c, db, userId),
  claimRateLimit: (db, key, limit, windowSec) => claimTenantRateLimit(db, key, limit, windowSec),
  logAudit,
  fileFinding: fileAuditFinding,
  now: () => new Date(),
}

function err(c: Ctx, code: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503) {
  return c.json({ ok: false, error: { code, message } }, status)
}

/** A helper's refusal: the answer to send instead of the row it looked for. */
class Refusal {
  constructor(readonly response: Response) {}
}

/** /v1/worker/* take only a worker:run API key: a console session or an mcp key never drives a lane. */
function workerOnly(c: Ctx): Response | null {
  const scopes = (c.get('apiKeyScopes') as string[] | undefined) ?? []
  if (c.get('authMethod') !== 'apiKey' || !scopes.includes('worker:run')) {
    return err(c, 'WORKER_KEY_REQUIRED', 'Only a local worker key (scope worker:run) reaches this route. Create one with `mushi worker install`.', 403)
  }
  return null
}

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += IN_CHUNK) out.push(xs.slice(i, i + IN_CHUNK))
  return out
}

interface HostRow {
  id: string
  owner_user_id: string
  api_key_id: string
  host_id: string
  hostname: string
  platform: string
  mushi_version: string | null
  last_heartbeat_at: string
  status: Record<string, unknown> | null
  guards: Record<string, unknown> | null
  revoked_at: string | null
}

interface LaneRow {
  id: string
  host_id: string
  project_id: string
  name: string
  model: string | null
  mode: string
  concurrency: number
  paused: boolean
  stop_at: string | null
  drain: boolean
  prune_own: boolean
  review_model: string | null
  repo: string | null
  status: Record<string, unknown> | null
  last_seen_at: string
}

interface ClaimRow {
  id: string
  lane_id: string
  host_id: string
  project_id: string
  /** Null for conflict and audit claims (P3). */
  report_id: string | null
  kind: 'fix' | 'conflict' | 'audit'
  merge_queue_id: string | null
  head_after: string | null
  status: string
  from_queue: boolean
  claimed_at: string
  lease_until: string
  finished_at: string | null
  outcome: string | null
  failure_kind: string | null
  auto_requeued: boolean
  fix_attempt_id: string | null
  pr_url: string | null
  detail: string | null
}

const HOST_COLUMNS = 'id, owner_user_id, api_key_id, host_id, hostname, platform, mushi_version, last_heartbeat_at, status, guards, revoked_at'
const LANE_COLUMNS = 'id, host_id, project_id, name, model, mode, concurrency, paused, stop_at, drain, prune_own, review_model, repo, status, last_seen_at'
const CLAIM_COLUMNS = 'id, lane_id, host_id, project_id, report_id, kind, merge_queue_id, head_after, status, from_queue, claimed_at, lease_until, finished_at, outcome, failure_kind, auto_requeued, fix_attempt_id, pr_url, detail'
const REPORT_DETAIL_COLUMNS =
  'id, project_id, summary, description, category, severity, status, component, confidence, stage2_analysis, reproduction_steps, screenshot_url, bug_ontology_tags, created_at'
const ATTEMPT_COLUMNS = 'id, report_id, status, agent, pr_url, pr_state, merged_at, error, created_at'

/** The worker's own lane: the lane's host sends this key and is not revoked. */
async function ownLane(db: Db, c: Ctx, laneId: string): Promise<{ lane: LaneRow; host: HostRow } | Refusal> {
  if (!UUID_RE.test(laneId)) return new Refusal(err(c, 'VALIDATION_ERROR', 'laneId must be a lane id.', 400))
  const { data: lane, error } = await db.from('work_lanes').select(LANE_COLUMNS).eq('id', laneId).maybeSingle()
  if (error) return new Refusal(err(c, 'DB_ERROR', 'Could not read the lane.', 500))
  if (!lane) return new Refusal(err(c, 'NOT_FOUND', 'No such lane. Send a heartbeat to register it first.', 404))
  const { data: host, error: hostErr } = await db
    .from('work_hosts')
    .select(HOST_COLUMNS)
    .eq('id', (lane as LaneRow).host_id)
    .eq('api_key_id', c.get('apiKeyId') as string)
    .maybeSingle()
  if (hostErr) return new Refusal(err(c, 'DB_ERROR', 'Could not read the host.', 500))
  if (!host) return new Refusal(err(c, 'NOT_FOUND', 'That lane belongs to another worker.', 404))
  if ((host as HostRow).revoked_at) return new Refusal(err(c, 'HOST_REVOKED', 'This worker was revoked in the console. Stop, and set it up again with `mushi worker install`.', 403))
  return { lane: lane as LaneRow, host: host as HostRow }
}

/** The worker's own claim, by id. */
async function ownClaim(db: Db, c: Ctx, claimId: string): Promise<ClaimRow | Refusal> {
  if (!UUID_RE.test(claimId)) return new Refusal(err(c, 'VALIDATION_ERROR', 'claim id must be a uuid.', 400))
  const { data: claim, error } = await db.from('work_claims').select(CLAIM_COLUMNS).eq('id', claimId).maybeSingle()
  if (error) return new Refusal(err(c, 'DB_ERROR', 'Could not read the claim.', 500))
  if (!claim) return new Refusal(err(c, 'NOT_FOUND', 'No such claim.', 404))
  const { data: host, error: hostErr } = await db
    .from('work_hosts')
    .select('id, revoked_at')
    .eq('id', (claim as ClaimRow).host_id)
    .eq('api_key_id', c.get('apiKeyId') as string)
    .maybeSingle()
  if (hostErr) return new Refusal(err(c, 'DB_ERROR', 'Could not read the host.', 500))
  if (!host) return new Refusal(err(c, 'NOT_FOUND', 'That claim belongs to another worker.', 404))
  if ((host as { revoked_at: string | null }).revoked_at) return new Refusal(err(c, 'HOST_REVOKED', 'This worker was revoked in the console.', 403))
  return claim as ClaimRow
}

/**
 * Put an infra-failed (or lease-expired) report back at the front of its lane,
 * at most once a week per report on its own (ADR 0048): after that a person
 * decides, with /pipeline's "Requeue".
 */
async function autoRequeue(db: Db, claim: ClaimRow, failureKind: string | null, source: 'requeue' | 'lease_expired', now: Date): Promise<boolean> {
  // Conflict and audit claims hold no report: there is nothing to put back.
  if (!claim.report_id) return false
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const { data: earlier, error } = await db
    .from('work_claims')
    .select('claimed_at')
    .eq('report_id', claim.report_id)
    .eq('auto_requeued', true)
    .gte('claimed_at', since)
  if (error) {
    wlog.warn('auto requeue skipped: earlier requeues unreadable', { claimId: claim.id, err: error.message })
    return false
  }
  if (!mayAutoRequeue({ failureKind: failureKind as 'infra' | 'code' | null }, (earlier ?? []) as Array<{ claimed_at: string }>, now)) return false
  const lane: QueueLane = { id: claim.lane_id, projectId: claim.project_id, hostId: claim.host_id }
  const q = await enqueueReports(db, lane, [claim.report_id!], { source, front: true, now })
  if ('error' in q) {
    wlog.warn('auto requeue failed', { claimId: claim.id, err: q.error })
    return false
  }
  await db.from('work_claims').update({ auto_requeued: true, updated_at: now.toISOString() }).eq('id', claim.id)
  return true
}

/**
 * End leases that ran out in this app: expired, counted as infra. A report is
 * put back once; a conflict's queue row is freed and its cap slot given back.
 */
export async function expireLeases(db: Db, projectId: string, now: Date): Promise<number> {
  const { data, error } = await db
    .from('work_claims')
    .select(CLAIM_COLUMNS)
    .eq('project_id', projectId)
    .eq('status', 'active')
    .lt('lease_until', now.toISOString())
    .limit(50)
  if (error) {
    wlog.warn('lease expiry read failed', { projectId, err: error.message })
    return 0
  }
  let n = 0
  for (const claim of (data ?? []) as ClaimRow[]) {
    const { data: ended } = await db
      .from('work_claims')
      .update({ status: 'expired', outcome: 'lease_expired', failure_kind: 'infra', finished_at: now.toISOString(), updated_at: now.toISOString(), detail: 'The worker stopped renewing its lease (it was stopped, lost its network or crashed).' })
      .eq('id', claim.id)
      .eq('status', 'active')
      .select('id')
    if (!ended || (ended as unknown[]).length === 0) continue
    n++
    if (claim.kind === 'conflict') {
      const { data: lane } = await db.from('work_lanes').select('name').eq('id', claim.lane_id).maybeSingle()
      await endConflictClaim(db, claim, { outcome: 'lease_expired', failureKind: 'infra', detail: 'its lease ran out', headAfter: null }, (lane as { name?: string } | null)?.name ?? 'a lane', now)
    } else {
      await autoRequeue(db, claim, 'infra', 'lease_expired', now)
    }
  }
  return n
}

interface CandidateReport {
  id: string
  project_id: string
  severity: string | null
  status: string
  source: string | null
  created_at: string
}

/**
 * The reports a lane may claim now, in order: its queue (a person's order;
 * the 7-day cooldown does not apply, as `mushi work --report` never did), then
 * classified and reopened reports ranked worst first, newest first. Never a
 * report with an active claim, an in-flight cloud dispatch, a live run or an
 * open PR; a ranked one also never in a local cooldown, nor one waiting in
 * another lane's queue. A `skill` lane takes only skill-run rounds from its
 * own queue (ADR 0042 amendment), never ranked bug reports.
 */
export async function claimCandidates(db: Db, lane: LaneRow, now: Date): Promise<Array<CandidateReport & { fromQueue: boolean }>> {
  const skillOnly = lane.mode === 'skill'
  const { data: queueRows, error: qErr } = await db
    .from('work_queue')
    .select('report_id, position, created_at')
    .eq('lane_id', lane.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(QUEUE_HEAD)
  if (qErr) throw new Error(`work queue read failed: ${qErr.message}`)
  const queued = ((queueRows ?? []) as Array<{ report_id: string }>).map((r) => r.report_id)

  const lists = await Promise.all(
    (skillOnly ? [] : ['classified', 'reopened']).map((status) =>
      db
        .from('reports')
        .select('id, project_id, severity, status, source, created_at')
        .eq('project_id', lane.project_id)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(CANDIDATES_PER_STATUS),
    ),
  )
  for (const l of lists) if (l.error) throw new Error(`reports read failed: ${l.error.message}`)
  const ranked = rankWorkCandidates(lists.flatMap((l) => (l.data ?? []) as CandidateReport[]))

  let queuedReports: CandidateReport[] = []
  if (queued.length) {
    const { data, error } = await db.from('reports').select('id, project_id, severity, status, source, created_at').in('id', queued)
    if (error) throw new Error(`queued reports read failed: ${error.message}`)
    const byId = new Map(((data ?? []) as CandidateReport[]).map((r) => [r.id, r]))
    const stale: string[] = []
    for (const id of queued) {
      const r = byId.get(id)
      if (!r || r.project_id !== lane.project_id || CLOSED_STATUSES.has(r.status)) stale.push(id)
      // A skill lane leaves a bug report someone queued in it where it is.
      else if (!skillOnly || r.source === 'skill_run') queuedReports.push(r)
    }
    // A queued report that was fixed, dismissed or deleted meanwhile leaves the queue.
    if (stale.length) await db.from('work_queue').delete().eq('lane_id', lane.id).in('report_id', stale)
  }

  const ids = [...new Set([...queuedReports.map((r) => r.id), ...ranked.map((r) => r.id)])]
  if (ids.length === 0) return []
  const claimed = await activeWorkClaims(db, ids, now)
  if ('error' in claimed) throw new Error(`work claims read failed: ${claimed.error}`)
  const elsewhere = ranked.length ? await queuedForLocalLanes(db, ranked.map((r) => r.id), lane.id) : { ids: new Set<string>() }
  if ('error' in elsewhere) throw new Error(`work queues read failed: ${elsewhere.error}`)
  const inflight = new Set<string>()
  const attempts = new Map<string, AttemptLite[]>()
  for (const part of chunks(ids)) {
    const [jobs, att] = await Promise.all([
      db.from('fix_dispatch_jobs').select('report_id').in('report_id', part).in('status', ['queued', 'running']),
      db.from('fix_attempts').select(ATTEMPT_COLUMNS).in('report_id', part),
    ])
    if (jobs.error) throw new Error(`dispatch jobs read failed: ${jobs.error.message}`)
    if (att.error) throw new Error(`fix attempts read failed: ${att.error.message}`)
    for (const j of (jobs.data ?? []) as Array<{ report_id: string }>) inflight.add(j.report_id)
    for (const a of (att.data ?? []) as AttemptLite[]) attempts.set(a.report_id, [...(attempts.get(a.report_id) ?? []), a])
  }
  const free = (id: string) => !claimed.ids.has(id) && !inflight.has(id)
  // A queued report waits (it stays queued) while anything else works on it:
  // a claim, a cloud dispatch, or a live run or open PR. The 7-day cooldown
  // does not apply to it: a person put it there.
  queuedReports = queuedReports.filter((r) => free(r.id) && !hasLiveAttempt(attempts.get(r.id) ?? []))
  const queuedIds = new Set(queuedReports.map((r) => r.id))
  const rest = ranked.filter((r) => !queuedIds.has(r.id) && !elsewhere.ids.has(r.id) && free(r.id) && !hasLiveAttempt(attempts.get(r.id) ?? []) && !inLocalCooldown(attempts.get(r.id) ?? [], now))
  return [...queuedReports.map((r) => ({ ...r, fromQueue: true })), ...rest.map((r) => ({ ...r, fromQueue: false }))]
}

/** What the agent needs, so the worker makes no admin reads: the report, its fix packet and what earlier attempts did. */
async function claimPayload(db: Db, reportId: string) {
  const { data: report, error } = await db.from('reports').select(REPORT_DETAIL_COLUMNS).eq('id', reportId).maybeSingle()
  if (error || !report) throw new Error(`report read failed: ${error?.message ?? 'not found'}`)
  const row = report as Record<string, unknown>
  const { data: att } = await db.from('fix_attempts').select(ATTEMPT_COLUMNS).eq('report_id', reportId).order('created_at', { ascending: false }).limit(10)
  const attempts = (att ?? []) as Array<AttemptLite & { id: string }>
  const withPr = attempts.slice(0, 3).filter((a) => a.pr_url)
  const reviews = new Map<string, { verdict: string | null; summary: string | null; findings: unknown }>()
  if (withPr.length) {
    const { data: rv } = await db
      .from('fix_reviews')
      .select('fix_attempt_id, verdict, summary, findings, completed_at')
      .in('fix_attempt_id', withPr.map((a) => a.id))
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
    for (const r of (rv ?? []) as Array<{ fix_attempt_id: string; verdict: string | null; summary: string | null; findings: unknown }>) {
      if (!reviews.has(r.fix_attempt_id)) reviews.set(r.fix_attempt_id, r)
    }
  }
  let fixPacket: string | null = null
  try {
    fixPacket = composeFixPacket(fixPacketContextFromReport(row))
  } catch {
    fixPacket = null
  }
  const s2 = (row.stage2_analysis as { rootCause?: string | null } | null) ?? null
  return {
    report: {
      id: row.id,
      project_id: row.project_id,
      summary: row.summary ?? null,
      description: row.description ?? null,
      category: row.category ?? null,
      severity: row.severity ?? null,
      status: row.status ?? null,
      fix_packet: fixPacket,
      reproduction_steps: Array.isArray(row.reproduction_steps) ? row.reproduction_steps : [],
      stage2_analysis: s2 ? { rootCause: s2.rootCause ?? null } : null,
      fix_attempts: attempts,
    },
    earlier: attempts.slice(0, 3).map((a) => {
      const r = reviews.get(a.id)
      return {
        createdAt: a.created_at,
        prUrl: a.pr_url,
        verdict: r?.verdict ?? null,
        summary: r?.summary ?? null,
        findings: Array.isArray(r?.findings) ? (r!.findings as unknown[]).slice(0, 10) : [],
        note: a.error ?? null,
      }
    }),
  }
}

async function heartbeat(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const denied = workerOnly(c)
  if (denied) return denied
  const db = deps.getServiceClient()
  const now = deps.now()
  const keyId = c.get('apiKeyId') as string
  const userId = c.get('userId') as string
  const rate = await deps.claimRateLimit(db, `work:${keyId}:heartbeat`, HEARTBEATS_PER_MINUTE, 60)
  if (!rate.allowed) return err(c, 'RATE_LIMITED', 'Too many heartbeats; one a minute is enough.', 429)
  const parsed = parseHeartbeat(await c.req.json().catch(() => null))
  if (!parsed.ok) return err(c, 'VALIDATION_ERROR', parsed.message, 400)
  const hb = parsed.value

  const { data: existing, error: readErr } = await db.from('work_hosts').select(HOST_COLUMNS).eq('api_key_id', keyId).eq('host_id', hb.host.hostId).maybeSingle()
  if (readErr) return err(c, 'DB_ERROR', 'Could not read this worker.', 500)
  if ((existing as HostRow | null)?.revoked_at) {
    return err(c, 'HOST_REVOKED', 'This worker was revoked in the console. Stop, and set it up again with `mushi worker install`.', 403)
  }
  const hostFields = {
    owner_user_id: userId,
    hostname: hb.host.hostname,
    platform: hb.host.platform,
    mushi_version: hb.host.version,
    status: hb.status,
    // Server time: a machine with a wrong clock must not look fresh or stale.
    last_heartbeat_at: now.toISOString(),
    updated_at: now.toISOString(),
  }
  let host: HostRow
  if (existing) {
    const { data, error } = await db.from('work_hosts').update(hostFields).eq('id', (existing as HostRow).id).select(HOST_COLUMNS).single()
    if (error || !data) return err(c, 'DB_ERROR', 'The heartbeat could not be stored.', 500)
    host = data as HostRow
  } else {
    const { data, error } = await db.from('work_hosts').insert({ ...hostFields, api_key_id: keyId, host_id: hb.host.hostId }).select(HOST_COLUMNS).single()
    if (error || !data) return err(c, 'DB_ERROR', 'This worker could not be registered.', 500)
    host = data as HostRow
  }

  const { data: laneRows, error: lanesErr } = await db.from('work_lanes').select(LANE_COLUMNS).eq('host_id', host.id)
  if (lanesErr) return err(c, 'DB_ERROR', 'Could not read the lanes.', 500)
  const known = new Map(((laneRows ?? []) as LaneRow[]).map((l) => [l.name, l]))
  const lanes: Array<{ id: string; name: string; projectId: string; config: LaneConfig }> = []
  const refused: Array<{ name: string; reason: string }> = []
  for (const l of hb.lanes) {
    const access = await deps.access(c, db, userId, l.projectId)
    if (!access.allowed || access.role === 'viewer') {
      refused.push({ name: l.name, reason: access.allowed ? 'A viewer cannot run fixes for this app.' : 'This key cannot reach that app.' })
      continue
    }
    const prev = known.get(l.name)
    if (prev && prev.project_id !== l.projectId) {
      refused.push({ name: l.name, reason: 'This lane name is registered for another app on this machine. Give the lane a new name.' })
      continue
    }
    let row: LaneRow | null = prev ?? null
    if (prev) {
      const { data } = await db
        .from('work_lanes')
        .update({ status: l.status, last_seen_at: now.toISOString(), ...(l.repo ? { repo: l.repo } : {}) })
        .eq('id', prev.id)
        .select(LANE_COLUMNS)
        .single()
      row = (data as LaneRow | null) ?? prev
    } else {
      const { data, error } = await db
        .from('work_lanes')
        .insert({ ...NEW_LANE_DEFAULTS, ...l.initial, host_id: host.id, project_id: l.projectId, name: l.name, repo: l.repo, status: l.status, last_seen_at: now.toISOString() })
        .select(LANE_COLUMNS)
        .single()
      if (error || !data) {
        refused.push({ name: l.name, reason: 'The lane could not be registered. Try again in a minute.' })
        continue
      }
      row = data as LaneRow
    }
    lanes.push({ id: row.id, name: row.name, projectId: row.project_id, config: laneConfigFromRow(row) })
  }

  // The heartbeat renews the leases the worker is still working on.
  let renewed: string[] = []
  if (hb.claims.length) {
    const { data } = await db
      .from('work_claims')
      .update({ lease_until: new Date(now.getTime() + WORK_LEASE_MS).toISOString(), updated_at: now.toISOString() })
      .in('id', hb.claims)
      .eq('host_id', host.id)
      .eq('status', 'active')
      .gt('lease_until', now.toISOString())
      .select('id')
    renewed = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
  }
  const lost = hb.claims.filter((id) => !renewed.includes(id))
  return c.json({
    ok: true,
    data: { hostId: host.id, heartbeatSeconds: 60, guards: hostGuardsFrom(host.guards), lanes, refused, renewed, lost },
  })
}

async function claim(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const denied = workerOnly(c)
  if (denied) return denied
  const db = deps.getServiceClient()
  const now = deps.now()
  const keyId = c.get('apiKeyId') as string
  const userId = c.get('userId') as string
  const rate = await deps.claimRateLimit(db, `work:${keyId}:claim`, CLAIMS_PER_MINUTE, 60)
  if (!rate.allowed) return err(c, 'RATE_LIMITED', 'Too many claims; wait a minute.', 429)
  const body = (await c.req.json().catch(() => ({}))) as { laneId?: unknown }
  const own = await ownLane(db, c, typeof body.laneId === 'string' ? body.laneId : '')
  if (own instanceof Refusal) return own.response
  const { lane, host } = own
  const access = await deps.access(c, db, userId, lane.project_id)
  if (!access.allowed || access.role === 'viewer') return err(c, 'FORBIDDEN', 'This key can no longer run fixes for that app.', 403)

  await expireLeases(db, lane.project_id, now)
  const cfg = laneConfigFromRow(lane)
  const { data: active, error: activeErr } = await db
    .from('work_claims')
    .select('id')
    .eq('lane_id', lane.id)
    .eq('status', 'active')
    .gt('lease_until', now.toISOString())
  if (activeErr) return err(c, 'DB_ERROR', 'Could not read the lane\'s claims.', 500)
  const block = laneClaimBlock(cfg, ((active ?? []) as unknown[]).length, now)
  if (block) return c.json({ ok: true, data: { claim: null, reason: block } })
  const leaseUntil = new Date(now.getTime() + WORK_LEASE_MS).toISOString()
  if (cfg.mode === 'conflicts') return claimConflictMode(c, db, lane, now, leaseUntil, cfg)
  if (cfg.mode === 'audit') return claimAuditMode(c, db, lane, host, now, leaseUntil, cfg)

  let candidates
  try {
    candidates = await claimCandidates(db, lane, now)
  } catch (e) {
    wlog.warn('claim candidates unreadable', { laneId: lane.id, err: e instanceof Error ? e.message : String(e) })
    return err(c, 'DB_ERROR', 'Could not read what the lane may take. Try again in a minute.', 503)
  }
  const won = await claimFirstFree(candidates, async (r) => {
    const { data, error } = await db
      .from('work_claims')
      .insert({ kind: 'fix', lane_id: lane.id, host_id: host.id, project_id: lane.project_id, report_id: r.id, status: 'active', from_queue: r.fromQueue, lease_until: leaseUntil, claimed_at: now.toISOString() })
      .select('id')
      .single()
    if (error?.code === '23505') return { won: false as const }
    if (error || !data) throw new Error(`claim insert failed: ${error?.message ?? 'no row'}`)
    return { won: true as const, claimId: (data as { id: string }).id }
  }).catch((e: unknown) => e as Error)
  if (won instanceof Error) {
    wlog.error('claim failed', { laneId: lane.id, err: won.message })
    return err(c, 'DB_ERROR', 'The claim could not be stored. Try again in a minute.', 500)
  }
  if (!won) {
    const reason = cfg.mode === 'skill' ? "Nothing to work on: no skill-run round waits in this lane's queue." : 'Nothing to work on: no queued or open report is free.'
    return c.json({ ok: true, data: { claim: null, reason } })
  }
  if (won.candidate.fromQueue) await db.from('work_queue').delete().eq('lane_id', lane.id).eq('report_id', won.candidate.id)

  let payload
  try {
    payload = await claimPayload(db, won.candidate.id)
  } catch (e) {
    // Give the claim back: the worker cannot work without the report.
    await db.from('work_claims').update({ status: 'done', outcome: 'skipped', finished_at: now.toISOString(), detail: 'The report could not be read.' }).eq('id', won.claimId)
    wlog.warn('claimed report unreadable', { claimId: won.claimId, err: e instanceof Error ? e.message : String(e) })
    return err(c, 'DB_ERROR', 'The claimed report could not be read; the claim was given back.', 503)
  }
  return c.json({
    ok: true,
    data: {
      claim: { id: won.claimId, kind: 'fix', laneId: lane.id, projectId: lane.project_id, leaseUntil, fromQueue: won.candidate.fromQueue, model: cfg.model, ...payload },
    },
  })
}

/** A `conflicts` lane (ADR 0049): one merge-queue conflict of its clone's repository, under the cap of 2 agents per PR. */
async function claimConflictMode(c: Ctx, db: Db, lane: LaneRow, now: Date, leaseUntil: string, cfg: LaneConfig): Promise<Response> {
  let res
  try {
    res = await claimConflict(db, lane, now, leaseUntil)
  } catch (e) {
    wlog.warn('conflict claim failed', { laneId: lane.id, err: e instanceof Error ? e.message : String(e) })
    return err(c, 'DB_ERROR', 'Could not read the merge queue. Try again in a minute.', 503)
  }
  if ('reason' in res) return c.json({ ok: true, data: { claim: null, reason: res.reason } })
  const k = res.claim
  return c.json({
    ok: true,
    data: {
      claim: {
        id: k.claimId,
        kind: 'conflict',
        laneId: lane.id,
        projectId: lane.project_id,
        leaseUntil,
        model: cfg.model,
        conflict: { queueId: k.queueId, repo: k.repo, prNumber: k.prNumber, headRef: k.headRef, headSha: k.headSha, prUrl: k.prUrl },
      },
    },
  })
}

/** An `audit` lane (ADR 0050): one audit pass, while the app's hourly audit cap has room. The worker picks the screen itself. */
async function claimAuditMode(c: Ctx, db: Db, lane: LaneRow, host: HostRow, now: Date, leaseUntil: string, cfg: LaneConfig): Promise<Response> {
  const filed = await auditFiledLastHour(db, lane.project_id, now)
  if (filed === null) return err(c, 'DB_ERROR', "Could not read the audit's hourly count. Try again in a minute.", 503)
  if (filed >= AUDIT_FINDINGS_PER_HOUR) {
    return c.json({ ok: true, data: { claim: null, reason: `This app already filed ${AUDIT_FINDINGS_PER_HOUR} code-audit findings in the last hour.` } })
  }
  const { data, error } = await db
    .from('work_claims')
    .insert({ kind: 'audit', report_id: null, lane_id: lane.id, host_id: host.id, project_id: lane.project_id, status: 'active', lease_until: leaseUntil, claimed_at: now.toISOString() })
    .select('id')
    .single()
  if (error || !data) return err(c, 'DB_ERROR', 'The claim could not be stored. Try again in a minute.', 500)
  return c.json({
    ok: true,
    data: {
      claim: {
        id: (data as { id: string }).id,
        kind: 'audit',
        laneId: lane.id,
        projectId: lane.project_id,
        leaseUntil,
        model: cfg.model,
        audit: { reviewModel: lane.review_model, findingsLeft: AUDIT_FINDINGS_PER_HOUR - filed },
      },
    },
  })
}

async function renew(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const denied = workerOnly(c)
  if (denied) return denied
  const db = deps.getServiceClient()
  const now = deps.now()
  const own = await ownClaim(db, c, c.req.param('id') ?? '')
  if (own instanceof Refusal) return own.response
  const leaseUntil = new Date(now.getTime() + WORK_LEASE_MS).toISOString()
  const { data } = await db
    .from('work_claims')
    .update({ lease_until: leaseUntil, updated_at: now.toISOString() })
    .eq('id', own.id)
    .eq('status', 'active')
    .gt('lease_until', now.toISOString())
    .select('id')
  if (!data || (data as unknown[]).length === 0) {
    return err(c, 'LEASE_LOST', 'This claim already ended (its lease ran out or it was finished). Stop work on it; the report may be with another worker.', 409)
  }
  return c.json({ ok: true, data: { leaseUntil } })
}

async function done(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const denied = workerOnly(c)
  if (denied) return denied
  const db = deps.getServiceClient()
  const now = deps.now()
  const own = await ownClaim(db, c, c.req.param('id') ?? '')
  if (own instanceof Refusal) return own.response
  const parsed = parseClaimDone(await c.req.json().catch(() => null))
  if (!parsed.ok) return err(c, 'VALIDATION_ERROR', parsed.message, 400)
  const d = parsed.value
  if (own.status !== 'active') return err(c, 'CLAIM_ENDED', `This claim already ended (${own.outcome ?? own.status}).`, 409)
  const wrongKind = outcomeKindRefusal(d.outcome, own.kind)
  if (wrongKind) return err(c, 'VALIDATION_ERROR', wrongKind, 400)
  let fixId: string | null = null
  if (d.fixId) {
    const { data: fix } = await db.from('fix_attempts').select('id, report_id').eq('id', d.fixId).maybeSingle()
    if ((fix as { report_id?: string } | null)?.report_id === own.report_id) fixId = d.fixId
  }
  const { data: ended } = await db
    .from('work_claims')
    .update({
      status: 'done',
      outcome: d.outcome,
      failure_kind: d.failureKind,
      fix_attempt_id: fixId,
      pr_url: d.prUrl,
      detail: d.detail,
      head_after: own.kind === 'conflict' ? d.headAfter : null,
      finished_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', own.id)
    .eq('status', 'active')
    .select('id')
  if (!ended || (ended as unknown[]).length === 0) return err(c, 'CLAIM_ENDED', 'This claim already ended.', 409)
  if (own.kind === 'conflict') {
    const { data: laneRow } = await db.from('work_lanes').select('name').eq('id', own.lane_id).maybeSingle()
    await endConflictClaim(db, own, d, (laneRow as { name?: string } | null)?.name ?? 'a lane', now)
    return c.json({ ok: true, data: { requeued: false } })
  }
  const requeued = d.failureKind === 'infra' ? await autoRequeue(db, own, d.failureKind, 'requeue', now) : false
  return c.json({ ok: true, data: { requeued } })
}

/** An audit claim files one finding its worker reproduced with a deterministic check (ADR 0050). */
async function finding(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const denied = workerOnly(c)
  if (denied) return denied
  const db = deps.getServiceClient()
  const now = deps.now()
  const own = await ownClaim(db, c, c.req.param('id') ?? '')
  if (own instanceof Refusal) return own.response
  if (own.kind !== 'audit') return err(c, 'VALIDATION_ERROR', 'Only an audit claim files findings.', 400)
  if (own.status !== 'active' || Date.parse(own.lease_until) <= now.getTime()) return err(c, 'CLAIM_ENDED', 'This audit claim already ended; claim again.', 409)
  const parsed = parseAuditFinding(await c.req.json().catch(() => null))
  if (!parsed.ok) return err(c, 'VALIDATION_ERROR', parsed.message, 400)
  const userId = c.get('userId') as string
  const access = await deps.access(c, db, userId, own.project_id)
  if (!access.allowed || access.role === 'viewer') return err(c, 'FORBIDDEN', 'This key can no longer file reports for that app.', 403)
  const { data: laneData, error } = await db.from('work_lanes').select('id, host_id, project_id, name, repo, review_model').eq('id', own.lane_id).maybeSingle()
  if (error || !laneData) return err(c, 'DB_ERROR', 'Could not read the lane.', 500)
  const lane = laneData as ModeLane
  const res = await deps.fileFinding(db, parsed.value, { lane, ownerUserId: userId, now })
  if (!res.ok) return c.json({ ok: false, error: { code: res.code, message: res.message, ...(res.reportId ? { reportId: res.reportId } : {}) } }, res.status)
  await deps
    .logAudit(db, own.project_id, userId, 'report.created', 'report', res.reportId, { source: 'code_audit', lane: lane.name, file: parsed.value.file, rule: parsed.value.rule }, { actorType: 'api_key' })
    .catch(() => {})
  return c.json({ ok: true, data: { reportId: res.reportId, queuedLaneId: res.queuedLaneId } }, 201)
}

async function revokeSelf(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const denied = workerOnly(c)
  if (denied) return denied
  const db = deps.getServiceClient()
  const now = deps.now().toISOString()
  const keyId = c.get('apiKeyId') as string
  const { error } = await db.from('project_api_keys').update({ is_active: false, revoked_at: now }).eq('id', keyId)
  if (error) return err(c, 'DB_ERROR', 'The key could not be revoked.', 500)
  await db.from('work_hosts').update({ revoked_at: now, updated_at: now }).eq('api_key_id', keyId)
  return c.json({ ok: true, data: { revoked: true } })
}

// ── Console and CLI ─────────────────────────────────────────────────────────

async function listLanes(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const now = deps.now()
  const userId = c.get('userId') as string
  const requested = c.req.query('projectId')
  let projectIds: string[]
  if (requested) {
    if (!UUID_RE.test(requested)) return err(c, 'VALIDATION_ERROR', 'projectId must be a uuid.', 400)
    const access = await deps.access(c, db, userId, requested)
    if (!access.allowed) return err(c, 'NOT_FOUND', 'Project not found', 404)
    projectIds = [requested]
  } else {
    projectIds = await deps.projectIds(c, db, userId)
  }
  const empty = { generatedAt: now.toISOString(), hosts: [], lanes: [], projects: [] }
  if (projectIds.length === 0) return c.json({ ok: true, data: empty })

  const lanes: LaneRow[] = []
  for (const part of chunks(projectIds)) {
    const { data, error } = await db.from('work_lanes').select(LANE_COLUMNS).in('project_id', part)
    if (error) {
      if (['42P01', 'PGRST205'].includes((error as { code?: string }).code ?? '')) return c.json({ ok: true, data: empty })
      return err(c, 'DB_ERROR', 'Could not read the lanes.', 500)
    }
    lanes.push(...((data ?? []) as LaneRow[]))
  }
  const hostIds = [...new Set(lanes.map((l) => l.host_id))]
  const [byId, mine] = await Promise.all([
    hostIds.length ? db.from('work_hosts').select(HOST_COLUMNS).in('id', hostIds) : Promise.resolve({ data: [], error: null }),
    db.from('work_hosts').select(HOST_COLUMNS).eq('owner_user_id', userId),
  ])
  if (byId.error || mine.error) return err(c, 'DB_ERROR', 'Could not read the workers.', 500)
  const hosts = new Map<string, HostRow>()
  for (const h of [...((byId.data ?? []) as HostRow[]), ...((mine.data ?? []) as HostRow[])]) hosts.set(h.id, h)

  const laneIds = lanes.map((l) => l.id)
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString()
  const queue: Array<{ lane_id: string; report_id: string; position: number; source: string; created_at: string }> = []
  const claims: ClaimRow[] = []
  for (const part of chunks(laneIds)) {
    const [q, cl] = await Promise.all([
      db.from('work_queue').select('lane_id, report_id, position, source, created_at').in('lane_id', part).order('position', { ascending: true }).order('created_at', { ascending: true }),
      db.from('work_claims').select(CLAIM_COLUMNS).in('lane_id', part).gte('claimed_at', since).order('claimed_at', { ascending: false }).limit(500),
    ])
    if (q.error || cl.error) return err(c, 'DB_ERROR', 'Could not read the queues.', 500)
    queue.push(...((q.data ?? []) as typeof queue))
    claims.push(...((cl.data ?? []) as ClaimRow[]))
  }
  const reportIds = [...new Set([...queue.map((q) => q.report_id), ...claims.map((x) => x.report_id).filter((x): x is string => !!x)])]
  const queueRowIds = [...new Set(claims.map((x) => x.merge_queue_id).filter((x): x is string => !!x))]
  const prs = new Map<string, { repo: string; pr_number: number }>()
  for (const part of chunks(queueRowIds)) {
    const { data } = await db.from('fix_merge_queue').select('id, repo, pr_number').in('id', part)
    for (const r of (data ?? []) as Array<{ id: string; repo: string; pr_number: number }>) prs.set(r.id, r)
  }
  const reports = new Map<string, { summary: string | null; severity: string | null; status: string }>()
  for (const part of chunks(reportIds)) {
    const { data } = await db.from('reports').select('id, summary, severity, status').in('id', part)
    for (const r of (data ?? []) as Array<{ id: string; summary: string | null; severity: string | null; status: string }>) reports.set(r.id, r)
  }
  const { data: projectRows } = await db.from('projects').select('id, name').in('id', projectIds)
  const names = new Map(((projectRows ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]))
  const title = (id: string) => reports.get(id)?.summary ?? `Report ${id.slice(0, 8)}`
  const claimTitle = (x: ClaimRow) => {
    if (x.kind === 'conflict') {
      const pr = x.merge_queue_id ? prs.get(x.merge_queue_id) : undefined
      return pr ? `Merge conflict on ${pr.repo}#${pr.pr_number}` : 'Merge conflict'
    }
    if (x.kind === 'audit') return 'Code-read audit pass'
    return title(x.report_id ?? '')
  }
  const isActive = (x: ClaimRow) => x.status === 'active' && Date.parse(x.lease_until) > now.getTime()

  return c.json({
    ok: true,
    data: {
      generatedAt: now.toISOString(),
      projects: projectIds.map((id) => ({ id, name: names.get(id) ?? id.slice(0, 8) })),
      hosts: [...hosts.values()].map((h) => ({
        id: h.id,
        hostname: h.hostname,
        platform: h.platform,
        version: h.mushi_version,
        online: !h.revoked_at && hostOnline(h.last_heartbeat_at, now),
        lastHeartbeatAt: h.last_heartbeat_at,
        status: h.status ?? {},
        guards: hostGuardsFrom(h.guards),
        revoked: !!h.revoked_at,
        mine: h.owner_user_id === userId,
      })),
      lanes: lanes
        .map((l) => {
          const mineClaims = claims.filter((x) => x.lane_id === l.id)
          const finished = mineClaims.filter((x) => x.status !== 'active')
          return {
            id: l.id,
            hostId: l.host_id,
            projectId: l.project_id,
            projectName: names.get(l.project_id) ?? l.project_id.slice(0, 8),
            name: l.name,
            config: laneConfigFromRow(l),
            reviewModel: l.review_model,
            repo: l.repo,
            status: l.status ?? {},
            lastSeenAt: l.last_seen_at,
            active: mineClaims.filter(isActive).map((x) => ({ claimId: x.id, kind: x.kind, reportId: x.report_id, title: claimTitle(x), since: x.claimed_at, leaseUntil: x.lease_until, fromQueue: x.from_queue })),
            queue: queue
              .filter((q) => q.lane_id === l.id)
              .map((q) => ({ reportId: q.report_id, title: title(q.report_id), severity: reports.get(q.report_id)?.severity ?? null, status: reports.get(q.report_id)?.status ?? null, source: q.source, position: q.position })),
            recent: finished.slice(0, 20).map((x) => ({
              claimId: x.id,
              kind: x.kind,
              reportId: x.report_id,
              title: claimTitle(x),
              outcome: x.outcome,
              failureKind: x.failure_kind,
              prUrl: x.pr_url,
              detail: x.detail,
              claimedAt: x.claimed_at,
              finishedAt: x.finished_at,
              autoRequeued: x.auto_requeued,
            })),
            counts7d: {
              runs: finished.length,
              prs: finished.filter((x) => x.outcome === 'pr_opened').length,
              merges: finished.filter((x) => x.outcome === 'pushed').length,
              filed: finished.filter((x) => x.outcome === 'filed').length,
              noChange: finished.filter((x) => x.outcome === 'no_change' || x.outcome === 'verdict' || x.outcome === 'refused').length,
              timeouts: finished.filter((x) => x.outcome === 'timeout').length,
              errors: finished.filter((x) => x.outcome === 'failed' || x.outcome === 'lease_expired').length,
              infra: finished.filter((x) => x.failure_kind === 'infra').length,
            },
          }
        })
        .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name)),
    },
  })
}

/** A lane the console caller may change: a non-viewer member of its app. */
async function writableLane(c: Ctx, deps: WorkRouteDeps, db: Db, laneId: string, action: string): Promise<LaneRow | Refusal> {
  if (!UUID_RE.test(laneId)) return new Refusal(err(c, 'VALIDATION_ERROR', 'lane id must be a uuid.', 400))
  const { data, error } = await db.from('work_lanes').select(LANE_COLUMNS).eq('id', laneId).maybeSingle()
  if (error) return new Refusal(err(c, 'DB_ERROR', 'Could not read the lane.', 500))
  if (!data) return new Refusal(err(c, 'NOT_FOUND', 'Lane not found.', 404))
  const lane = data as LaneRow
  const access = await deps.access(c, db, c.get('userId') as string, lane.project_id)
  if (!access.allowed) return new Refusal(err(c, 'NOT_FOUND', 'Lane not found.', 404))
  if (access.role === 'viewer') return new Refusal(err(c, 'FORBIDDEN', `Viewers have read-only access, so they cannot ${action}.`, 403))
  return lane
}

async function patchLane(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const now = deps.now()
  const parsed = parseLaneSettings(await c.req.json().catch(() => null))
  if (!parsed.ok) return err(c, 'VALIDATION_ERROR', parsed.message, 400)
  const lane = await writableLane(c, deps, db, c.req.param('id') ?? '', 'change a lane')
  if (lane instanceof Refusal) return lane.response
  const userId = c.get('userId') as string
  const { data, error } = await db
    .from('work_lanes')
    .update({ ...parsed.value, updated_by: userId, updated_at: now.toISOString() })
    .eq('id', lane.id)
    .select(LANE_COLUMNS)
    .single()
  if (error || !data) return err(c, 'DB_ERROR', 'The lane could not be changed.', 500)
  await deps.logAudit(db, lane.project_id, userId, 'settings.updated', 'work_lane', lane.id, { lane: lane.name, ...parsed.value }).catch(() => {})
  return c.json({ ok: true, data: { id: lane.id, config: laneConfigFromRow(data as LaneRow), reviewModel: (data as LaneRow).review_model } })
}

async function putQueue(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const now = deps.now()
  const body = (await c.req.json().catch(() => ({}))) as { reportIds?: unknown; append?: unknown }
  const reportIds = Array.isArray(body.reportIds) ? [...new Set(body.reportIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))] : null
  if (!reportIds || reportIds.length > QUEUE_MAX || (body.append === true && reportIds.length === 0)) {
    return err(c, 'VALIDATION_ERROR', `reportIds must list up to ${QUEUE_MAX} report ids (at least one to append).`, 400)
  }
  const lane = await writableLane(c, deps, db, c.req.param('id') ?? '', 'change a queue')
  if (lane instanceof Refusal) return lane.response
  const userId = c.get('userId') as string
  if (reportIds.length) {
    const { data, error } = await db.from('reports').select('id, project_id').in('id', reportIds)
    if (error) return err(c, 'DB_ERROR', 'Could not read the reports.', 500)
    const ok = new Set(((data ?? []) as Array<{ id: string; project_id: string }>).filter((r) => r.project_id === lane.project_id).map((r) => r.id))
    const foreign = reportIds.filter((id) => !ok.has(id))
    if (foreign.length) return err(c, 'VALIDATION_ERROR', `${foreign.length} of these reports are not in this lane's app.`, 422)
  }
  const ref: QueueLane = { id: lane.id, projectId: lane.project_id, hostId: lane.host_id }
  if (body.append === true) {
    const { count } = await db.from('work_queue').select('id', { count: 'exact', head: true }).eq('lane_id', lane.id)
    if ((count ?? 0) + reportIds.length > QUEUE_MAX) return err(c, 'QUEUE_FULL', `A lane holds at most ${QUEUE_MAX} queued reports.`, 409)
    const q = await enqueueReports(db, ref, reportIds, { source: 'console', addedBy: userId, now })
    if ('error' in q) return err(c, 'DB_ERROR', 'The reports could not be queued.', 500)
  } else {
    // Replace: the list is the queue, in this order.
    const { data: current, error } = await db.from('work_queue').select('report_id').eq('lane_id', lane.id)
    if (error) return err(c, 'DB_ERROR', 'Could not read the queue.', 500)
    const drop = ((current ?? []) as Array<{ report_id: string }>).map((r) => r.report_id).filter((id) => !reportIds.includes(id))
    if (drop.length) await db.from('work_queue').delete().eq('lane_id', lane.id).in('report_id', drop)
    if (reportIds.length) {
      const { error: upErr } = await db.from('work_queue').upsert(
        reportIds.map((reportId, position) => ({ lane_id: lane.id, project_id: lane.project_id, report_id: reportId, position, source: 'console', added_by: userId })),
        { onConflict: 'lane_id,report_id' },
      )
      if (upErr) return err(c, 'DB_ERROR', 'The queue could not be saved.', 500)
    }
  }
  await deps.logAudit(db, lane.project_id, userId, 'settings.updated', 'work_queue', lane.id, { lane: lane.name, append: body.append === true, reports: reportIds.length }).catch(() => {})
  const { data: rows } = await db.from('work_queue').select('report_id, position').eq('lane_id', lane.id).order('position', { ascending: true }).order('created_at', { ascending: true })
  return c.json({ ok: true, data: { laneId: lane.id, reportIds: ((rows ?? []) as Array<{ report_id: string }>).map((r) => r.report_id) } })
}

/** A host the console caller owns. */
async function ownedHost(c: Ctx, db: Db, hostId: string): Promise<HostRow | Refusal> {
  if (!UUID_RE.test(hostId)) return new Refusal(err(c, 'VALIDATION_ERROR', 'host id must be a uuid.', 400))
  const { data, error } = await db.from('work_hosts').select(HOST_COLUMNS).eq('id', hostId).maybeSingle()
  if (error) return new Refusal(err(c, 'DB_ERROR', 'Could not read the worker.', 500))
  if (!data || (data as HostRow).owner_user_id !== (c.get('userId') as string)) return new Refusal(err(c, 'NOT_FOUND', 'Worker not found (only its owner changes it).', 404))
  return data as HostRow
}

async function patchHost(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const parsed = parseHostGuards(await c.req.json().catch(() => null), { partial: true })
  if (!parsed.ok) return err(c, 'VALIDATION_ERROR', parsed.message, 400)
  const host = await ownedHost(c, db, c.req.param('id') ?? '')
  if (host instanceof Refusal) return host.response
  const guards = { ...hostGuardsFrom(host.guards), ...parsed.value }
  const { error } = await db.from('work_hosts').update({ guards, updated_at: deps.now().toISOString() }).eq('id', host.id)
  if (error) return err(c, 'DB_ERROR', 'The worker could not be changed.', 500)
  return c.json({ ok: true, data: { id: host.id, guards } })
}

async function deleteHost(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const now = deps.now().toISOString()
  const host = await ownedHost(c, db, c.req.param('id') ?? '')
  if (host instanceof Refusal) return host.response
  const { error } = await db.from('work_hosts').update({ revoked_at: now, updated_at: now }).eq('id', host.id)
  if (error) return err(c, 'DB_ERROR', 'The worker could not be revoked.', 500)
  // Its key goes too: it was minted for this worker, and a revoked host must
  // not come back by registering again with the same key.
  await db.from('project_api_keys').update({ is_active: false, revoked_at: now }).eq('id', host.api_key_id).eq('owner_user_id', host.owner_user_id)
  return c.json({ ok: true, data: { id: host.id, revoked: true } })
}

/**
 * Mint a worker:run account key limited to `projectIds`. Every project must be
 * one the caller can already reach as a non-viewer: a project-bound key can
 * name only its own project, an account key only projects in its own limit.
 */
async function mintWorkerKey(c: Ctx, deps: WorkRouteDeps): Promise<Response> {
  const db = deps.getServiceClient()
  const userId = c.get('userId') as string
  const body = (await c.req.json().catch(() => ({}))) as { projectIds?: unknown; label?: unknown }
  const projectIds = Array.isArray(body.projectIds) ? [...new Set(body.projectIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).map((x) => x.toLowerCase()))] : []
  if (projectIds.length === 0 || projectIds.length > 50) return err(c, 'VALIDATION_ERROR', 'projectIds must list 1 to 50 app ids the worker may serve.', 400)
  for (const projectId of projectIds) {
    const access = await deps.access(c, db, userId, projectId)
    if (!access.allowed) return err(c, 'FORBIDDEN', `This caller cannot reach app ${projectId}, so a worker key for it cannot be made here.`, 403)
    if (access.role === 'viewer') return err(c, 'FORBIDDEN', `Viewers cannot run fixes, so a worker key for app ${projectId} cannot be made.`, 403)
  }
  const rate = await deps.claimRateLimit(db, `user:${userId}:worker_key_mint`, WORKER_KEY_MINTS_PER_HOUR, 3600)
  if (!rate.allowed) return err(c, 'RATE_LIMITED', `At most ${WORKER_KEY_MINTS_PER_HOUR} worker keys an hour.`, 429)
  const raw = typeof body.label === 'string' ? body.label.trim() : ''
  const label = `worker:${(raw.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'host').slice(0, 48)}`
  const key = `mushi_${crypto.randomUUID().replace(/-/g, '')}`
  const prefix = key.slice(0, 12)
  const { data, error } = await db
    .from('project_api_keys')
    .insert({
      key_hash: await hashApiKey(key),
      key_prefix: prefix,
      label,
      scopes: [...WORKER_KEY_SCOPES],
      is_active: true,
      is_org_scoped: true,
      owner_user_id: userId,
      allowed_project_ids: projectIds,
    })
    .select('id')
    .single()
  if (error) {
    wlog.error('worker key mint failed', { err: error.message })
    return err(c, 'DB_ERROR', 'The worker key could not be created.', 500)
  }
  const id = (data as { id?: string } | null)?.id ?? undefined
  for (const projectId of projectIds) {
    void deps.logAudit(db, projectId, userId, 'api_key.created', 'project_api_key', id, { source: 'worker_key', scopes: [...WORKER_KEY_SCOPES], key_prefix: prefix, label, projects: projectIds.length }, { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' }).catch(() => {})
  }
  // Shown once; Mushi keeps only its hash.
  return c.json({ ok: true, data: { id, key, prefix, scopes: [...WORKER_KEY_SCOPES], label, projectIds } }, 201)
}

export function registerWorkRoutes(app: Hono<{ Variables: Variables }>, deps: WorkRouteDeps = defaultWorkRouteDeps): void {
  app.post('/v1/worker/heartbeat', deps.workerAuth, (c) => heartbeat(c as Ctx, deps))
  app.post('/v1/worker/claim', deps.workerAuth, (c) => claim(c as Ctx, deps))
  app.post('/v1/worker/claims/:id/renew', deps.workerAuth, (c) => renew(c as Ctx, deps))
  app.post('/v1/worker/claims/:id/done', deps.workerAuth, (c) => done(c as Ctx, deps))
  app.post('/v1/worker/claims/:id/findings', deps.workerAuth, (c) => finding(c as Ctx, deps))
  app.post('/v1/worker/revoke', deps.workerAuth, (c) => revokeSelf(c as Ctx, deps))

  app.get('/v1/admin/work/lanes', deps.adminOrApiKeyRead, (c) => listLanes(c as Ctx, deps))
  app.patch('/v1/admin/work/lanes/:id', deps.jwtAuth, (c) => patchLane(c as Ctx, deps))
  app.put('/v1/admin/work/lanes/:id/queue', deps.jwtAuth, (c) => putQueue(c as Ctx, deps))
  app.patch('/v1/admin/work/hosts/:id', deps.jwtAuth, (c) => patchHost(c as Ctx, deps))
  app.delete('/v1/admin/work/hosts/:id', deps.jwtAuth, (c) => deleteHost(c as Ctx, deps))
  app.post('/v1/admin/work/key', deps.adminOrApiKeyWrite, (c) => mintWorkerKey(c as Ctx, deps))
}
