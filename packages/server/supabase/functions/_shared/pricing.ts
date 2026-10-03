// =============================================================================
// LLM pricing — single source of truth for cost-per-token math used by
// telemetry writes (`logLlmInvocation`), the Health rollup, and the Billing
// per-project COGS view. Mirror exactly when adjusting the SQL backfill in
// `migrations/20260420000200_llm_cost_usd.sql` — drift between the two means
// historical rows show different cost than newly-inserted rows.
// =============================================================================

/** USD per 1M tokens. Add new models here; the SQL backfill must mirror. */
export const LLM_PRICING_PER_M_TOKENS: Record<string, { in: number; out: number }> = {
  // Anthropic — 5.x generation (Claude API list prices, 2026-09-25). A
  // server-side refusal fallback from Sonnet 5.5 is served (and billed) as
  // `claude-sonnet-5`, so that row must exist too.
  'claude-sonnet-5-5':           { in: 2.00, out: 10.00 },
  'claude-sonnet-5':             { in: 2.00, out: 10.00 },
  'claude-opus-5-5':             { in: 4.00, out: 20.00 },
  'claude-opus-5':               { in: 5.00, out: 25.00 },
  // Anthropic — 4.x generation
  'claude-haiku-4-5':            { in: 1.00, out: 5.00 },
  'claude-haiku-4-5-20251001':   { in: 1.00, out: 5.00 },
  'claude-haiku-4-6':            { in: 0.25, out: 1.25 },
  'claude-haiku-3-5':            { in: 0.80, out: 4.00 },
  'claude-sonnet-4-5-20250929':  { in: 3.00, out: 15.00 },
  'claude-sonnet-4-6':           { in: 3.00, out: 15.00 },
  'claude-sonnet-3-7':           { in: 3.00, out: 15.00 },
  // Opus 4.6 / 4.7 list at $5/$25 (the old 15/75 was the Opus 4.0/4.1 price,
  // which tripled the cost shown for every judge run on the Opus 4.7 default).
  'claude-opus-4-6':             { in: 5.00,  out: 25.00 },
  'claude-opus-4-7':             { in: 5.00,  out: 25.00 },
  'claude-opus-4-8':             { in: 5.00,  out: 25.00 },
  // OpenAI — current generation (GPT-5 family, released 2026)
  'gpt-4.1':                     { in: 2.00, out: 8.00 },
  'gpt-4.1-mini':                { in: 0.40, out: 1.60 },
  'gpt-5':                       { in: 5.00, out: 15.00 },
  'gpt-5.4':                     { in: 5.00, out: 15.00 },
  'gpt-5.4-mini':                { in: 0.60, out: 2.40 },
  // Embeddings
  'text-embedding-3-small':      { in: 0.02, out: 0.00 },
  'text-embedding-3-large':      { in: 0.13, out: 0.00 },
}

/**
 * Fallback when a model is unknown. Uses Sonnet pricing so unrecognised
 * callers still get a non-zero estimate rather than silent $0. The same
 * fallback is used by the SQL backfill in the matching migration.
 */
export const LLM_PRICING_FALLBACK = { in: 3.00, out: 15.00 }

/**
 * Compute USD cost for a single LLM call given the resolved model name and
 * token counts. Strips the `vendor/` prefix so both `anthropic/claude-…` and
 * bare `claude-…` shapes hit the same row in the pricing table.
 *
 * Returns 0 when both token counts are 0 — caller should still write the row
 * for latency/error tracking, just with cost_usd = 0.
 */
export function estimateCallCostUsd(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const key = (model ?? '').toLowerCase()
  const stripped = key.includes('/') ? key.split('/').slice(-1)[0] : key
  const price = LLM_PRICING_PER_M_TOKENS[stripped] ?? LLM_PRICING_FALLBACK
  return (inputTokens * price.in + outputTokens * price.out) / 1_000_000
}

/** Tokens and cost of one model's calls within one run. */
export interface ModelUsageRow {
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/**
 * Usage of a run that can call more than one model (a Claude call with an
 * OpenAI fallback), kept per model. Write one `llm_cost_usd` row per model:
 * a compound id such as `claude-sonnet-5-5+gpt-5.4-mini` would be a cost
 * bucket of its own and would never match a model filter.
 */
export class UsageByModel {
  private readonly totals = new Map<string, ModelUsageRow>()

  record(model: string, inputTokens: number, outputTokens: number): void {
    const row = this.totals.get(model) ?? { model, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    row.inputTokens += inputTokens
    row.outputTokens += outputTokens
    row.costUsd += estimateCallCostUsd(model, inputTokens, outputTokens)
    this.totals.set(model, row)
  }

  /** One row per model used, in the order each was first used. */
  rows(): ModelUsageRow[] {
    return [...this.totals.values()].map((r) => ({ ...r }))
  }

  get totalCostUsd(): number {
    let sum = 0
    for (const r of this.totals.values()) sum += r.costUsd
    return sum
  }
}
