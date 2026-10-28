/**
 * FILE: packages/server/supabase/functions/api/routes/work-fresh-eyes.ts
 * PURPOSE: The database side of a local worker running a first-time user test
 *          the console queued (fresh-eyes "Run now", ADR 0053 amendment
 *          2026-10-28), called from api/routes/work.ts (served by `api-ext`):
 *
 *            - which of a heartbeat's lanes should ask for work now (a run
 *              waits for their app), so a click is picked up within a minute;
 *            - the claim: one compare-and-set on the queued ux_runs row, then
 *              synthetic accounts minted for it only when the operator who
 *              queued it owns the claiming machine (no password is stored);
 *            - what the run row says when the claim ends or its lease runs out.
 *
 *          The rules are in _shared/fresh-eyes-queue.ts.
 */

import type { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { accountGrantUsable, freshEyesClaimTarget, FRESH_EYES_QUEUED_TTL_MS, uxRunAfterClaim, type QueuedFreshEyesRow } from '../../_shared/fresh-eyes-queue.ts'
import type { MintResult } from '../../_shared/synthetic-accounts.ts'

type Db = ReturnType<typeof getServiceClient>

const flog = log.child('work-fresh-eyes')

const QUEUED_COLUMNS = 'id, local_run_id, project_id, start_url, goal, sessions_requested, success_text, dry_run, started_at, account_granted_by, account_grant_until'
/** Queued runs one claim looks at. */
const QUEUED_HEAD = 5

export interface FreshEyesClaimDeps {
  /** Mint one synthetic account made by `createdBy` (an operator); injectable for tests. */
  mint: (db: Db, createdBy: string, now: Date) => Promise<MintResult>
  isOperator: (userId: string) => boolean
  selfProjectId: string | null | undefined
}

/** Lane ids among `lanes` whose app has a first-time user test waiting; only for a daemon that runs them. */
export async function lanesToWake(db: Db, lanes: ReadonlyArray<{ id: string; projectId: string }>, takesFreshEyes: boolean, now: Date): Promise<string[]> {
  if (!takesFreshEyes || lanes.length === 0) return []
  const projectIds = [...new Set(lanes.map((l) => l.projectId))]
  const { data, error } = await db
    .from('ux_runs')
    .select('project_id')
    .in('project_id', projectIds)
    .eq('kind', 'fresh_eyes')
    .eq('status', 'queued')
    .gt('started_at', new Date(now.getTime() - FRESH_EYES_QUEUED_TTL_MS).toISOString())
    .limit(50)
  if (error) {
    flog.warn('queued tests unreadable; no lane woken', { err: error.message })
    return []
  }
  const waiting = new Set(((data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))
  return lanes.filter((l) => waiting.has(l.projectId)).map((l) => l.id)
}

export type FreshEyesClaim = {
  claimId: string
  target: ReturnType<typeof freshEyesClaimTarget>
  /** Why the run goes without accounts although it asked for them, for the run row. */
  accountNote: string | null
}

/**
 * Claim the oldest test queued for the lane's app, or null when none waits.
 * The claim row comes first (its unique index settles two lanes racing), then
 * the run moves queued → running only if still queued (a cancel wins).
 */
export async function claimFreshEyes(
  db: Db,
  lane: { id: string; project_id: string },
  host: { id: string; owner_user_id: string },
  now: Date,
  leaseUntil: string,
  deps: FreshEyesClaimDeps,
): Promise<FreshEyesClaim | null> {
  const { data, error } = await db
    .from('ux_runs')
    .select(QUEUED_COLUMNS)
    .eq('project_id', lane.project_id)
    .eq('kind', 'fresh_eyes')
    .eq('status', 'queued')
    .gt('started_at', new Date(now.getTime() - FRESH_EYES_QUEUED_TTL_MS).toISOString())
    .order('started_at', { ascending: true })
    .limit(QUEUED_HEAD)
  if (error) throw new Error(`queued tests read failed: ${error.message}`)
  for (const row of (data ?? []) as QueuedFreshEyesRow[]) {
    const { data: claim, error: claimErr } = await db
      .from('work_claims')
      .insert({ kind: 'fresh_eyes', ux_run_id: row.id, report_id: null, lane_id: lane.id, host_id: host.id, project_id: lane.project_id, status: 'active', lease_until: leaseUntil, claimed_at: now.toISOString() })
      .select('id')
      .single()
    if (claimErr?.code === '23505') continue
    if (claimErr || !claim) throw new Error(`fresh-eyes claim insert failed: ${claimErr?.message ?? 'no row'}`)
    const claimId = (claim as { id: string }).id

    const grant = accountGrantUsable(row, { hostOwnerId: host.owner_user_id, isOperator: deps.isOperator, selfProjectId: deps.selfProjectId, now })
    const grantedBy = row.account_granted_by
    // Moving the run and spending the grant is one compare-and-set: a second
    // claimer, or a cancel, finds it no longer queued.
    const { data: moved } = await db
      .from('ux_runs')
      .update({ status: 'running', claim_id: claimId, detail: null, account_granted_by: null, account_grant_until: null, updated_at: now.toISOString() })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('id')
    if (!moved || (moved as unknown[]).length === 0) {
      await db.from('work_claims').update({ status: 'done', outcome: 'skipped', finished_at: now.toISOString(), updated_at: now.toISOString(), detail: 'The test was cancelled or taken before this worker started it.' }).eq('id', claimId)
      continue
    }

    let accountNote: string | null = null
    const accounts: Array<{ email: string; password: string; name: string; userId: string }> = []
    if (grantedBy && !grant) {
      accountNote = 'It ran without a test account: only a computer of the operator who started it, within 2 hours, may sign up with one.'
    } else if (grant && !row.dry_run) {
      const sessions = row.sessions_requested ?? 3
      for (let i = 0; i < sessions; i++) {
        const minted = await deps.mint(db, grantedBy!, now)
        if (!minted.ok) {
          flog.warn('test account not minted; the run goes on without one', { runId: row.local_run_id, code: minted.code })
          accountNote = `It ran with ${accounts.length} test account(s) of ${sessions}: ${minted.message}`
          break
        }
        accounts.push({ email: minted.account.email, password: minted.account.password, name: minted.account.name, userId: minted.account.userId })
      }
    }
    if (accountNote) await db.from('ux_runs').update({ detail: accountNote, has_account: accounts.length > 0 }).eq('id', row.id)
    return { claimId, target: freshEyesClaimTarget(row, accounts), accountNote }
  }
  return null
}

/** The run row after its claim ended (done, or the lease ran out). Leaves a run the CLI already finished alone. */
export async function endFreshEyesRun(db: Db, uxRunId: string | null, outcome: string, detail: string | null, now: Date): Promise<void> {
  if (!uxRunId) return
  const { data, error } = await db.from('ux_runs').select('status').eq('id', uxRunId).maybeSingle()
  if (error || !data) return
  const patch = uxRunAfterClaim(outcome, detail, (data as { status: string }).status)
  if (!patch) return
  const { error: upErr } = await db
    .from('ux_runs')
    .update({ ...patch, finished_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', uxRunId)
    .in('status', ['queued', 'running'])
  if (upErr) flog.warn('run row not ended', { uxRunId, err: upErr.message })
}
