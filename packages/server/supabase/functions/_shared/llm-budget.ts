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
 *     priced by its stored cost_usd (or the model price table when a legacy
 *     row has none), whatever the key: the project's own BYOK keys and the
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
 * Pure apart from the injected client; no Deno globals.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { estimateCallCostUsd } from './pricing.ts'

/** Same rule as the Costs page: the stored cost wins, else price the tokens. */
export function resolveCostUsd(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  persisted: number | null | undefined,
): number {
  if (persisted != null) return Number(persisted)
  return estimateCallCostUsd(model, inputTokens ?? 0, outputTokens ?? 0)
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
  /** Spend this UTC month. Counting stops once it reaches the budget. */
  spendUsd: number
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
    return { budgetUsd: null, spendUsd: 0, over: false, resetsAt }
  }

  const since = monthStart.toISOString()
  let spendUsd = 0
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
    for (const r of rows) spendUsd += resolveCostUsd(r.used_model, r.input_tokens, r.output_tokens, r.cost_usd)
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

  return { budgetUsd, spendUsd, over: spendUsd >= budgetUsd, resetsAt }
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
