/**
 * FILE: packages/server/supabase/functions/api/routes/work-heartbeat.ts
 * PURPOSE: POST /v1/worker/heartbeat on its own (local workers, ADR 0048), so
 *          both `api` and `api-ext` serve it from one handler.
 *
 *   POST /v1/worker/heartbeat            register the host and its lanes, renew leases;
 *                                        answers each lane's closed settings and the host guards
 *
 * Why its own file: every `mushi work --daemon` sends this once a minute. When
 * `api` forwarded /v1/worker/* to `api-ext` (_shared/edge-proxy.ts), each
 * heartbeat cost two edge invocations. `api` is at Supabase's deploy size
 * limit, so it imports this module instead of the whole work route group
 * (work.ts); the rest of /v1/worker/* is still forwarded. work.ts registers
 * the same route for clients that call `api-ext` directly, and shares the row
 * types and helpers below.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { WORK_LEASE_MS } from '../../_shared/work-claims.ts'
import { lanesToWake } from './work-fresh-eyes.ts'
import { hostGuardsFrom, laneConfigFromRow, laneWriteNeeded, parseHeartbeat, type LaneConfig } from '../../_shared/work-lanes.ts'
import { callerCanAccessProject } from '../shared.ts'
import { mergeCursorLoginReport, parseStoredCursorLogin, pendingCursorLogin, type CursorLoginReport } from '../../_shared/cursor-login.ts'

type Db = ReturnType<typeof getServiceClient>
type Ctx = Context<{ Variables: Variables }>
type Role = 'owner' | 'admin' | 'member' | 'viewer' | null

const HEARTBEATS_PER_MINUTE = 10

/** A new lane's settings until the console changes them (the machine may propose some on first registration). */
const NEW_LANE_DEFAULTS: LaneConfig = { paused: false, concurrency: 1, model: null, mode: 'fix', stop_at: null, drain: false, prune_own: false }

export function err(c: Ctx, code: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503) {
  return c.json({ ok: false, error: { code, message } }, status)
}

/** /v1/worker/* take only a worker:run API key: a console session or an mcp key never drives a lane. */
export function workerOnly(c: Ctx): Response | null {
  const scopes = (c.get('apiKeyScopes') as string[] | undefined) ?? []
  if (c.get('authMethod') !== 'apiKey' || !scopes.includes('worker:run')) {
    return err(c, 'WORKER_KEY_REQUIRED', 'Only a local worker key (scope worker:run) reaches this route. Create one with `mushi worker install`.', 403)
  }
  return null
}

export interface HostRow {
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
  /** Claim kinds beyond its lanes' modes the daemon runs (fresh_eyes). */
  takes: string[] | null
}

export interface LaneRow {
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
  /** The drain floor (MinSeverity); server-only, never in the heartbeat answer. */
  min_severity: string | null
  repo: string | null
  status: Record<string, unknown> | null
  last_seen_at: string
}

export const HOST_COLUMNS = 'id, owner_user_id, api_key_id, host_id, hostname, platform, mushi_version, last_heartbeat_at, status, guards, revoked_at, takes'
export const LANE_COLUMNS = 'id, host_id, project_id, name, model, mode, concurrency, paused, stop_at, drain, prune_own, review_model, min_severity, repo, status, last_seen_at'

/** What the heartbeat needs; WorkRouteDeps (work.ts) is a superset. */
export interface WorkerHeartbeatDeps {
  getServiceClient: () => Db
  /** A worker:run key (JWTs fall through and are refused in workerOnly). */
  workerAuth: MiddlewareHandler
  access: (c: Ctx, db: Db, userId: string, projectId: string) => Promise<{ allowed: boolean; role: Role }>
  claimRateLimit: (db: Db, key: string, limit: number, windowSec: number) => Promise<{ allowed: boolean; retryAfterSec?: number }>
  now: () => Date
}

export const defaultWorkerHeartbeatDeps: WorkerHeartbeatDeps = {
  getServiceClient,
  workerAuth: adminOrApiKey({ scope: 'worker:run' }) as MiddlewareHandler,
  access: (c, db, userId, projectId) => callerCanAccessProject(c, db, userId, projectId),
  claimRateLimit: (db, key, limit, windowSec) => claimTenantRateLimit(db, key, limit, windowSec),
  now: () => new Date(),
}

export function registerWorkerHeartbeatRoute(app: Hono<{ Variables: Variables }>, deps: WorkerHeartbeatDeps = defaultWorkerHeartbeatDeps): void {
  app.post('/v1/worker/heartbeat', deps.workerAuth, (c) => heartbeat(c as Ctx, deps))
}

async function heartbeat(c: Ctx, deps: WorkerHeartbeatDeps): Promise<Response> {
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
    takes: hb.host.takes,
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
  // One access check per app, not per lane: a machine runs many lanes on a
  // few apps, and each check is several membership reads.
  const accessByProject = new Map<string, ReturnType<typeof deps.access>>()
  for (const l of hb.lanes) {
    if (!accessByProject.has(l.projectId)) accessByProject.set(l.projectId, deps.access(c, db, userId, l.projectId))
    const access = await accessByProject.get(l.projectId)!
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
    if (prev && !laneWriteNeeded(prev, { status: l.status as Record<string, unknown> | null, repo: l.repo ?? null }, now)) {
      // Idle and unchanged: the stored row is still true.
      row = prev
    } else if (prev) {
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
  // Lanes whose app has a first-time user test waiting ask for work now
  // instead of after their idle wait. Lane ids only: never a command.
  // The three reads are independent (ux_runs; two separate work_hosts
  // columns), so they run together: one round trip of latency, not three.
  const [wake, recheckAccount, account] = await Promise.all([
    lanesToWake(db, lanes, hb.host.takes.includes('fresh_eyes'), now),
    recheckAsked(db, host.id, hb.status, now),
    syncCursorLogin(db, host.id, hb.cursorLogin, now),
  ])
  return c.json({
    ok: true,
    // recheckAccount, cursorAccount and cursorLogin are new top-level fields: daemons that predate them ignore them (worker/protocol.ts).
    data: { hostId: host.id, heartbeatSeconds: 60, guards: hostGuardsFrom(host.guards), lanes, refused, renewed, lost, wake, recheckAccount, ...account },
  })
}

/**
 * The Cursor account the console set for this machine, and the sign-in it
 * asked for (ADR 0048 amendment 2026-10-28): stores what the machine reports
 * about that sign-in, then answers with the open request, if any. Read on its
 * own: before migration 20261028150000_worker_cursor_account the columns are
 * missing, and that must never fail a heartbeat.
 */
async function syncCursorLogin(db: Db, hostId: string, report: CursorLoginReport | null, now: Date): Promise<{ cursorAccount: string | null; cursorLogin: { requestId: string } | null }> {
  const { data, error } = await db.from('work_hosts').select('cursor_account, cursor_login').eq('id', hostId).maybeSingle()
  if (error || !data) return { cursorAccount: null, cursorLogin: null }
  const row = data as { cursor_account: string | null; cursor_login: unknown }
  const stored = parseStoredCursorLogin(row.cursor_login)
  const merged = mergeCursorLoginReport(stored, report, now)
  if (merged && JSON.stringify(merged) !== JSON.stringify(stored)) {
    await db.from('work_hosts').update({ cursor_login: merged }).eq('id', hostId)
  }
  return { cursorAccount: row.cursor_account ?? null, cursorLogin: pendingCursorLogin(merged, now) }
}

/** How long a "Re-check the account" request stays open for a machine that has not run the check yet. */
const RECHECK_OPEN_MS = 30 * 60_000

/**
 * True when someone asked for a new Cursor account check (POST
 * /v1/admin/work/hosts/:id/recheck) after the machine's last one. Read on its
 * own: before migration 20261028120000_worker_recheck the column is missing,
 * and that must never fail a heartbeat.
 */
async function recheckAsked(db: Db, hostId: string, status: Record<string, unknown>, now: Date): Promise<boolean> {
  const { data, error } = await db.from('work_hosts').select('recheck_requested_at').eq('id', hostId).maybeSingle()
  const at = error ? null : ((data as { recheck_requested_at?: string | null } | null)?.recheck_requested_at ?? null)
  const asked = at ? Date.parse(at) : NaN
  if (!Number.isFinite(asked) || now.getTime() - asked > RECHECK_OPEN_MS) return false
  const age = (status.checks as { cursor?: { ageSec?: number } } | undefined)?.cursor?.ageSec
  return typeof age !== 'number' || now.getTime() - age * 1000 < asked
}
