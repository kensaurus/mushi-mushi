/**
 * FILE: packages/server/supabase/functions/inventory-propose/run-budget.ts
 * PURPOSE: How long this invocation may keep asking the model.
 *
 * Until 2026-09-22 the answer was "forever": the hourly drift_watch cron made
 * up to three Sonnet calls per project with no abort signal, outlived the edge
 * runtime's wall clock, and was killed before it could persist the draft. The
 * watchdog saw 5 degraded runs a day; the last proposal to reach the database
 * was 2026-05-04.
 *
 * Env is read lazily and defensively: CI runs `deno test` with no permission
 * flags, so a module-level Deno.env.get() would abort the test file before it
 * ran a single case.
 */

function envNumber(name: string, fallback: number): number {
  try {
    const raw = Deno.env.get(name)
    const value = raw ? Number(raw) : NaN
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

/** Wall clock a single invocation may spend, including every retry. */
export function runBudgetMs(): number {
  return envNumber('MUSHI_INVENTORY_RUN_BUDGET_MS', 110_000)
}

/** Longest a single model call may run, when the budget allows it. */
export function maxAttemptMs(): number {
  return envNumber('MUSHI_INVENTORY_ATTEMPT_MS', 45_000)
}

/** Below this there is no point starting another model call. */
const MIN_ATTEMPT_MS = 15_000

/**
 * How long the next model call may take, or null when the run should stop and
 * keep what it has. Reserves a slice of the remaining time for persisting the
 * draft — a proposal that is computed but never written is the failure this
 * replaces.
 */
export function nextAttemptTimeoutMs(remainingMs: number, reserveMs = 10_000): number | null {
  const usable = Math.min(remainingMs - reserveMs, maxAttemptMs())
  return usable >= MIN_ATTEMPT_MS ? usable : null
}
