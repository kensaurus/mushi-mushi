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
  /** Dispatches created today (UTC), excluding skipped ones (always computed). */
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
  opts: { severity?: string | null; estimatedCostUsd?: number; trigger: DispatchTrigger },
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
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .gte('created_at', dayStart.toISOString())
      .neq('status', 'skipped'),
  ])
  // A failed read used to count as $0 / 0 dispatches, which let every
  // dispatch through behind a cap the owner believed was on.
  if (spendRes.error) throw new AutofixBudgetUnavailableError('30-day spend', spendRes.error.message)
  if (countRes.error) throw new AutofixBudgetUnavailableError('dispatches today', countRes.error.message)

  const spendUsd30d = (spendRes.data ?? []).reduce(
    (s: number, r: { cost_usd: unknown }) => s + (Number(r.cost_usd) || 0),
    0,
  )
  const dispatchesToday = countRes.count ?? 0

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
 * Validate a caps update. Each field may be a positive number or null
 * (no cap); an absent field is left unchanged.
 */
export function parseAutofixCapsBody(
  body: unknown,
): { ok: true; patch: Record<string, number | null> } | { ok: false; message: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const patch: Record<string, number | null> = {}
  if ('maxSpendUsd' in b) {
    const v = b.maxSpendUsd
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100_000)) {
      return { ok: false, message: 'maxSpendUsd must be a positive number of dollars, or null for no cap' }
    }
    patch.autofix_max_spend_usd = v as number | null
  }
  if ('maxDispatchesPerDay' in b) {
    const v = b.maxDispatchesPerDay
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 1_000)) {
      return { ok: false, message: 'maxDispatchesPerDay must be a whole number from 1 to 1000, or null for no cap' }
    }
    patch.autofix_max_dispatches_per_day = v as number | null
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'Send maxSpendUsd and/or maxDispatchesPerDay' }
  }
  return { ok: true, patch }
}
