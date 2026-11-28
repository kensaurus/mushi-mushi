/**
 * packages/agents/src/pdca-models.ts
 *
 * Which models the library PDCA runner (`pdca.ts`) calls. Mirrors the
 * server's `_shared/pdca-models.ts` (default = current Sonnet).
 *
 * No prices live here (cost catalog, 2026-11-25): the caller passes
 * `PdcaConfig.priceCall`, typically priceFor over the shared KENSAURUS price
 * book (kensaurus-spine/price.ts). Without it a call is unpriced (null),
 * never $0 or a guessed rate.
 *
 * A model outside PDCA_CLAUDE_MODELS is refused when the runner is built.
 */

/** Producer and critic default: the current Sonnet. */
export const PDCA_DEFAULT_MODEL = 'claude-sonnet-5-5'

/** OpenAI model used only when the Claude call fails (same as the server's OPENAI_PRIMARY). */
export const PDCA_OPENAI_FALLBACK_MODEL = 'gpt-6.2-sol'

/**
 * Room for adaptive thinking: the 5.x models think by default and the
 * thinking counts toward `max_tokens`, so a small cap truncates the markup or
 * the JSON before it is complete (the server's claude-messages uses the same).
 */
export const PDCA_MAX_OUTPUT_TOKENS = 16_000

/** Claude models a caller may pick for the producer or the critic. */
export const PDCA_CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5'] as const
export type PdcaClaudeModel = (typeof PDCA_CLAUDE_MODELS)[number]
/** A model the runner calls: a picked Claude model or the OpenAI fallback. */
export type PdcaModel = PdcaClaudeModel | typeof PDCA_OPENAI_FALLBACK_MODEL

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
    `PdcaConfig.${field} "${raw.slice(0, 64)}" is not a model the PDCA runner can call. ` +
      `Use one of: ${PDCA_CLAUDE_MODELS.join(', ')}.`,
  )
}

export interface PdcaTokenUsage {
  inputTokens: number | undefined
  outputTokens: number | undefined
}

/**
 * Prices one call: USD, or null when the price book has no price for it.
 * Must not throw; a failed lookup is null.
 */
export type PdcaPriceCall = (call: {
  provider: 'anthropic' | 'openai'
  model: PdcaModel
  inputTokens: number | undefined
  outputTokens: number | undefined
}) => Promise<number | null>
