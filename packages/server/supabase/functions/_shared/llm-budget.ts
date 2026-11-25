/**
 * FILE: packages/server/supabase/functions/_shared/llm-budget.ts
 * PURPOSE: Enforce project_settings.monthly_llm_budget_usd (Plan 020 P-2).
 *
 * The budget was stored and drawn on the Costs page, but nothing read it on
 * the call path: a project could spend past it without limit.
 *
 * What counts toward the budget — the same number the Costs page shows as
 * "this month" (api/routes/costs.ts spendMonthUsd):
 *   - every `llm_invocations` row of the project since 00:00 UTC on the 1st,
 *     at its stored cost_usd (priced at write time from the shared price
 *     catalog, _shared/llm-cost.ts), whatever the key: the project's own BYOK keys and the
 *     platform key both count, because the budget is the owner's own cap on
 *     what their app's bugs cost them;
 *   - legacy `llm_cost_usd` ledger rows in the same window.
 * Embeddings (code indexing, search) write llm_invocations rows (stage
 * 'embedding', since 2026-10-04), so they count toward the budget, but they
 * resolve keys with `purpose: 'embedding'` and are never blocked by it.
 *
 * Where it is enforced: `withLlmFailover` / `withAnthropicOrOpenAi` and
 * `resolveLlmKey` for anthropic/openai — the shared path every generation
 * call goes through. Over budget, they throw `LlmBudgetExceededError` before
 * any provider call; the caller records it on the report or job.
 *
 * Failure policy: a budget read that fails throws `LlmBudgetUnavailableError`.
 * The shared path logs it to Sentry and lets the call proceed — one failed
 * read must not take triage dark — so the failure is loud, not silent.
 *
 * Unpriced calls (cost_usd NULL: the catalog had no price in force) add no
 * dollars, because no dollar figure exists for them. They are counted, with
 * their tokens, in `unpricedCalls` / `unpricedTokens`, which the Costs page
 * and the over-budget message show. There is no token cap to enforce.
 *
 * Pure apart from the injected client; no Deno globals.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

/**
 * Same rule as the Costs page: the stored cost, or null when the row is
 * unpriced. A row is never re-priced here: a missing price is not a number.
 */
export function resolveCostUsd(persisted: number | string | null | undefined): number | null {
  if (persisted == null) return null
  const n = Number(persisted)
  return Number.isFinite(n) ? n : null
}

export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export class LlmBudgetExceededError extends Error {
  readonly code = 'LLM_BUDGET_EXCEEDED'
  constructor(
    readonly projectId: string,
    readonly spendUsd: number,
    readonly budgetUsd: number,
    readonly resetsAt: string,
  ) {
    super(
      `llm_budget_exceeded: this project has spent $${spendUsd.toFixed(2)} of its $${budgetUsd.toFixed(2)} ` +
        `monthly LLM budget, so Mushi stopped calling the model. Raise the budget on the Costs page, ` +
        `or it resets on ${resetsAt.slice(0, 10)}.`,
    )
    this.name = 'LlmBudgetExceededError'
  }
}

export class LlmBudgetUnavailableError extends Error {
  constructor(what: string, detail: string) {
    super(`LLM budget could not be checked (${what}): ${detail}`)
    this.name = 'LlmBudgetUnavailableError'
  }
}

export interface LlmBudgetState {
  budgetUsd: number | null
  /** Priced spend this UTC month. Counting stops once it reaches the budget. */
  spendUsd: number
  /** Calls this month the catalog could not price (counted up to where spend counting stopped). */
  unpricedCalls: number
  /** Input + output tokens of those calls. */
  unpricedTokens: number
  over: boolean
  resetsAt: string
}

const PAGE = 1000

/**
 * Read the budget and this month's spend. No budget → no spend query.
 * Throws LlmBudgetUnavailableError on any failed read.
 */
export async function readLlmBudgetState(
  db: SupabaseClient,
  projectId: string,
  now: Date = new Date(),
): Promise<LlmBudgetState> {
  const monthStart = utcMonthStart(now)
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()

  const { data: settings, error: settingsErr } = await db
    .from('project_settings')
    .select('monthly_llm_budget_usd')
    .eq('project_id', projectId)
    .maybeSingle()
  if (settingsErr) throw new LlmBudgetUnavailableError('budget', settingsErr.message)
  const raw = (settings as { monthly_llm_budget_usd?: unknown } | null)?.monthly_llm_budget_usd
  const budgetUsd = raw == null ? null : Number(raw)
  if (budgetUsd == null || !Number.isFinite(budgetUsd)) {
    return { budgetUsd: null, spendUsd: 0, unpricedCalls: 0, unpricedTokens: 0, over: false, resetsAt }
  }

  const since = monthStart.toISOString()
  let spendUsd = 0
  let unpricedCalls = 0
  let unpricedTokens = 0
  for (let from = 0; spendUsd < budgetUsd; from += PAGE) {
    const { data, error } = await db
      .from('llm_invocations')
      .select('used_model, input_tokens, output_tokens, cost_usd')
      .eq('project_id', projectId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new LlmBudgetUnavailableError('llm_invocations', error.message)
    const rows = (data ?? []) as Array<{
      used_model: string | null
      input_tokens: number | null
      output_tokens: number | null
      cost_usd: number | null
    }>
    for (const r of rows) {
      const cost = resolveCostUsd(r.cost_usd)
      if (cost === null) {
        unpricedCalls++
        unpricedTokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
      } else {
        spendUsd += cost
      }
    }
    if (rows.length < PAGE) break
  }
  if (spendUsd < budgetUsd) {
    const { data, error } = await db
      .from('llm_cost_usd')
      .select('cost_usd')
      .eq('project_id', projectId)
      .gte('occurred_at', since)
    if (error) throw new LlmBudgetUnavailableError('llm_cost_usd', error.message)
    for (const r of (data ?? []) as Array<{ cost_usd: number | null }>) spendUsd += Number(r.cost_usd ?? 0)
  }

  return { budgetUsd, spendUsd, unpricedCalls, unpricedTokens, over: spendUsd >= budgetUsd, resetsAt }
}

/** Per-isolate cache: the hot path (fast-filter, every report) reads at most once a minute per project. */
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { state: LlmBudgetState; at: number }>()

export function resetLlmBudgetCache(): void {
  cache.clear()
}

/** Throws LlmBudgetExceededError when the project is at or over its budget. */
export async function assertLlmBudget(
  db: SupabaseClient,
  projectId: string,
  now: Date = new Date(),
): Promise<LlmBudgetState> {
  const hit = cache.get(projectId)
  let state: LlmBudgetState
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) {
    state = hit.state
  } else {
    state = await readLlmBudgetState(db, projectId, now)
    cache.set(projectId, { state, at: now.getTime() })
  }
  if (state.over && state.budgetUsd != null) {
    throw new LlmBudgetExceededError(projectId, state.spendUsd, state.budgetUsd, state.resetsAt)
  }
  return state
}

/** Providers whose calls are LLM generations the budget covers. */
export function isBudgetedProvider(provider: string): boolean {
  return provider === 'anthropic' || provider === 'openai' || provider === 'openrouter'
}
