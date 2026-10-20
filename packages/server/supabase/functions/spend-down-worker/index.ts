// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
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
 *     and not settled by an agent verdict (latest attempt already_fixed or
 *     wrong_repo), ranked by severity × judge score × named component, one
 *     per group;
 *   - each goes through `dispatchFixForReport` (auto-fix switch, feature
 *     requests, resolved reports, in-flight dedupe) as an automatic
 *     `cursor_cloud` dispatch carrying `spend_down_key_id` and the key's model.
 *
 * Nothing merges: the fixes open draft PRs as every dispatch does. The result
 * of each tick is written to `byok_keys.spend_down_last_summary`.
 *
 * Auth: `requireServiceRoleAuth` — invoked by pg_cron `mushi-spend-down`
 * (migration 20261020090056, schedule `28,58 * * * *`).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { checkAutofixBudget, type AutofixBudgetCheck, type AutofixBudgetSettings } from '../_shared/autofix-budget.ts'
import { dispatchFixForReport, type DispatchResult } from '../_shared/dispatch.ts'
import {
  SPEND_DOWN_REDISPATCH_COOLDOWN_DAYS,
  projectCapacity,
  rankSpendDownCandidates,
  reportsWithNoRetryVerdict,
  remainingToday,
  spendDownDispatchMetadata,
  spendDownWindow,
  type SpendDownCandidate,
  type SpendDownKey,
  type SpendDownState,
} from '../_shared/spend-down.ts'
import { keyDispatchesToday, keyProjects } from '../_shared/spend-down-db.ts'

const log = rootLog.child('spend-down-worker')

export const SPEND_DOWN_KEY_COLUMNS =
  'id, provider_slug, project_id, organization_id, status, credits_expire_at, spend_down_enabled, spend_down_model, spend_down_daily_limit, spend_down_window_days'

export interface ProjectOutcome {
  projectId: string
  dispatched: number
  /** Why nothing (more) went to this app, when that is the case. */
  stopped?: string
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
}

async function candidatesFor(db: SupabaseClient, projectId: string, now: Date): Promise<SpendDownCandidate[]> {
  const { data: reports, error } = await db
    .from('reports')
    .select('id, severity, judge_score, component, report_group_id, created_at')
    .eq('project_id', projectId)
    .in('status', ['classified', 'reopened'])
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw new Error(`spend-down: reports read failed: ${error.message}`)
  const rows = (reports ?? []) as SpendDownCandidate[]
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
    .select('report_id, failure_category, created_at')
    .eq('project_id', projectId)
    .in('report_id', rows.map((r) => r.id))
  if (attemptsErr) throw new Error(`spend-down: fix attempts read failed: ${attemptsErr.message}`)
  const settled = reportsWithNoRetryVerdict(
    (attempts ?? []) as Array<{ report_id: string; failure_category: string | null; created_at: string }>,
  )
  return rankSpendDownCandidates(rows.filter((r) => !recentlyDispatched.has(r.id) && !settled.has(r.id)))
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
  key: SpendDownKey,
  deps: SpendDownDeps = {},
): Promise<KeySummary> {
  const now = deps.now ?? new Date()
  const dispatch = deps.dispatch ?? dispatchFixForReport
  const checkBudget =
    deps.checkBudget ??
    ((d: SupabaseClient, pid: string, s: AutofixBudgetSettings) => checkAutofixBudget(d, pid, s, { trigger: 'automatic' }))
  const window = spendDownWindow(key, now)
  const base = { keyId: key.id, state: window.state, dispatched: 0, projects: [] as ProjectOutcome[], at: now.toISOString() }
  if (window.state !== 'active') return { ...base, dispatchedToday: 0, remainingToday: 0 }

  const dispatchedToday = await keyDispatchesToday(db, key.id, now)
  let remaining = remainingToday(key, dispatchedToday)
  const { ids, settings } = await keyProjects(db, key)

  for (const projectId of ids) {
    if (remaining <= 0) break
    const outcome: ProjectOutcome = { projectId, dispatched: 0 }
    base.projects.push(outcome)
    const s = settings.get(projectId) ?? {}
    const budget = await checkBudget(db, projectId, {
      autofix_max_spend_usd: (s.autofix_max_spend_usd as number | null) ?? null,
      autofix_max_dispatches_per_day: (s.autofix_max_dispatches_per_day as number | null) ?? null,
      autofix_approval_cost_threshold_usd: (s.autofix_approval_cost_threshold_usd as number | null) ?? null,
    })
    if (!budget.allowed) {
      outcome.stopped = budget.reason ?? 'Auto-fix cap reached'
      continue
    }
    const capacity = projectCapacity({
      remainingForKey: remaining,
      openCloudAttempts: await openCloudAttempts(db, projectId),
      autofixDispatchesToday: budget.dispatchesToday,
      autofixMaxPerDay: budget.maxDispatchesPerDay,
    })
    if (capacity <= 0) {
      outcome.stopped = 'Three fixes already running'
      continue
    }
    const candidates = await candidatesFor(db, projectId, now)
    if (candidates.length === 0) {
      outcome.stopped = 'No open report to fix'
      continue
    }
    for (const report of candidates) {
      if (outcome.dispatched >= capacity || remaining <= 0) break
      const res = await dispatch({
        projectId,
        reportId: report.id,
        skipMembershipCheck: true,
        trigger: 'automatic',
        metadata: spendDownDispatchMetadata(key),
      })
      if (res.ok) {
        outcome.dispatched++
        base.dispatched++
        remaining--
      } else if (res.code === 'AUTOFIX_DISABLED') {
        outcome.stopped = 'Auto-fix is off'
        break
      }
    }
  }

  return { ...base, dispatchedToday: dispatchedToday + base.dispatched, remainingToday: remaining }
}

export async function runSpendDown(db: SupabaseClient, deps: SpendDownDeps = {}): Promise<KeySummary[]> {
  const now = deps.now ?? new Date()
  const { data, error } = await db
    .from('byok_keys')
    .select(SPEND_DOWN_KEY_COLUMNS)
    .eq('spend_down_enabled', true)
    .eq('provider_slug', 'cursor')
  if (error) throw new Error(`spend-down: keys read failed: ${error.message}`)

  const summaries: KeySummary[] = []
  for (const key of (data ?? []) as SpendDownKey[]) {
    let summary: KeySummary
    try {
      summary = await runSpendDownForKey(db, key, { ...deps, now })
    } catch (err) {
      log.warn('spend-down tick failed for key (will retry next tick)', {
        keyId: key.id,
        err: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    summaries.push(summary)
    const { error: writeErr } = await db
      .from('byok_keys')
      .update({ spend_down_last_run_at: now.toISOString(), spend_down_last_summary: summary })
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
