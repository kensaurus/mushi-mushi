// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * spend-down-worker — Supabase Edge Function (verify_jwt = false, internal)
 *
 * Spend-down mode (ADR 0028). For every Cursor key with spend-down on and
 * inside its window (`_shared/spend-down.ts`), dispatch the highest-value open
 * reports of the apps that key already serves, until the key's daily limit:
 *
 *   - apps: those where this key is resolveCursorApiKey's first pick (ADR
 *     0023: own pool key, then legacy key, then shared key, by priority; a
 *     priority tie counts as not first), with auto-fix on and a linked repo;
 *   - per app: at most 3 cloud agents running, and never past the app's
 *     auto-fix caps (checked here, and again by fix-worker for every
 *     automatic dispatch);
 *   - reports: classified or reopened, not dispatched in the last 7 days,
 *     not held by a local worker's lease (ADR 0048),
 *     and not settled by an agent verdict (latest attempt already_fixed,
 *     wrong_repo, not_actionable or needs_human), ranked by severity × judge
 *     score × named component × 1.3 when the report already has Sentry or
 *     stack evidence, one per group;
 *   - stop-loss (ADR 0028 amendment): from its spend-down runs of the last
 *     14 days (after its last Resume), an app with 20+ samples is paused when
 *     the one-sided 95% Wilson bound puts its Opus merge rate under 20%, its
 *     hold rate over 35%, or its no-PR-verdict share over 50%. A paused app
 *     still gets one probe dispatch a day; it resumes when the rates clear
 *     25% / 30% / 45%, its newest 2 reviewed probes both got "merge", its
 *     samples age out, or someone presses Resume. Each pause and resume is
 *     one structured log line with the rates, bounds and sample sizes;
 *   - each goes through `dispatchFixForReport` (auto-fix switch, feature
 *     requests, resolved reports, in-flight dedupe) as an automatic
 *     `cursor_cloud` dispatch carrying `spend_down_key_id` and the key's model.
 *
 * Nothing merges: the fixes open draft PRs as every dispatch does. The result
 * of each tick is written to `byok_keys.spend_down_last_summary`.
 *
 * Auth: `requireServiceRoleAuth` — invoked by pg_cron `mushi-spend-down`
 * (migration 20261020090056; every 10 minutes, `8-58/10 * * * *`, since 20261020140720).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { checkAutofixBudget, type AutofixBudgetCheck, type AutofixBudgetSettings } from '../_shared/autofix-budget.ts'
import { dispatchFixForReport, type DispatchResult } from '../_shared/dispatch.ts'
import { activeWorkClaims, queuedForLocalLanes } from '../_shared/work-claims.ts'
import {
  SPEND_DOWN_REDISPATCH_COOLDOWN_DAYS,
  SPEND_DOWN_STOP_AUTOFIX_OFF,
  SPEND_DOWN_STOP_NO_REPORT,
  projectCapacity,
  SPEND_DOWN_MAX_OPEN_PER_PROJECT,
  rankSpendDownCandidates,
  reportsWithNoRetryVerdict,
  reportsToRetryAfterKeyLimit,
  reportsToRetryAfterHold,
  remainingToday,
  SPEND_DOWN_CANDIDATE_COLUMNS,
  spendDownCandidateFromReport,
  spendDownDispatchMetadata,
  SPEND_DOWN_PROBES_PER_DAY,
  effectiveStopLossResets,
  spendDownStopLoss,
  spendDownWindow,
  previousPauseStates,
  type SpendDownCandidate,
  type SpendDownEvidenceRow,
  type SpendDownKey,
  type SpendDownState,
} from '../_shared/spend-down.ts'
import {
  cachedYieldSamples,
  claimKeyTick,
  keyDispatchesToday,
  keyProjects,
  stopLossResets,
  writeStopLossReset,
  type SpendDownYieldCache,
} from '../_shared/spend-down-db.ts'
import { ownerUserColumnReady, withOwnerUserColumn } from '../_shared/byok-scope.ts'

const log = rootLog.child('spend-down-worker')

/** owner_user_id is added by withOwnerUserColumn once migration 20261021051628 is applied (ADR 0031). */
export const SPEND_DOWN_KEY_COLUMNS =
  'id, provider_slug, project_id, organization_id, status, credits_expire_at, spend_down_enabled, spend_down_model, spend_down_daily_limit, spend_down_window_days, spend_down_last_summary'

/** The yield the stop-loss read for one app this tick (rates and bounds are 0-1). */
export interface ProjectYield {
  reviewed: number
  mergeRate: number | null
  holdRate: number | null
  mergeUpper: number | null
  holdLower: number | null
  finishedRuns: number
  noPrShare: number | null
  noPrLower: number | null
}

export interface ProjectOutcome {
  projectId: string
  dispatched: number
  /** Why nothing (more) went to this app, when that is the case. */
  stopped?: string
  /** The stop-loss has this app paused; `stopped` says why. */
  paused?: boolean
  /** When the current pause began. */
  pausedAt?: string
  /** This tick's dispatch was the paused app's daily probe. */
  probe?: boolean
  /** Not reached this tick (the key's limit ran out, or the key is out of its window); carried from the last tick. */
  carried?: boolean
  /**
   * The app's stop-loss reset (a probe-driven resume, or the console's
   * Resume), kept every tick so the window stays restarted even before the
   * project_settings column exists.
   */
  stopLossResetAt?: string
  yield?: ProjectYield
}

export interface KeySummary {
  keyId: string
  state: SpendDownState
  dispatchedToday: number
  dispatched: number
  remainingToday: number
  projects: ProjectOutcome[]
  at: string
}

export interface SpendDownDeps {
  now?: Date
  dispatch?: (input: Parameters<typeof dispatchFixForReport>[0]) => Promise<DispatchResult>
  checkBudget?: (
    db: SupabaseClient,
    projectId: string,
    settings: AutofixBudgetSettings,
  ) => Promise<AutofixBudgetCheck>
  /** Shared across keys within one tick: each app's samples are read once. */
  yieldCache?: SpendDownYieldCache
}

/**
 * The last tick's pause and reset state, carried unchanged into this tick's
 * summary for apps it does not evaluate, so nothing is forgotten while a key
 * is out of its window or out of fixes for the day.
 */
function carriedOutcome(previous: unknown): ProjectOutcome | null {
  const p = previous as Partial<ProjectOutcome> | null | undefined
  if (!p || typeof p.projectId !== 'string') return null
  if (p.paused !== true && typeof p.stopLossResetAt !== 'string') return null
  return {
    projectId: p.projectId,
    dispatched: 0,
    ...(p.paused === true ? { paused: true } : {}),
    ...(typeof p.pausedAt === 'string' ? { pausedAt: p.pausedAt } : {}),
    ...(p.paused === true && typeof p.stopped === 'string' ? { stopped: p.stopped } : {}),
    ...(typeof p.stopLossResetAt === 'string' ? { stopLossResetAt: p.stopLossResetAt } : {}),
    carried: true,
  }
}

function previousProjects(summary: unknown): unknown[] {
  const projects = (summary as { projects?: unknown } | null | undefined)?.projects
  return Array.isArray(projects) ? projects : []
}

function utcDayStart(now: Date): string {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

async function candidatesFor(db: SupabaseClient, projectId: string, now: Date): Promise<SpendDownCandidate[]> {
  const { data: reports, error } = await db
    .from('reports')
    .select(`${SPEND_DOWN_CANDIDATE_COLUMNS}, status`)
    .eq('project_id', projectId)
    .in('status', ['classified', 'reopened', 'fixing'])
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw new Error(`spend-down: reports read failed: ${error.message}`)
  const raw = (reports ?? []) as Array<SpendDownCandidate & SpendDownEvidenceRow & { status: string }>
  const fixing = new Set(raw.filter((r) => r.status === 'fixing').map((r) => r.id))
  const rows = raw.map(spendDownCandidateFromReport)
  if (rows.length === 0) return []

  const since = new Date(now.getTime() - SPEND_DOWN_REDISPATCH_COOLDOWN_DAYS * 86_400_000).toISOString()
  const { data: recent, error: recentErr } = await db
    .from('fix_dispatch_jobs')
    .select('report_id')
    .eq('project_id', projectId)
    .in('report_id', rows.map((r) => r.id))
    .gte('created_at', since)
  if (recentErr) throw new Error(`spend-down: recent dispatch read failed: ${recentErr.message}`)
  const recentlyDispatched = new Set(((recent ?? []) as Array<{ report_id: string }>).map((r) => r.report_id))

  const { data: attempts, error: attemptsErr } = await db
    .from('fix_attempts')
    .select('id, report_id, failure_category, error, created_at')
    .eq('project_id', projectId)
    .in('report_id', rows.map((r) => r.id))
  if (attemptsErr) throw new Error(`spend-down: fix attempts read failed: ${attemptsErr.message}`)
  const attemptRows = (attempts ?? []) as Array<{ id: string; report_id: string; failure_category: string | null; error: string | null; created_at: string }>
  const settled = reportsWithNoRetryVerdict(attemptRows)
  // A dispatch the pinned key could not run (usage limit, or the key was
  // already unusable) started no agent: the next tick may send it again.
  const keyLimited = reportsToRetryAfterKeyLimit(attemptRows, now)
  // A report still `fixing` is picked only when its PR was held (with what the
  // held attempt did in the new prompt); an open PR that waits to merge is not.
  const held = await heldRetries(db, attemptRows.filter((a) => fixing.has(a.report_id)), now)
  // A local worker's lease (ADR 0048): its agent is on the report now. An
  // unreadable lease skips this app's reports for this tick.
  const claimed = await activeWorkClaims(db, rows.map((r) => r.id), now)
  if ('error' in claimed) {
    log.warn('spend-down: local worker claims unreadable; skipping the app this tick', { projectId, err: claimed.error })
    return []
  }
  // A report waiting in a local lane's queue is reserved for that machine (a
  // person sent it there, or a skill run's round runs locally, ADR 0042
  // amendment): a cloud agent would race the lane for it.
  const queued = await queuedForLocalLanes(db, rows.map((r) => r.id))
  if ('error' in queued) {
    log.warn('spend-down: local worker queues unreadable; skipping the app this tick', { projectId, err: queued.error })
    return []
  }
  return rankSpendDownCandidates(
    rows.filter((r) =>
      !claimed.ids.has(r.id) &&
      !queued.ids.has(r.id) &&
      (fixing.has(r.id) ? held.has(r.id) : (!recentlyDispatched.has(r.id) || keyLimited.has(r.id)) && !settled.has(r.id)),
    ),
  )
}

/** Reports among these attempts whose newest PR the Opus review held (reportsToRetryAfterHold). */
async function heldRetries(db: SupabaseClient, attempts: Array<{ id: string; report_id: string; created_at: string }>, now: Date): Promise<Set<string>> {
  if (!attempts.length) return new Set()
  const { data, error } = await db
    .from('fix_reviews')
    .select('fix_attempt_id, verdict, completed_at')
    .in('fix_attempt_id', attempts.map((a) => a.id))
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
  if (error) throw new Error(`spend-down: fix reviews read failed: ${error.message}`)
  const latest = new Map<string, string>()
  for (const r of (data ?? []) as Array<{ fix_attempt_id: string; verdict: string }>) {
    if (!latest.has(r.fix_attempt_id)) latest.set(r.fix_attempt_id, r.verdict)
  }
  const heldIds = new Set([...latest].filter(([, v]) => v === 'hold').map(([id]) => id))
  return reportsToRetryAfterHold(attempts, heldIds, now)
}

async function openCloudAttempts(db: SupabaseClient, projectId: string): Promise<number> {
  const { count, error } = await db
    .from('fix_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('agent', 'cursor_cloud')
    .in('status', ['queued', 'running'])
  if (error) throw new Error(`spend-down: open attempts read failed: ${error.message}`)
  return count ?? 0
}

export async function runSpendDownForKey(
  db: SupabaseClient,
  key: SpendDownKey & { spend_down_last_summary?: unknown },
  deps: SpendDownDeps = {},
): Promise<KeySummary> {
  const now = deps.now ?? new Date()
  const dispatch = deps.dispatch ?? dispatchFixForReport
  const yieldCache: SpendDownYieldCache = deps.yieldCache ?? new Map()
  const checkBudget =
    deps.checkBudget ??
    ((d: SupabaseClient, pid: string, s: AutofixBudgetSettings) => checkAutofixBudget(d, pid, s, { trigger: 'automatic' }))
  const window = spendDownWindow(key, now)
  const base = { keyId: key.id, state: window.state, dispatched: 0, projects: [] as ProjectOutcome[], at: now.toISOString() }
  if (window.state !== 'active') {
    // Out of the window or unusable: dispatch nothing, but keep every pause
    // and reset, so the stop-loss picks up where it was if the key returns.
    const carried = previousProjects(key.spend_down_last_summary)
      .map(carriedOutcome)
      .filter((o): o is ProjectOutcome => o != null)
    return { ...base, projects: carried, dispatchedToday: 0, remainingToday: 0 }
  }

  const dispatchedToday = await keyDispatchesToday(db, key.id, now)
  let remaining = remainingToday(key, dispatchedToday)
  const { ids, settings } = await keyProjects(db, key)
  const { resets, error: resetErr } = await stopLossResets(db, ids)
  if (resetErr) {
    log.warn('spend-down stop-loss resets not read (migration not applied?); using the 14-day limit only', {
      keyId: key.id,
      err: resetErr,
    })
  }
  const effective = effectiveStopLossResets(resets, key.spend_down_last_summary)
  const previous = previousPauseStates(key.spend_down_last_summary, effective)
  const dayStart = utcDayStart(now)

  for (const projectId of ids) {
    if (remaining <= 0) break
    const outcome: ProjectOutcome = { projectId, dispatched: 0 }
    base.projects.push(outcome)

    const samples = await cachedYieldSamples(yieldCache, db, projectId, now, effective.get(projectId) ?? null)
    const stopLoss = spendDownStopLoss(samples, previous.get(projectId) ?? { paused: false, pausedAt: null }, now)
    if (stopLoss.resetAt) {
      // A probe-driven resume restarts the window at the resuming probes;
      // otherwise the next tick would read the old window and pause again.
      const err = await writeStopLossReset(db, projectId, stopLoss.resetAt)
      if (err) log.warn('spend-down probe resume not stored on the app; kept in the tick summary', { keyId: key.id, projectId, err })
      effective.set(projectId, stopLoss.resetAt)
    }
    const resetAt = effective.get(projectId)
    if (resetAt) outcome.stopLossResetAt = resetAt
    outcome.yield = {
      reviewed: stopLoss.reviewed,
      mergeRate: stopLoss.mergeRate,
      holdRate: stopLoss.holdRate,
      mergeUpper: stopLoss.mergeUpper,
      holdLower: stopLoss.holdLower,
      finishedRuns: stopLoss.finishedRuns,
      noPrShare: stopLoss.noPrShare,
      noPrLower: stopLoss.noPrLower,
    }
    if (stopLoss.transition) {
      // One line per change of state, never per tick.
      log.info(`spend-down.${stopLoss.transition}`, {
        keyId: key.id,
        projectId,
        ...outcome.yield,
        reason: stopLoss.reason,
        resumedBy: stopLoss.resumedBy,
      })
    }

    let probe = false
    if (stopLoss.paused) {
      outcome.paused = true
      if (stopLoss.pausedAt) outcome.pausedAt = stopLoss.pausedAt
      outcome.stopped = stopLoss.reason ?? 'Paused: low yield'
      // The daily probe: one spend-down dispatch a day (any key), so a paused
      // app keeps producing the evidence that can resume it.
      const today = samples.runs.filter((r) => r.at >= dayStart).length
      if (today >= SPEND_DOWN_PROBES_PER_DAY) continue
      probe = true
    }

    const s = settings.get(projectId) ?? {}
    const budget = await checkBudget(db, projectId, {
      autofix_max_spend_usd: (s.autofix_max_spend_usd as number | null) ?? null,
      autofix_max_dispatches_per_day: (s.autofix_max_dispatches_per_day as number | null) ?? null,
      autofix_approval_cost_threshold_usd: (s.autofix_approval_cost_threshold_usd as number | null) ?? null,
    })
    if (!budget.allowed) {
      if (!probe) outcome.stopped = budget.reason ?? 'Auto-fix cap reached'
      continue
    }
    const capacity = Math.min(
      probe ? SPEND_DOWN_PROBES_PER_DAY : Number.POSITIVE_INFINITY,
      projectCapacity({
        remainingForKey: remaining,
        openCloudAttempts: await openCloudAttempts(db, projectId),
        autofixDispatchesToday: budget.dispatchesToday,
        autofixMaxPerDay: budget.maxDispatchesPerDay,
        maxConcurrent: (s.autofix_max_concurrent as number | null) ?? null,
      }),
    )
    if (capacity <= 0) {
      if (!probe) outcome.stopped = `${(s.autofix_max_concurrent as number | null) ?? SPEND_DOWN_MAX_OPEN_PER_PROJECT} running already (the app's limit)`
      continue
    }
    const candidates = await candidatesFor(db, projectId, now)
    if (candidates.length === 0) {
      if (!probe) outcome.stopped = SPEND_DOWN_STOP_NO_REPORT
      continue
    }
    for (const report of candidates) {
      if (outcome.dispatched >= capacity || remaining <= 0) break
      const res = await dispatch({
        projectId,
        reportId: report.id,
        skipMembershipCheck: true,
        trigger: 'automatic',
        metadata: spendDownDispatchMetadata(key, { probe }),
      })
      if (res.ok) {
        outcome.dispatched++
        base.dispatched++
        remaining--
        if (probe) outcome.probe = true
      } else if (res.code === 'AUTOFIX_DISABLED') {
        if (!probe) outcome.stopped = SPEND_DOWN_STOP_AUTOFIX_OFF
        break
      }
    }
  }

  // Carry forward pauses and resets on apps this tick did not reach (the
  // key's limit ran out first), so the next tick still knows them.
  const reached = new Set(base.projects.map((p) => p.projectId))
  for (const projectId of ids) {
    if (reached.has(projectId)) continue
    const prev = previous.get(projectId)
    const resetAt = effective.get(projectId)
    if (!prev && !resetAt) continue
    base.projects.push({
      projectId,
      dispatched: 0,
      ...(prev ? { paused: true } : {}),
      ...(prev?.pausedAt ? { pausedAt: prev.pausedAt } : {}),
      ...(prev ? { stopped: prev.reason ?? 'Paused: low yield' } : {}),
      ...(resetAt ? { stopLossResetAt: resetAt } : {}),
      carried: true,
    })
  }

  return { ...base, dispatchedToday: dispatchedToday + base.dispatched, remainingToday: remaining }
}

export async function runSpendDown(db: SupabaseClient, deps: SpendDownDeps = {}): Promise<KeySummary[]> {
  const now = deps.now ?? new Date()
  const { data, error } = await db
    .from('byok_keys')
    .select(withOwnerUserColumn(SPEND_DOWN_KEY_COLUMNS, await ownerUserColumnReady(db)))
    .eq('spend_down_enabled', true)
    .eq('provider_slug', 'cursor')
  if (error) throw new Error(`spend-down: keys read failed: ${error.message}`)

  const summaries: KeySummary[] = []
  const yieldCache: SpendDownYieldCache = deps.yieldCache ?? new Map()
  for (const key of (data ?? []) as unknown as Array<SpendDownKey & { spend_down_last_summary?: unknown }>) {
    // One tick per key at a time: an overlapping run would probe twice and
    // spend the daily limit twice.
    const claim = await claimKeyTick(db, key.id, now)
    if (claim === 'busy') {
      log.info('spend-down.key_busy', { keyId: key.id })
      continue
    }
    const release = claim === 'claimed' ? { spend_down_claimed_until: null } : {}
    let summary: KeySummary
    try {
      summary = await runSpendDownForKey(db, key, { ...deps, now, yieldCache })
    } catch (err) {
      log.warn('spend-down tick failed for key (will retry next tick)', {
        keyId: key.id,
        err: err instanceof Error ? err.message : String(err),
      })
      if (claim === 'claimed') await db.from('byok_keys').update(release).eq('id', key.id)
      continue
    }
    summaries.push(summary)
    const { error: writeErr } = await db
      .from('byok_keys')
      .update({ spend_down_last_run_at: now.toISOString(), spend_down_last_summary: summary, ...release })
      .eq('id', key.id)
    if (writeErr) log.warn('spend-down summary not stored', { keyId: key.id, err: writeErr.message })
  }
  log.info('spend-down.done', {
    keys: summaries.length,
    dispatched: summaries.reduce((n, s) => n + s.dispatched, 0),
  })
  return summaries
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }), { status: 405 })
  }
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized
  const summaries = await runSpendDown(getServiceClient())
  return new Response(JSON.stringify({ ok: true, data: { keys: summaries } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('spend-down-worker', handler))
}
