/**
 * FILE: packages/server/supabase/functions/_shared/work-claims.ts
 * PURPOSE: The local-worker lease (ADR 0048), as every dispatcher reads it.
 *
 *          `mushi work --daemon` claims a report through POST /v1/worker/claim:
 *          a `work_claims` row, at most one active per report
 *          (uq_work_claims_active_report), 45 min, renewed by the heartbeat.
 *          Until it ends, nothing else may start an agent on that report:
 *          dispatchFixForReport (spend-down, skill-run rounds, Slack, Linear),
 *          spend-down's candidate list, fix-worker just before it starts an
 *          agent, and skill-runs. Before this, only the CLI checked
 *          (`hasLiveAttempt`), so a cloud dispatch and a local lane could both
 *          take one report.
 *
 *          A claim counts while `status = 'active' AND lease_until > now`: a
 *          dead daemon blocks nobody once its lease runs out, even before
 *          anything marks it expired.
 *
 *          Failing the right way: a missing table (42P01, the migration is not
 *          applied yet) means no claim can exist, so callers go on; it is
 *          logged once. Any other read error comes back as an error, and the
 *          caller skips the reports this tick rather than dispatching blind.
 *
 *          Also the claim check for a `worker:run` key on the fix routes in
 *          `api` (POST /v1/admin/fixes, PATCH /v1/admin/fixes/:id, POST
 *          /v1/admin/fixes/:id/review): such a key records fixes only on a
 *          report its own host holds an active claim on. Kept small: `api` is
 *          at Supabase's 5 MB deploy limit.
 */

import type { Context } from 'npm:hono@4'
import type { getServiceClient } from './db.ts'
import { log } from './logger.ts'

type Db = ReturnType<typeof getServiceClient>

/** How long a claim holds without a renewal (the heartbeat renews it every 60 s). */
export const WORK_LEASE_MS = 45 * 60_000

const TABLE_MISSING = '42P01'
const IN_CHUNK = 100
let warnedMissing = false

function missingTable(error: { code?: string } | null | undefined): boolean {
  if (error?.code !== TABLE_MISSING) return false
  if (!warnedMissing) {
    warnedMissing = true
    log.child('work-claims').error('work_claims is missing: apply migration 20261027150000_local_workers; until then no local claim is checked')
  }
  return true
}

/**
 * Report ids among `reportIds` that a local worker holds an active, unexpired
 * claim on. `{ error }` on a failed read: skip those reports this tick.
 */
export async function activeWorkClaims(db: Db, reportIds: readonly string[], now: Date = new Date()): Promise<{ ids: Set<string> } | { error: string }> {
  const ids = new Set<string>()
  const unique = [...new Set(reportIds)]
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from('work_claims')
      .select('report_id')
      .in('report_id', unique.slice(i, i + IN_CHUNK))
      .eq('status', 'active')
      .gt('lease_until', now.toISOString())
    if (error) {
      if (missingTable(error)) return { ids }
      return { error: error.message }
    }
    for (const row of (data ?? []) as Array<{ report_id: string }>) ids.add(row.report_id)
  }
  return { ids }
}

/** One report: held by a local worker right now? `null` on a failed read (treat as held). */
export async function reportHasActiveWorkClaim(db: Db, reportId: string, now: Date = new Date()): Promise<boolean | null> {
  const res = await activeWorkClaims(db, [reportId], now)
  if ('error' in res) return null
  return res.ids.has(reportId)
}

/**
 * True when the request comes with a `worker:run` key that is not also an
 * mcp:write key: such a caller may record fixes only on its own claims.
 */
export function isWorkerOnlyKey(c: Context): boolean {
  if (c.get('authMethod') !== 'apiKey') return false
  const scopes = (c.get('apiKeyScopes') as string[] | undefined) ?? []
  return scopes.includes('worker:run') && !scopes.includes('mcp:write')
}

/**
 * For a worker-only key: a 403 unless one of its own hosts (work_hosts with
 * this api_key_id, not revoked) holds an active, unexpired claim on the
 * report. Null for every other caller, and when the claim is there.
 */
export async function workerClaimDenial(c: Context, db: Db, reportId: string | null | undefined, now: Date = new Date()): Promise<Response | null> {
  if (!isWorkerOnlyKey(c)) return null
  const deny = (message: string, status: 403 | 503 = 403) => c.json({ ok: false, error: { code: 'NO_WORK_CLAIM', message } }, status)
  const keyId = c.get('apiKeyId') as string | undefined
  if (!reportId || !keyId) return deny('A worker key records fixes only on a report it claimed.')
  const { data: claims, error } = await db
    .from('work_claims')
    .select('id, host_id')
    .eq('report_id', reportId)
    .eq('status', 'active')
    .gt('lease_until', now.toISOString())
    .limit(1)
  if (error) return deny('Could not read the worker claim. Try again in a minute.', 503)
  const claim = ((claims ?? []) as Array<{ id: string; host_id: string }>)[0]
  if (!claim) return deny('This worker holds no active claim on that report (claim it with POST /v1/worker/claim first, or the lease ran out).')
  const { data: host, error: hostErr } = await db
    .from('work_hosts')
    .select('id')
    .eq('id', claim.host_id)
    .eq('api_key_id', keyId)
    .is('revoked_at', null)
    .maybeSingle()
  if (hostErr) return deny('Could not read the worker claim. Try again in a minute.', 503)
  if (!host) return deny('Another worker holds the claim on that report.')
  return null
}

/** A lane a caller may put reports into, or why not. */
export type QueueLane = { id: string; projectId: string; hostId: string }

/**
 * The lane `laneId`, when it serves `projectId` and belongs to the caller: its
 * host's owner is `userId`, and for a worker key its host sends that key.
 */
export async function laneForQueue(
  db: Db,
  laneId: string,
  who: { projectId: string; userId: string; apiKeyId?: string | null },
): Promise<{ lane: QueueLane } | { error: string; status: 404 | 503 }> {
  const { data: lane, error } = await db.from('work_lanes').select('id, project_id, host_id').eq('id', laneId).maybeSingle()
  if (error) return missingTable(error) ? { error: 'No local worker is registered yet.', status: 404 } : { error: 'Could not read the lane. Try again in a minute.', status: 503 }
  const row = lane as { id: string; project_id: string; host_id: string } | null
  if (!row || row.project_id !== who.projectId) return { error: 'That lane does not serve this app.', status: 404 }
  let q = db.from('work_hosts').select('id').eq('id', row.host_id).eq('owner_user_id', who.userId).is('revoked_at', null)
  if (who.apiKeyId) q = q.eq('api_key_id', who.apiKeyId)
  const { data: host, error: hostErr } = await q.maybeSingle()
  if (hostErr) return { error: 'Could not read the lane. Try again in a minute.', status: 503 }
  if (!host) return { error: 'That lane is not on one of your workers.', status: 404 }
  return { lane: { id: row.id, projectId: row.project_id, hostId: row.host_id } }
}

/**
 * Queue position: appends take the time in seconds, so a later append runs
 * later without reading the queue; a requeue to the front takes it negated.
 * A console reorder rewrites positions 0..n, which stay before any append.
 */
export function queuePosition(now: Date, front = false): number {
  const s = Math.floor(now.getTime() / 1000)
  return front ? -s : s
}

/** Put reports at the end (or the front) of a lane's queue; one already queued keeps its place. */
export async function enqueueReports(
  db: Db,
  lane: QueueLane,
  reportIds: readonly string[],
  opts: { source: 'console' | 'report_file' | 'requeue' | 'lease_expired'; addedBy?: string | null; front?: boolean; now?: Date },
): Promise<{ queued: number } | { error: string }> {
  const now = opts.now ?? new Date()
  const base = queuePosition(now, opts.front)
  const rows = [...new Set(reportIds)].map((reportId, i) => ({
    lane_id: lane.id,
    project_id: lane.projectId,
    report_id: reportId,
    position: base + i,
    source: opts.source,
    added_by: opts.addedBy ?? null,
  }))
  if (rows.length === 0) return { queued: 0 }
  const { data, error } = await db.from('work_queue').upsert(rows, { onConflict: 'lane_id,report_id', ignoreDuplicates: true }).select('id')
  if (error) return { error: error.message }
  return { queued: ((data ?? []) as unknown[]).length }
}
