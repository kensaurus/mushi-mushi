/**
 * FILE: packages/server/supabase/functions/inventory-propose/run-budget.ts
 * PURPOSE: How long this invocation may keep asking the model.
 *
 * Until 2026-09-22 the answer was "forever": the hourly drift_watch cron made
 * up to three Sonnet calls per project with no abort signal, outlived the edge
 * runtime's wall clock, and was killed before it could persist the draft. The
 * watchdog saw 5 degraded runs a day; the last proposal to reach the database
 * was 2026-05-04.
 */

/** Wall clock a single invocation may spend, including every retry. */
export const RUN_BUDGET_MS = Number(Deno.env.get('MUSHI_INVENTORY_RUN_BUDGET_MS') ?? '110000')
/**
 * Longest a single model call may run, when the budget allows it.
 * @internal exported for run-budget.test.ts
 */
export const MAX_ATTEMPT_MS = Number(Deno.env.get('MUSHI_INVENTORY_ATTEMPT_MS') ?? '45000')
/** Below this there is no point starting another model call. */
const MIN_ATTEMPT_MS = 15_000

/**
 * How long the next model call may take, or null when the run should stop and
 * keep what it has. Reserves a slice of the remaining time for persisting the
 * draft — a proposal that is computed but never written is the failure this
 * replaces.
 */
export function nextAttemptTimeoutMs(remainingMs: number, reserveMs = 10_000): number | null {
  const usable = Math.min(remainingMs - reserveMs, MAX_ATTEMPT_MS)
  return usable >= MIN_ATTEMPT_MS ? usable : null
}
