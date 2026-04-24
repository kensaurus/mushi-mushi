// =============================================================================
// LLM model constants — single source of truth for the Anthropic + OpenAI
// model IDs used by every Edge Function. A future model bump is a one-liner
// in this file instead of a 12-file scatter.
//
// Naming convention mirrors the Anthropic / OpenAI identifiers used on the
// wire (as of 2026-04-22):
//   • Anthropic: `claude-{family}-{version}` (e.g. `claude-sonnet-4-6`), with
//     optional dated suffix for Haiku (`…-20251001`).
//   • OpenAI: bare model IDs (`gpt-5.4`, `gpt-5.4-mini`).
//
// Keep pricing rows in `pricing.ts` (and the SQL backfill in the matching
// migration) in sync when adding a new model here.
// =============================================================================

// --- Anthropic ---------------------------------------------------------------

/** Latest Sonnet (2026-Q1 top Sonnet tier). Sweet-spot default for Stage 2
 *  classification, fix-worker, intelligence, synthetic, modernizer. */
export const ANTHROPIC_SONNET = 'claude-sonnet-4-6'

/** Latest Opus (released 2026-04-16). Reserved for judging + prompt auto-tune
 *  where self-critique on the frontier pays off. */
export const ANTHROPIC_OPUS = 'claude-opus-4-7'

/** Latest Haiku. Fast path: fast-filter + nl-query summariser. */
export const ANTHROPIC_HAIKU = 'claude-haiku-4-5-20251001'

// --- OpenAI (cross-vendor fallback) -----------------------------------------

/** Latest GPT-5 (released 2026-03-05). Fallback for Stage 2 + judge when
 *  Anthropic is degraded. */
export const OPENAI_PRIMARY = 'gpt-5.4'

/** Mini fallback for fast-filter. Keeps cross-vendor parity cheap. */
export const OPENAI_MINI = 'gpt-5.4-mini'

// --- Embeddings -------------------------------------------------------------

export const OPENAI_EMBEDDING_SMALL = 'text-embedding-3-small'
export const OPENAI_EMBEDDING_LARGE = 'text-embedding-3-large'

// --- Per-stage defaults -----------------------------------------------------
//
// Stage defaults live here so every caller resolves the same canonical ID.
// `project_settings.{stage1,stage2,judge}_model` in the DB can override any of
// these per project; use the `*_FALLBACK` constant when the primary provider
// is degraded.

/** fast-filter primary. */
export const STAGE1_MODEL = ANTHROPIC_HAIKU
/** fast-filter cross-vendor fallback. */
export const STAGE1_FALLBACK = OPENAI_MINI

/** classify-report primary (`project_settings.stage2_model` overrides). */
export const STAGE2_MODEL = ANTHROPIC_SONNET
/** classify-report cross-vendor fallback. */
export const STAGE2_FALLBACK = OPENAI_PRIMARY

/** judge-batch primary (`project_settings.judge_model` overrides). */
export const JUDGE_MODEL = ANTHROPIC_OPUS
/** judge-batch cross-vendor fallback (`project_settings.judge_fallback_model` overrides). */
export const JUDGE_FALLBACK = OPENAI_PRIMARY

/** fix-worker primary (Anthropic path). */
export const FIX_MODEL = ANTHROPIC_SONNET
/** fix-worker cross-vendor fallback (OpenAI path). */
export const FIX_FALLBACK = OPENAI_PRIMARY

/** intelligence-report weekly digest. */
export const INTELLIGENCE_MODEL = ANTHROPIC_SONNET
export const INTELLIGENCE_FALLBACK = OPENAI_PRIMARY

/** generate-synthetic report generator. */
export const SYNTHETIC_MODEL = ANTHROPIC_SONNET
export const SYNTHETIC_FALLBACK = OPENAI_PRIMARY

/** library-modernizer weekly dep audit. */
export const MODERNIZER_MODEL = ANTHROPIC_SONNET
export const MODERNIZER_FALLBACK = OPENAI_PRIMARY

/** prompt-auto-tune — uses the same frontier model as judge so rewrites are
 *  graded and rewritten by the same ceiling. */
export const PROMPT_TUNE_MODEL = ANTHROPIC_OPUS
export const PROMPT_TUNE_FALLBACK = OPENAI_PRIMARY

/** Ask Mushi / `/v1/admin/ask-mushi/messages` — scoped chat assistant that answers
 *  questions about the current page. Sonnet balances reasoning with
 *  cost; the usage pattern is short sessions, not bulk traffic. */
export const ASSIST_MODEL = ANTHROPIC_SONNET
export const ASSIST_FALLBACK = OPENAI_PRIMARY

/** nl-query: SQL planner uses Sonnet (reasoning-heavy), summariser uses Haiku
 *  (fast, cheap). */
export const NL_QUERY_PLANNER_MODEL = ANTHROPIC_SONNET
export const NL_QUERY_PLANNER_FALLBACK = OPENAI_PRIMARY
export const NL_QUERY_SUMMARY_MODEL = ANTHROPIC_HAIKU
export const NL_QUERY_SUMMARY_FALLBACK = OPENAI_MINI

// --- Health probe models ----------------------------------------------------
//
// The `/v1/admin/health/integration/{anthropic,openai}` probes use the cheapest
// model available so a 1-token roundtrip costs ~$0 and exercises auth + quota.

export const HEALTH_PROBE_ANTHROPIC_MODEL = ANTHROPIC_HAIKU
export const HEALTH_PROBE_OPENAI_MODEL = OPENAI_MINI

// --- Helpers ----------------------------------------------------------------

/** Strip an optional `vendor/` prefix so both `anthropic/claude-sonnet-4-6`
 *  and bare `claude-sonnet-4-6` map to the same canonical ID (used by
 *  pricing lookups and telemetry). */
export function normalizeModelId(model: string | null | undefined): string {
  const key = (model ?? '').toLowerCase()
  return key.includes('/') ? key.split('/').slice(-1)[0] : key
}

/**
 * Returns true iff the model accepts the legacy sampling knobs (`temperature`,
 * `top_p`, `top_k`). Anthropic deprecated these on Opus 4.7 (2026-04-16): the
 * API now hard-rejects ANY value (the parameter itself is gone) with
 * `400 invalid_request_error "temperature is deprecated for this model"`.
 * See: https://forum.cursor.com/t/opus-4-7-not-functioning-on-bedrock-because-of-temperature-deprecation-400/158212
 *
 * Sentry MUSHI-MUSHI-SERVER-9 (regressed 2026-04-23): AI SDK v4's
 * `prepareCallSettings` hardcodes `temperature ?? 0` (see
 * https://github.com/vercel/ai/blob/ai%404.3.16/packages/ai/core/prompt/prepare-call-settings.ts#L96)
 * — there is no way to OMIT the field through the public `generateObject`
 * surface. The only escape hatch the `@ai-sdk/anthropic` provider offers is
 * thinking mode (`anthropic-messages-language-model.ts` line ~140 strips
 * `temperature`/`topK`/`topP` whenever `providerOptions.anthropic.thinking
 * .type === 'enabled'`). So the architectural fix is: when the model can't
 * take sampling knobs, callers MUST enable thinking — see `anthropicThinkingProviderOptions`.
 *
 * Future Anthropic generations are expected to keep this restriction, so the
 * matcher is family-level (Opus 4.7+, Opus 5+) rather than the single SKU.
 *
 * Caller convention:
 *   const useSamplingKnobs = acceptsSamplingKnobs(modelId)
 *   await generateObject({
 *     model: anthropic(modelId),
 *     ...(useSamplingKnobs ? { temperature: 0 } : {}),
 *     ...(useSamplingKnobs ? {} : { providerOptions: anthropicThinkingProviderOptions() }),
 *     ...
 *   })
 */
export function acceptsSamplingKnobs(model: string | null | undefined): boolean {
  const key = normalizeModelId(model)
  // Anthropic Opus 4.7+ — locked-default sampling. Any future Anthropic model
  // family that ships with the same restriction should be added here.
  if (/^claude-opus-(?:[4-9]-[7-9]|[4-9]-\d{2,}|[5-9]-)/i.test(key)) return false
  return true
}

/**
 * Builds the AI SDK v4 `experimental_providerMetadata` (or v5 `providerOptions`)
 * payload that flips `@ai-sdk/anthropic` into thinking mode with a minimal
 * budget. Used by callers of `generateObject`/`generateText` to suppress the
 * SDK's mandatory `temperature: 0` default on Opus 4.7+ models.
 *
 * The default budget (4096) is the smallest value that reliably produces a
 * usable structured response on Opus 4.7's tool-use path during local
 * verification of the MUSHI-MUSHI-SERVER-9 fix. Callers that want extended
 * reasoning can pass a higher budget; Anthropic accepts up to 128k.
 */
export function anthropicThinkingProviderOptions(budgetTokens = 4096) {
  return {
    anthropic: {
      thinking: { type: 'enabled' as const, budgetTokens },
    },
  } as const
}

/** Every non-embedding model currently used anywhere in the pipeline. Use for
 *  pre-flight checks (e.g. confirm pricing exists for every active model). */
export const ALL_ACTIVE_CHAT_MODELS: readonly string[] = [
  ANTHROPIC_HAIKU,
  ANTHROPIC_SONNET,
  ANTHROPIC_OPUS,
  OPENAI_PRIMARY,
  OPENAI_MINI,
] as const
