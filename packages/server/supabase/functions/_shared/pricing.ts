// =============================================================================
// LLM pricing — single source of truth for cost-per-token math used by
// telemetry writes (`logLlmInvocation`), the Health rollup, and the Billing
// per-project COGS view. Mirror exactly when adjusting the SQL backfill in
// `migrations/20260420000200_llm_cost_usd.sql` — drift between the two means
// historical rows show different cost than newly-inserted rows.
// =============================================================================

/** USD per 1M tokens. Add new models here; the SQL backfill must mirror. */
export const LLM_PRICING_PER_M_TOKENS: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-6':           { in: 0.25, out: 1.25 },
  'claude-haiku-3-5':           { in: 0.80, out: 4.00 },
  'claude-sonnet-4-6':          { in: 3.00, out: 15.00 },
  'claude-sonnet-3-7':          { in: 3.00, out: 15.00 },
  'claude-opus-4-6':            { in: 15.00, out: 75.00 },
  'gpt-4.1':                    { in: 2.00, out: 8.00 },
  'gpt-4.1-mini':               { in: 0.40, out: 1.60 },
  'gpt-5':                      { in: 5.00, out: 15.00 },
  'text-embedding-3-small':     { in: 0.02, out: 0.00 },
  'text-embedding-3-large':     { in: 0.13, out: 0.00 },
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
