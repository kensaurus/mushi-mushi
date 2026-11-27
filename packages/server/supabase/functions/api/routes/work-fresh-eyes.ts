/**
 * FILE: packages/server/supabase/functions/api/routes/work-fresh-eyes.ts
 * PURPOSE: The database side of a local worker running a first-time user test
 *          the console queued (fresh-eyes "Run now", ADR 0053 amendment
 *          2026-10-28), called from api/routes/work.ts (served by `api-ext`):
 *
 *            - which of a heartbeat's lanes should ask for work now (a run
 *              waits for their app), so a click is picked up within a minute;
 *            - the claim: one compare-and-set on the queued ux_runs row, then
 *              test accounts made for it only when the owner or admin who
 *              queued it owns the claiming machine and the app has test
 *              accounts on (ADR 0073): in Mushi's own sign-in (`mushi`, an
 *              operator's grant) or from the app's own hook (`hook`); no
 *              password is stored. The persona the run plays goes with it to
 *              a daemon that forwards one;
 *            - what the run row says when the claim ends or its lease runs out,
 *              and the run's reservation and hook accounts settled.
 *
 *          The rules are in _shared/fresh-eyes-queue.ts.
 */

import type { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import {
  accountGrantUsable,
  freshEyesClaimTarget,
  FRESH_EYES_QUEUED_TTL_MS,
  PERSONA_NOT_FORWARDED,
  testAccountMode,
  uxRunAfterClaim,
  type ClaimAccount,
  type QueuedFreshEyesRow,
} from '../../_shared/fresh-eyes-queue.ts'
import { claimPersona, personaFromRow, type ClaimPersona, type PersonaRow } from '../../_shared/personas.ts'
import type { MintResult } from '../../_shared/synthetic-accounts.ts'
import { accountRefs, HOOK_ACCOUNT_RATE_SCOPE, HOOK_ACCOUNT_TTL_HOURS, HOOK_ACCOUNTS_PER_HOUR, type HookAccount } from '../../_shared/test-account-hook.ts'
import { settleFreshEyesRun, type HookAccountInput } from '../../_shared/test-account-hook-io.ts'

type Db = ReturnType<typeof getServiceClient>

const flog = log.child('work-fresh-eyes')

const QUEUED_COLUMNS = 'id, local_run_id, project_id, start_url, goal, sessions_requested, success_text, dry_run, started_at, account_granted_by, account_grant_until, persona_id'
const PERSONA_COLUMNS = 'id, project_id, name, preset, goal, locale, device, expertise, accessibility, patience_steps, cost_cap_usd, notes, created_at, updated_at'
/** Queued runs one claim looks at. */
const QUEUED_HEAD = 5

export interface FreshEyesClaimDeps {
  /** Mint one account in Mushi's own sign-in, made by `createdBy` (an operator); injectable for tests. */
  mint: (db: Db, createdBy: string, now: Date) => Promise<MintResult>
  isOperator: (userId: string) => boolean
  /** One account from the app's own test-account hook; injectable for tests. */
  hookAccount: (db: Db, input: HookAccountInput) => Promise<{ ok: true; account: HookAccount } | { ok: false; message: string }>
}

// Which lanes to wake lives in work-fresh-eyes-wake.ts, so the heartbeat (served by `api`) does not
// pull the claim's account and persona code into api's upload (scripts/deploy-edge-function.test.mjs).
export { lanesToWake } from './work-fresh-eyes-wake.ts'

export type FreshEyesClaim = {
  claimId: string
  target: ReturnType<typeof freshEyesClaimTarget>
  /** Why the run goes without accounts (or its persona) although it asked, for the run row. */
  accountNote: string | null
}

/** The persona a queued run plays, or null (none set, or it cannot be read: the run goes on as a plain visitor). */
async function runPersona(db: Db, row: QueuedFreshEyesRow): Promise<ClaimPersona | null> {
  if (!row.persona_id) return null
  const { data, error } = await db.from('project_personas').select(PERSONA_COLUMNS).eq('id', row.persona_id).eq('project_id', row.project_id).maybeSingle()
  if (error || !data) {
    flog.warn('persona unreadable; the run plays a plain visitor', { runId: row.local_run_id, err: error?.message })
    return null
  }
  return claimPersona(personaFromRow(data as PersonaRow))
}

/**
 * Accounts for the run's visitors, one each, from where the app's setting
 * says. Stops at the first refusal; the note says how many were made.
 */
async function makeAccounts(
  db: Db,
  row: QueuedFreshEyesRow,
  ctx: { mode: 'mushi' | 'hook'; grantedBy: string; persona: ClaimPersona | null; now: Date },
  deps: FreshEyesClaimDeps,
): Promise<{ accounts: ClaimAccount[]; refs: string[]; note: string | null }> {
  const sessions = row.sessions_requested ?? 3
  const accounts: ClaimAccount[] = []
  const hookMade: HookAccount[] = []
  const stop = (why: string) => ({ accounts, refs: accountRefs(hookMade), note: `It ran with ${accounts.length} test account(s) of ${sessions}: ${why}` })
  const expiresAt = new Date(ctx.now.getTime() + HOOK_ACCOUNT_TTL_HOURS * 3_600_000).toISOString()
  for (let i = 0; i < sessions; i++) {
    if (ctx.mode === 'mushi') {
      const minted = await deps.mint(db, ctx.grantedBy, ctx.now)
      if (!minted.ok) {
        flog.warn('test account not minted; the run goes on without one', { runId: row.local_run_id, code: minted.code })
        return stop(minted.message)
      }
      accounts.push({ email: minted.account.email, password: minted.account.password, name: minted.account.name, userId: minted.account.userId })
      continue
    }
    // The app's own hook: at most HOOK_ACCOUNTS_PER_HOUR asks an hour per app, whoever granted them.
    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', { p_user_id: row.project_id, p_scope: HOOK_ACCOUNT_RATE_SCOPE, p_max_per_window: HOOK_ACCOUNTS_PER_HOUR, p_window: '1 hour' })
    if (rateErr) return stop((rateErr.message ?? '').includes('rate_limit_exceeded') ? `at most ${HOOK_ACCOUNTS_PER_HOUR} test accounts an hour per app.` : 'the hourly limit could not be checked.')
    const got = await deps.hookAccount(db, { projectId: row.project_id, runId: row.local_run_id, visitor: i + 1, expiresAt, persona: ctx.persona ? { name: ctx.persona.name, locale: ctx.persona.locale } : null })
    if (!got.ok) {
      flog.warn('hook gave no test account; the run goes on without one', { runId: row.local_run_id, why: got.message })
      return stop(got.message)
    }
    hookMade.push(got.account)
    accounts.push({ email: got.account.email, password: got.account.password, name: got.account.name ?? `Visitor ${i + 1}` })
  }
  return { accounts, refs: accountRefs(hookMade), note: null }
}

/**
 * Claim the oldest test queued for the lane's app, or null when none waits.
 * The claim row comes first (its unique index settles two lanes racing), then
 * the run moves queued → running only if still queued (a cancel wins).
 */
export async function claimFreshEyes(
  db: Db,
  lane: { id: string; project_id: string },
  host: { id: string; owner_user_id: string; takes?: readonly string[] | null },
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

    // The app's test-account setting now, not when the run was queued: turning it off stops a waiting grant.
    let mode = testAccountMode(null)
    if (row.account_granted_by) {
      const { data: settings } = await db.from('project_settings').select('fresh_eyes_accounts').eq('project_id', lane.project_id).maybeSingle()
      mode = testAccountMode((settings as { fresh_eyes_accounts?: unknown } | null)?.fresh_eyes_accounts)
    }
    const grant = accountGrantUsable(row, { hostOwnerId: host.owner_user_id, mode, isOperator: deps.isOperator, now })
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

    const notes: string[] = []
    const wantedPersona = await runPersona(db, row)
    const persona = wantedPersona && (host.takes ?? []).includes('fresh_eyes_persona') ? wantedPersona : null
    if (wantedPersona && !persona) notes.push(PERSONA_NOT_FORWARDED)

    let accounts: ClaimAccount[] = []
    if (grantedBy && !grant) {
      notes.push('It ran without a test account: only a computer of the person who started it, within 2 hours, while the app has test accounts on, may sign up with one.')
    } else if (grant && grantedBy && !row.dry_run && (mode === 'mushi' || mode === 'hook')) {
      const made = await makeAccounts(db, row, { mode, grantedBy, persona: wantedPersona, now }, deps)
      accounts = made.accounts
      if (made.note) notes.push(made.note)
      if (made.refs.length) await db.from('ux_runs').update({ account_refs: made.refs }).eq('id', row.id)
    }
    const accountNote = notes.length ? notes.join(' ') : null
    if (accountNote) await db.from('ux_runs').update({ detail: accountNote, has_account: accounts.length > 0 }).eq('id', row.id)
    return { claimId, target: freshEyesClaimTarget(row, accounts, persona), accountNote }
  }
  return null
}

/** The run row after its claim ended (done, or the lease ran out). Leaves a run the CLI already finished alone. */
export async function endFreshEyesRun(db: Db, uxRunId: string | null, outcome: string, detail: string | null, now: Date, settle: typeof settleFreshEyesRun = settleFreshEyesRun): Promise<void> {
  if (!uxRunId) return
  const { data, error } = await db.from('ux_runs').select('status, project_id, local_run_id').eq('id', uxRunId).maybeSingle()
  if (error || !data) return
  const run = data as { status: string; project_id: string; local_run_id: string }
  const patch = uxRunAfterClaim(outcome, detail, run.status)
  if (patch) {
    const { error: upErr } = await db
      .from('ux_runs')
      .update({ ...patch, finished_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('id', uxRunId)
      .in('status', ['queued', 'running'])
    if (upErr) flog.warn('run row not ended', { uxRunId, err: upErr.message })
  }
  // However it ended, the claim's end settles the run: idempotent, so a run the CLI already settled costs one no-op.
  await settle(db, { id: uxRunId, project_id: run.project_id, local_run_id: run.local_run_id })
}
