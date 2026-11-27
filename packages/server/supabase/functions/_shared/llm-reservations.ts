/**
 * FILE: packages/server/supabase/functions/_shared/llm-reservations.ts
 * PURPOSE: A UX run reserves its LLM budget before it starts and releases what
 *          it did not use (ADR 0073, Plan 025 P3). Before this, the monthly
 *          budget (llm-budget.ts) was checked call by call, so two big runs
 *          could start on the last dollars and both run past the budget, and
 *          one run had no cap of its own.
 *
 *          What Mushi pays for, per run kind (the reservation's size):
 *            - scorecard (browser or native captures scored on the server):
 *              one model call per page plus one grouping call;
 *            - fresh_eyes: the visitor model is the user's own Cursor CLI, so
 *              Mushi pays only to classify the reports the run files (at most
 *              FRESH_EYES_FILE_CAP).
 *          The estimate is capped by the persona's cost cap, which is then the
 *          run's hard cap: each call charges its estimate and a call that does
 *          not fit is refused. Actual priced spend stays in llm_invocations,
 *          where the Costs page reads it; reservations deal in estimates only.
 *
 *          Rules:
 *            - a run starts only if the monthly budget minus this month's spend
 *              minus every other open reservation covers its reservation (the
 *              RPC serializes this per project); no monthly budget: the run's
 *              own cap still holds;
 *            - a failed budget read refuses the start (503): a cap that cannot
 *              be read is not a cap;
 *            - done, failed, cancelled, expired-in-queue and lost-lease runs
 *              release; an open reservation stops counting at expires_at.
 *
 *          assertLlmBudget (the triage hot path) is unchanged: reservations
 *          gate starting a run, not every call of every feature.
 *
 * Pure apart from the injected client; no Deno globals.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { readLlmBudgetState, type LlmBudgetState } from './llm-budget.ts'

/** One server-scored page (a Sonnet call with two screenshots), estimated high. */
export const UX_SCORE_CALL_RESERVE_USD = 0.05
/** The cross-page grouping call. */
export const UX_GROUP_CALL_RESERVE_USD = 0.08
/** Classifying one report a fresh-eyes run files. */
export const FRESH_EYES_FILE_RESERVE_USD = 0.02
/** Reports a fresh-eyes run may file (fresh-eyes.ts FRESH_EYES_FILE_CAP). */
const FRESH_EYES_FILES_MAX = 15
/** The smallest reservation worth holding. */
export const RESERVATION_MIN_USD = 0.05
/** The largest one run may hold (the RPC refuses more). */
export const RESERVATION_MAX_USD = 50

export type ReservationKind = 'fresh_eyes' | 'scorecard'

/** How long an open reservation counts: a queued test may wait a day, then run. */
export const RESERVATION_TTL_HOURS: Record<ReservationKind, number> = { fresh_eyes: 26, scorecard: 12 }

const cents = (n: number) => Math.round(n * 100) / 100

function capped(estimate: number, capUsd: number | null | undefined): number {
  const cap = capUsd != null && Number.isFinite(capUsd) && capUsd > 0 ? capUsd : Infinity
  return Math.max(RESERVATION_MIN_USD, Math.min(RESERVATION_MAX_USD, cents(Math.min(estimate, cap))))
}

/** A scorecard run of `pages` pages scored on the server, capped by `capUsd`. */
export function scorecardReserveUsd(pages: number, capUsd?: number | null): number {
  const n = Math.max(1, Math.floor(pages))
  return capped(n * UX_SCORE_CALL_RESERVE_USD + UX_GROUP_CALL_RESERVE_USD, capUsd)
}

/** A fresh-eyes run: classifying what it may file, capped by `capUsd`. */
export function freshEyesReserveUsd(capUsd?: number | null): number {
  return capped(FRESH_EYES_FILES_MAX * FRESH_EYES_FILE_RESERVE_USD, capUsd)
}

/** What is left of the monthly budget before reservations; null when there is no budget. */
export function budgetHeadroom(state: Pick<LlmBudgetState, 'budgetUsd' | 'spendUsd'>): number | null {
  if (state.budgetUsd == null) return null
  return Math.max(0, cents(state.budgetUsd - state.spendUsd))
}

/** The refusal, in plain words. */
export function reservationRefusal(input: { needUsd: number; headroomUsd: number; heldElsewhereUsd: number }): string {
  const left = Math.max(0, cents(input.headroomUsd - input.heldElsewhereUsd))
  const held = input.heldElsewhereUsd > 0 ? ` after $${input.heldElsewhereUsd.toFixed(2)} held by runs still going` : ''
  return `This run needs up to $${input.needUsd.toFixed(2)} of AI budget, and $${left.toFixed(2)} is left this month${held}. Raise the monthly budget on the Costs page, lower the persona's cost cap, or wait for a run to finish.`
}

export type ReserveResult =
  | { ok: true; reservationId: string; reservedUsd: number }
  | { ok: false; code: 'RUN_BUDGET_UNAVAILABLE' | 'LLM_BUDGET_EXCEEDED' | 'RUN_BUDGET_RESERVED'; message: string; status: 402 | 503 }

/**
 * Hold `usd` for the run `uxRunId` (its ux_runs id, which may not exist yet).
 * Reads the budget, then reserves under the project's lock.
 */
export async function reserveRunBudget(
  db: SupabaseClient,
  input: { projectId: string; uxRunId: string; kind: ReservationKind; usd: number; createdBy: string | null; now?: Date },
  readState: (db: SupabaseClient, projectId: string, now: Date) => Promise<LlmBudgetState> = readLlmBudgetState,
): Promise<ReserveResult> {
  const now = input.now ?? new Date()
  let state: LlmBudgetState
  try {
    state = await readState(db, input.projectId, now)
  } catch {
    return { ok: false, code: 'RUN_BUDGET_UNAVAILABLE', message: 'The AI budget could not be read, so the run was not started. Try again in a minute.', status: 503 }
  }
  if (state.over && state.budgetUsd != null) {
    return {
      ok: false,
      code: 'LLM_BUDGET_EXCEEDED',
      message: `This app has spent $${state.spendUsd.toFixed(2)} of its $${state.budgetUsd.toFixed(2)} monthly AI budget. Raise it on the Costs page, or it resets on ${state.resetsAt.slice(0, 10)}.`,
      status: 402,
    }
  }
  const headroom = budgetHeadroom(state)
  const usd = Math.max(RESERVATION_MIN_USD, Math.min(RESERVATION_MAX_USD, cents(input.usd)))
  const { data, error } = await db.rpc('reserve_llm_run_budget', {
    p_project_id: input.projectId,
    p_ux_run_id: input.uxRunId,
    p_kind: input.kind,
    p_usd: usd,
    p_headroom_usd: headroom,
    p_created_by: input.createdBy,
    p_ttl_hours: RESERVATION_TTL_HOURS[input.kind],
  })
  if (error) return { ok: false, code: 'RUN_BUDGET_UNAVAILABLE', message: 'The AI budget could not be reserved, so the run was not started. Try again in a minute.', status: 503 }
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; reservation_id?: string | null; held_elsewhere_usd?: number | string | null } | null
  if (!row?.ok || !row.reservation_id) {
    return { ok: false, code: 'RUN_BUDGET_RESERVED', message: reservationRefusal({ needUsd: usd, headroomUsd: headroom ?? 0, heldElsewhereUsd: Number(row?.held_elsewhere_usd ?? 0) }), status: 402 }
  }
  return { ok: true, reservationId: row.reservation_id, reservedUsd: usd }
}

export type ChargeResult = 'charged' | 'none' | 'spent' | 'unavailable'

/**
 * Charge `usd` to the run's reservation. `none`: the run has no reservation
 * (runs started before reservations, or a CLI scorecard scored on the server
 * without an upload): the caller goes on under the monthly budget alone.
 * `spent`: the reservation (the run's cap) has no room left: refuse the call.
 */
export async function chargeRunBudget(db: SupabaseClient, uxRunId: string, usd: number): Promise<ChargeResult> {
  const { data, error } = await db.rpc('charge_llm_run_reservation', { p_ux_run_id: uxRunId, p_usd: cents(usd) })
  if (error) return 'unavailable'
  if (data === true) return 'charged'
  const { data: row, error: readErr } = await db.from('llm_run_reservations').select('id').eq('ux_run_id', uxRunId).maybeSingle()
  if (readErr) return 'unavailable'
  return row ? 'spent' : 'none'
}

/**
 * Give back a charge for a call that failed before it produced anything
 * (storage unreadable, model unavailable, no usable answer), so a retry does
 * not eat the budget the run's later calls need. Best effort: false when the
 * refund could not be written.
 */
export async function refundRunBudget(db: SupabaseClient, uxRunId: string, usd: number): Promise<boolean> {
  const { error } = await db.rpc('refund_llm_run_reservation', { p_ux_run_id: uxRunId, p_usd: cents(usd) })
  return !error
}

/** Release the run's reservation: the dollars it frees, or null when the release failed. */
export async function releaseRunBudget(db: SupabaseClient, uxRunId: string): Promise<number | null> {
  const { data, error } = await db.rpc('release_llm_run_reservation', { p_ux_run_id: uxRunId })
  if (error) return null
  return Number(data ?? 0)
}

/** The project's open reservations (for the console's budget line). */
export async function heldUsd(db: SupabaseClient, projectId: string, now: Date = new Date()): Promise<number | null> {
  const { data, error } = await db
    .from('llm_run_reservations')
    .select('reserved_usd, charged_usd')
    .eq('project_id', projectId)
    .eq('status', 'open')
    .gt('expires_at', now.toISOString())
    .limit(200)
  if (error) return null
  return cents(((data ?? []) as Array<{ reserved_usd: number | string; charged_usd: number | string }>).reduce((n, r) => n + Number(r.reserved_usd) - Number(r.charged_usd), 0))
}

/** The message when a run's cap is spent. */
export const RUN_BUDGET_SPENT_MESSAGE = "This run has used the AI budget it reserved (its persona's cost cap). Start a new run, or raise the cap."
