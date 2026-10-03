import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface AutofixBudgetSettings {
  autofix_max_spend_usd: number | null
  autofix_max_dispatches_per_day: number | null
  autofix_approval_cost_threshold_usd: number | null
}

/**
 * Who started a dispatch. The auto-fix caps exist to stop Mushi spending on
 * its own; a human pressing "Dispatch" in the console, CLI, MCP, Slack, a
 * voice confirmation or a Linear delegation has already decided to spend.
 *
 * Stored in `fix_dispatch_jobs.dispatch_metadata.trigger`. Anything that is
 * not explicitly 'manual' is treated as automatic, so a path that forgets to
 * label itself is capped rather than silently uncapped.
 */
export type DispatchTrigger = 'manual' | 'automatic'

export function dispatchTrigger(meta: unknown): DispatchTrigger {
  const trigger = (meta as { trigger?: unknown } | null | undefined)?.trigger
  return trigger === 'manual' ? 'manual' : 'automatic'
}

/**
 * True for a child job queued by fix-worker's cross-repo fan-out. Such a job
 * never fans out again: it would queue a job for the original repo, which
 * would fan out again, forever.
 *
 * A person who picks a repo (POST /v1/admin/fixes/dispatch `targetRepoId`)
 * means that repo only, so a targeted job never fans out either. The console
 * sends `targetRepoId` only for a non-primary choice; picking the primary
 * keeps the normal fan-out.
 */
export function isSiblingDispatch(dispatch: {
  coordination_id?: string | null
  dispatch_metadata?: unknown
}): boolean {
  if (dispatch.coordination_id) return true
  const meta = (dispatch.dispatch_metadata as Record<string, unknown> | null) ?? {}
  return typeof meta.target_repo_id === 'string'
}

export interface AutofixBudgetCheck {
  allowed: boolean
  reason?: string
  requiresApproval?: boolean
  trigger: DispatchTrigger
  /** fix-worker LLM spend over the last 30 days (always computed). */
  spendUsd30d: number
  /** Prior automatic dispatches today (UTC), not counting skipped ones or the one being checked. */
  dispatchesToday: number
  maxSpendUsd: number | null
  maxDispatchesPerDay: number | null
  /** True when a cap is reached. A manual dispatch proceeds anyway and says so. */
  capExceeded: boolean
}

/** A budget read failed. Thrown instead of reading the failure as "$0 spent". */
export class AutofixBudgetUnavailableError extends Error {
  constructor(what: string, detail: string) {
    super(`Auto-fix budget could not be checked (${what}): ${detail}`)
    this.name = 'AutofixBudgetUnavailableError'
  }
}

export async function checkAutofixBudget(
  db: SupabaseClient,
  projectId: string,
  settings: AutofixBudgetSettings,
  opts: {
    severity?: string | null
    estimatedCostUsd?: number
    trigger: DispatchTrigger
    /**
     * The dispatch being checked. It is already a row in fix_dispatch_jobs,
     * so it is left out of the count: a cap of 3 allows 3 dispatches.
     */
    excludeDispatchId?: string
  },
): Promise<AutofixBudgetCheck> {
  const maxSpend = settings.autofix_max_spend_usd
  const maxDaily = settings.autofix_max_dispatches_per_day
  const approvalThreshold = settings.autofix_approval_cost_threshold_usd

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)

  const [spendRes, countRes] = await Promise.all([
    db
      .from('llm_invocations')
      .select('cost_usd')
      .eq('project_id', projectId)
      .gte('created_at', since)
      .eq('function_name', 'fix-worker'),
    db
      .from('fix_dispatch_jobs')
      .select('id, status, dispatch_metadata')
      .eq('project_id', projectId)
      .gte('created_at', dayStart.toISOString())
      .limit(1000),
  ])
  // A failed read used to count as $0 / 0 dispatches, which let every
  // dispatch through behind a cap the owner believed was on.
  if (spendRes.error) throw new AutofixBudgetUnavailableError('30-day spend', spendRes.error.message)
  if (countRes.error) throw new AutofixBudgetUnavailableError('dispatches today', countRes.error.message)

  const spendUsd30d = (spendRes.data ?? []).reduce(
    (s: number, r: { cost_usd: unknown }) => s + (Number(r.cost_usd) || 0),
    0,
  )
  // Prior AUTOMATIC dispatches today (UTC). Skipped ones never ran, a
  // person's manual dispatches are not what the cap bounds, and the dispatch
  // being checked is not "prior". Sibling fan-out jobs are automatic rows of
  // the same project, so they count against the parent project's cap.
  const dispatchesToday = ((countRes.data ?? []) as Array<{ id: string; status: string; dispatch_metadata: unknown }>)
    .filter((r) =>
      r.id !== opts.excludeDispatchId &&
      r.status !== 'skipped' &&
      dispatchTrigger(r.dispatch_metadata) === 'automatic')
    .length

  const spendReached = maxSpend != null && spendUsd30d >= maxSpend
  const dailyReached = maxDaily != null && dispatchesToday >= maxDaily
  const base = {
    trigger: opts.trigger,
    spendUsd30d,
    dispatchesToday,
    maxSpendUsd: maxSpend,
    maxDispatchesPerDay: maxDaily,
    capExceeded: spendReached || dailyReached,
  }

  // The approval threshold is the owner's own guard on expensive
  // high-severity fixes and applies to every dispatch, manual or not.
  const est = opts.estimatedCostUsd ?? 0
  const sev = (opts.severity ?? '').toLowerCase()
  const requiresApproval =
    approvalThreshold != null &&
    est >= approvalThreshold &&
    (sev === 'high' || sev === 'critical')

  // A human asked for this fix: the spend and daily caps bound only the
  // dispatches Mushi starts on its own.
  if (opts.trigger === 'manual') {
    return { ...base, allowed: true, requiresApproval }
  }

  if (spendReached) {
    return {
      ...base,
      allowed: false,
      reason: `Auto-fix spend ceiling reached ($${spendUsd30d.toFixed(2)} / $${maxSpend!.toFixed(2)} per 30d).`,
    }
  }
  if (dailyReached) {
    return {
      ...base,
      allowed: false,
      reason: `Daily auto-fix dispatch quota reached (${dispatchesToday}/${maxDaily}).`,
    }
  }

  return { ...base, allowed: true, requiresApproval }
}

/** Snapshot stored on the dispatch row so the fix timeline can show it. */
export function budgetSnapshot(check: AutofixBudgetCheck): Record<string, unknown> {
  return {
    trigger: check.trigger,
    spend_usd_30d: Math.round(check.spendUsd30d * 10_000) / 10_000,
    dispatches_today: check.dispatchesToday,
    max_spend_usd: check.maxSpendUsd,
    max_dispatches_per_day: check.maxDispatchesPerDay,
    cap_exceeded: check.capExceeded,
    checked_at: new Date().toISOString(),
  }
}

/** Suggested caps (owner-approved 2026-10-02); also the column defaults for new projects. */
export const DEFAULT_AUTOFIX_MAX_SPEND_USD = 2
export const DEFAULT_AUTOFIX_MAX_DISPATCHES_PER_DAY = 3

/**
 * The project spend limits the console edits through PATCH /v1/admin/settings.
 * Each is a positive number, or null for "no limit".
 *   autofix_max_spend_usd                 fix-worker LLM spend per 30 days (automatic dispatches)
 *   autofix_max_dispatches_per_day        automatic dispatches per UTC day
 *   autofix_approval_cost_threshold_usd   estimated fix cost that needs approval (high/critical)
 *   monthly_llm_budget_usd                all LLM spend per UTC month (_shared/llm-budget.ts)
 */
export const SPEND_LIMIT_FIELDS = [
  'autofix_max_spend_usd',
  'autofix_max_dispatches_per_day',
  'autofix_approval_cost_threshold_usd',
  'monthly_llm_budget_usd',
] as const

export type SpendLimitField = (typeof SPEND_LIMIT_FIELDS)[number]

export function isSpendLimitField(key: string): key is SpendLimitField {
  return (SPEND_LIMIT_FIELDS as readonly string[]).includes(key)
}

/** Validate one spend-limit value: a positive number (whole for the daily cap) or null. */
export function validateSpendLimit(
  field: SpendLimitField,
  value: unknown,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: `${field} must be a number, or null for no limit` }
  }
  if (field === 'autofix_max_dispatches_per_day') {
    if (!Number.isInteger(value) || value < 1 || value > 1_000) {
      return { ok: false, message: `${field} must be a whole number from 1 to 1000, or null for no limit` }
    }
    return { ok: true, value }
  }
  if (value <= 0 || value > 100_000) {
    return { ok: false, message: `${field} must be more than 0 and at most 100000 dollars, or null for no limit` }
  }
  return { ok: true, value: Math.round(value * 100) / 100 }
}
