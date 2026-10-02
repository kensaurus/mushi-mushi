// =============================================================================
// LLM model constants — single source of truth for the Anthropic + OpenAI
// model IDs used by every Edge Function. A future model bump is a one-liner
// in this file instead of a 12-file scatter.
//
// Naming convention mirrors the Anthropic / OpenAI identifiers used on the
// wire (as of 2026-10-02):
//   • Anthropic: `claude-{family}-{version}` (e.g. `claude-sonnet-5-5`), no
//     dated suffix.
//   • OpenAI: bare model IDs (`gpt-5.4`, `gpt-5.4-mini`).
//
// TWO CLAUDE CALL PATHS (2026-10-02). Sonnet 5.5 rejects non-default
// `temperature` and forced `tool_choice`; AI SDK v4 sends both on every call.
// So a route may use `ANTHROPIC_SONNET_LATEST` only when ALL its Claude calls
// go through `claude-messages.ts`. Routes still on `createAnthropic` +
// `generateObject` / `generateText` stay on `ANTHROPIC_SONNET` (4.6) until
// they are moved over.
//
// Keep pricing rows in `pricing.ts` (and the SQL backfill in the matching
// migration) in sync when adding a new model here.
// =============================================================================

// --- Anthropic ---------------------------------------------------------------

/** Current Sonnet ($2/$10 per MTok). Stage 2, fix-worker, judge, assistants
 *  and the intelligence digest — every caller goes through `claude-messages.ts`. */
export const ANTHROPIC_SONNET_LATEST = 'claude-sonnet-5-5'

/** Sonnet for routes still on the AI SDK v4 Claude path (see the header). */
export const ANTHROPIC_SONNET = 'claude-sonnet-4-6'

/** Opus 4.8 (released 2026-05-28). Not a stage default; listed so pricing
 *  pre-flight covers it. Like every 4.7+ / 5.x model it rejects the AI SDK
 *  v4 call shape, so any caller must use `claude-messages.ts`. */
export const ANTHROPIC_OPUS = 'claude-opus-4-8'

/** Latest Haiku. Fast path: fast-filter + nl-query summariser. Haiku 4.5
 *  still accepts `temperature` and forced tool use, so it stays on AI SDK v4. */
export const ANTHROPIC_HAIKU = 'claude-haiku-4-5'

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

/** classify-report primary (`project_settings.stage2_model` overrides, via
 *  `resolveClaudeModel`). */
export const STAGE2_MODEL = ANTHROPIC_SONNET_LATEST
/** classify-report cross-vendor fallback. */
export const STAGE2_FALLBACK = OPENAI_PRIMARY

/** judge-batch primary (`project_settings.judge_model` overrides).
 *
 * History: Sentry MUSHI-MUSHI-SERVER-9 (2026-04-23/24) pinned the judge to
 * Sonnet 4.6 because Opus 4.7 drops `temperature` and AI SDK v4's
 * `generateObject` both sends `temperature: 0` and forces `tool_choice`
 * (vercel/ai#7220, #9351). judge-batch now calls Claude through
 * `claude-messages.ts` (native structured outputs, no sampling knobs), which
 * lifts that constraint for every model. */
export const JUDGE_MODEL = ANTHROPIC_SONNET_LATEST
/** judge-batch cross-vendor fallback (`project_settings.judge_fallback_model` overrides). */
export const JUDGE_FALLBACK = OPENAI_PRIMARY

/** fix-worker primary (Anthropic path). */
export const FIX_MODEL = ANTHROPIC_SONNET_LATEST
/** fix-worker cross-vendor fallback (OpenAI path). */
export const FIX_FALLBACK = OPENAI_PRIMARY

/** intelligence-report weekly digest. */
export const INTELLIGENCE_MODEL = ANTHROPIC_SONNET_LATEST
export const INTELLIGENCE_FALLBACK = OPENAI_PRIMARY

/** generate-synthetic report generator. */
export const SYNTHETIC_MODEL = ANTHROPIC_SONNET
export const SYNTHETIC_FALLBACK = OPENAI_PRIMARY

/** library-modernizer weekly dep audit. */
export const MODERNIZER_MODEL = ANTHROPIC_SONNET
export const MODERNIZER_FALLBACK = OPENAI_PRIMARY

/** prompt-auto-tune. Still on the AI SDK v4 path (`generateObject` +
 *  `temperature: 0`), so it stays on Sonnet 4.6 until it is moved to
 *  `claude-messages.ts`; the judge no longer shares its ceiling. */
export const PROMPT_TUNE_MODEL = ANTHROPIC_SONNET
export const PROMPT_TUNE_FALLBACK = OPENAI_PRIMARY

/** Ask Mushi / `/v1/admin/ask-mushi/messages` and the in-SDK assistant —
 *  scoped chat that answers questions about the current page. Sonnet balances
 *  reasoning with cost; the usage pattern is short sessions, not bulk traffic. */
export const ASSIST_MODEL = ANTHROPIC_SONNET_LATEST
export const ASSIST_FALLBACK = OPENAI_PRIMARY

/** Store review (Plan 020 §5.3): pull the claims out of a store listing. On
 *  demand, per release, never per push. */
export const STORE_REVIEW_MODEL = ANTHROPIC_SONNET_LATEST
export const STORE_REVIEW_FALLBACK = OPENAI_PRIMARY

/** Codebase Atlas Q&A (`codebase-understand`), still on the AI SDK v4 path. */
export const CODEBASE_ASSIST_MODEL = ANTHROPIC_SONNET

/** test-gen-from-story default, still on the AI SDK v4 path. */
export const TEST_GEN_MODEL = ANTHROPIC_SONNET

// --- Effort per route (`output_config.effort`) ------------------------------
//
// Starting points from the Sonnet 5.5 migration guide: `low` for chat,
// classification and content generation, `medium` for diagnosis and code.
// Re-run the sweep against real traffic before raising any of these.

export const STAGE2_EFFORT = 'medium' as const
export const VISION_EFFORT = 'low' as const
export const FIX_EFFORT = 'medium' as const
export const JUDGE_EFFORT = 'low' as const
export const ASSIST_EFFORT = 'low' as const
export const STORE_REVIEW_EFFORT = 'low' as const
export const INTELLIGENCE_EFFORT = 'low' as const
export const TEST_GEN_EFFORT = 'medium' as const

/** Extra `max_tokens` on top of a reply cap so adaptive thinking (which counts
 *  toward `max_tokens`) cannot truncate a short assistant answer. */
export const THINKING_HEADROOM_TOKENS = 4_000

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
 * .type === 'enabled'`).
 *
 * !!! BUT — and this is the second-order failure that re-fired SERVER-9 on
 * 2026-04-24 03:00 UTC after `e218bbf` shipped: Anthropic ALSO forbids
 * "thinking + tool_choice forces tool use", and `generateObject` ALWAYS sets
 * `tool_choice: { type: 'tool', name: 'json' }` for Anthropic. So enabling
 * thinking just trades one 400 for another:
 *
 *   "Thinking may not be enabled when tool_choice forces tool use."
 *
 * Confirmed by Anthropic docs (extended-thinking + tool-use) and upstream:
 *   - https://github.com/vercel/ai/issues/7220 (closed, no built-in fix)
 *   - https://github.com/vercel/ai/issues/9351 (open, native middleware ask)
 *
 * `acceptsSamplingKnobs(model) === false` callers MUST NOT use the AI SDK v4
 * Claude path at all (`generateObject`, `generateText`, `streamText`): v4
 * sends `temperature: 0` on every call. Use `claude-messages.ts`, which also
 * replaces the forced tool_choice with native structured outputs.
 *
 * Future Anthropic generations are expected to keep the no-temperature
 * restriction, so the matcher is family-level (Opus 4.7+, Sonnet 5+) rather
 * than the single SKU. The helper stays exported so a future
 * `generateText`-based caller can branch on it correctly.
 */
export function acceptsSamplingKnobs(model: string | null | undefined): boolean {
  const key = normalizeModelId(model)
  // Anthropic Opus 4.7+ — locked-default sampling. Any future Anthropic model
  // family that ships with the same restriction should be added here.
  if (/^claude-opus-(?:[4-9]-[7-9]|[4-9]-\d{2,}|[5-9]-)/i.test(key)) return false
  // Sonnet 5+, Fable and Mythos ship with the same restriction.
  if (/^claude-(?:sonnet-(?:[5-9]|\d{2,})|fable-|mythos-)/i.test(key)) return false
  return true
}

/**
 * Builds the AI SDK v4 `experimental_providerMetadata` (or v5 `providerOptions`)
 * payload that flips `@ai-sdk/anthropic` into thinking mode with a minimal
 * budget. Used by callers of `generateText` to suppress the SDK's mandatory
 * `temperature: 0` default on Opus 4.7+ models.
 *
 * !!! Do NOT pass this to `generateObject` — Anthropic rejects "thinking +
 * forced tool_choice" with HTTP 400, and `generateObject` always forces
 * tool_choice. See `acceptsSamplingKnobs` for the full failure history
 * (MUSHI-MUSHI-SERVER-9, vercel/ai#7220, vercel/ai#9351).
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
  ANTHROPIC_SONNET_LATEST,
  ANTHROPIC_SONNET,
  ANTHROPIC_OPUS,
  OPENAI_PRIMARY,
  OPENAI_MINI,
] as const
