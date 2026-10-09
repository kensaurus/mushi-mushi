/**
 * packages/agents/src/pdca-models.ts
 *
 * Which models the library PDCA runner (`pdca.ts`) calls, and what each call
 * costs. Mirrors the server's `_shared/pdca-models.ts` (default = current
 * Sonnet) and `_shared/pricing.ts` (USD per 1M tokens). `pdca-models.test.ts`
 * reads the server pricing table and fails when these prices drift from it.
 *
 * A model outside this table is refused when the runner is built, not priced
 * at $0 or a guessed rate after the call has been paid for.
 */

/** Producer and critic default: the current Sonnet. */
export const PDCA_DEFAULT_MODEL = 'claude-sonnet-5-5'

/** OpenAI model used only when the Claude call fails (same as the server's OPENAI_PRIMARY). */
export const PDCA_OPENAI_FALLBACK_MODEL = 'gpt-5.4'

/**
 * Room for adaptive thinking: the 5.x models think by default and the
 * thinking counts toward `max_tokens`, so a small cap truncates the markup or
 * the JSON before it is complete (the server's claude-messages uses the same).
 */
export const PDCA_MAX_OUTPUT_TOKENS = 16_000

/** Claude models a caller may pick for the producer or the critic. */
export const PDCA_CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5'] as const
export type PdcaClaudeModel = (typeof PDCA_CLAUDE_MODELS)[number]
export type PdcaPricedModel = PdcaClaudeModel | typeof PDCA_OPENAI_FALLBACK_MODEL

/** USD per 1M tokens, copied from packages/server/supabase/functions/_shared/pricing.ts. */
export const PDCA_PRICING_PER_M_TOKENS: Readonly<Record<PdcaPricedModel, { in: number; out: number }>> = {
  'claude-sonnet-5-5': { in: 2.0, out: 10.0 },
  'claude-opus-5-5': { in: 4.0, out: 20.0 },
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'gpt-5.4': { in: 5.0, out: 15.0 },
}

function isPdcaClaudeModel(id: string): id is PdcaClaudeModel {
  return (PDCA_CLAUDE_MODELS as readonly string[]).includes(id)
}

/**
 * The Claude model a PdcaConfig field selects. Absent means the default.
 * Anything else must be one of PDCA_CLAUDE_MODELS; a retired id (Sonnet 4.6,
 * Opus 4.7) or a non-Claude id throws instead of being called and mispriced.
 */
export function resolvePdcaClaudeModel(field: 'primaryModel' | 'judgeModel', raw: string | undefined): PdcaClaudeModel {
  if (raw === undefined) return PDCA_DEFAULT_MODEL
  const id = raw.trim()
  if (isPdcaClaudeModel(id)) return id
  throw new Error(
    `PdcaConfig.${field} "${raw.slice(0, 64)}" is not a model the PDCA runner can call and price. ` +
      `Use one of: ${PDCA_CLAUDE_MODELS.join(', ')}.`,
  )
}

export interface PdcaTokenUsage {
  inputTokens: number | undefined
  outputTokens: number | undefined
}

/** USD for one call on `model`, from the token counts the provider reported. */
export function pdcaCallCostUsd(model: PdcaPricedModel, usage: PdcaTokenUsage): number {
  const price = PDCA_PRICING_PER_M_TOKENS[model]
  return ((usage.inputTokens ?? 0) * price.in + (usage.outputTokens ?? 0) * price.out) / 1_000_000
}
