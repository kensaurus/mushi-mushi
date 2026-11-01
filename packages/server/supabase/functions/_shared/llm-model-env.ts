/**
 * FILE: packages/server/supabase/functions/_shared/llm-model-env.ts
 * PURPOSE: Operator model overrides for local or self-hosted models (Plan 023
 *          Phase 1, ADR 0034).
 *
 *   MUSHI_LLM_MODEL_FAST    quick check (Stage 1), chat, summaries: every
 *                           Haiku-class and `*-mini` call
 *   MUSHI_LLM_MODEL_SMART   classification (Stage 2), fixes, generation:
 *                           every Sonnet-class and full GPT call
 *   MUSHI_LLM_MODEL_REVIEW  the judge and the agent PR review (Opus-class)
 *
 * A model server such as Ollama or vLLM serves its own ids (`qwen3:32b`), so
 * a Claude or GPT id sent there fails. When any override is set, every Claude
 * and GPT id maps to the override for its class, on the Anthropic path and the
 * OpenAI-compatible fallback alike, and stored per-project Claude ids yield to
 * it (`resolveClaudeModel`). An unset class borrows the nearest set one, so a
 * single MUSHI_LLM_MODEL_SMART serves everything.
 *
 * Ollama `:cloud` tags (`gpt-oss:120b-cloud`) run on ollama.com through the
 * local daemon, past the egress guard. In local-only mode they are refused.
 *
 * Pure apart from reading the env; no npm imports (models.ts imports it).
 */

import { isLocalOnly } from './egress.ts'

export type ModelTier = 'fast' | 'smart' | 'review'

export const MODEL_OVERRIDE_ENV: Record<ModelTier, string> = {
  fast: 'MUSHI_LLM_MODEL_FAST',
  smart: 'MUSHI_LLM_MODEL_SMART',
  review: 'MUSHI_LLM_MODEL_REVIEW',
}

/** Which other classes an unset class borrows from, nearest first. */
const BORROW: Record<ModelTier, ModelTier[]> = {
  fast: ['fast', 'smart', 'review'],
  smart: ['smart', 'review', 'fast'],
  review: ['review', 'smart', 'fast'],
}

type EnvReader = (name: string) => string | undefined

function denoEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(n: string): string | undefined } } }).Deno
  try {
    return deno?.env?.get(name)
  } catch {
    return undefined
  }
}

export class LocalOnlyModelError extends Error {
  readonly code = 'LOCAL_ONLY_CLOUD_MODEL'
  constructor(readonly model: string) {
    super(
      `"${model}" is an Ollama cloud model: it runs on ollama.com, not on this machine. ` +
        'Local-only mode (MUSHI_LOCAL_ONLY=1) refuses it; pick a local tag.',
    )
    this.name = 'LocalOnlyModelError'
  }
}

/** Ollama cloud tags: `name:cloud`, `name:120b-cloud`. */
export function isOllamaCloudModel(model: string | null | undefined): boolean {
  const id = (model ?? '').trim().toLowerCase()
  const colon = id.lastIndexOf(':')
  if (colon < 0) return false
  const tag = id.slice(colon + 1)
  return tag === 'cloud' || tag.endsWith('-cloud')
}

/** The configured override per class (no borrowing), trimmed; empty means unset. */
export function readModelOverrides(env: EnvReader = denoEnv): Partial<Record<ModelTier, string>> {
  const out: Partial<Record<ModelTier, string>> = {}
  for (const tier of Object.keys(MODEL_OVERRIDE_ENV) as ModelTier[]) {
    const v = env(MODEL_OVERRIDE_ENV[tier])?.trim()
    if (v) out[tier] = v
  }
  return out
}

export function modelOverridesActive(env: EnvReader = denoEnv): boolean {
  return Object.keys(readModelOverrides(env)).length > 0
}

/** The model for a class, borrowing from the nearest set class; undefined when none is set. */
export function modelOverride(tier: ModelTier, env: EnvReader = denoEnv): string | undefined {
  const set = readModelOverrides(env)
  for (const t of BORROW[tier]) if (set[t]) return set[t]
  return undefined
}

/** The class of a vendor model id, or null for an id that is not Claude or GPT (a local id). */
export function modelTierOf(model: string): ModelTier | null {
  const raw = model.trim().toLowerCase()
  const id = raw.includes('/') ? raw.split('/').slice(-1)[0]! : raw
  if (/^claude-opus/.test(id)) return 'review'
  if (/^claude-haiku/.test(id)) return 'fast'
  if (/^claude-/.test(id)) return 'smart'
  if (/^(gpt-|o\d)/.test(id)) return /-(mini|nano)\b/.test(id) ? 'fast' : 'smart'
  return null
}

/**
 * The id to send for a requested one: the class override when overrides are
 * on and the id is Claude or GPT, else the id unchanged. Throws
 * LocalOnlyModelError for an Ollama cloud tag in local-only mode.
 */
export function effectiveModelId(requested: string, env: EnvReader = denoEnv): string {
  let model = requested
  if (modelOverridesActive(env)) {
    const tier = modelTierOf(requested)
    if (tier) model = modelOverride(tier, env) ?? requested
  }
  const localOnly = isLocalOnly({ MUSHI_LOCAL_ONLY: env('MUSHI_LOCAL_ONLY') })
  if (localOnly && isOllamaCloudModel(model)) throw new LocalOnlyModelError(model)
  return model
}

/**
 * Wrap an AI SDK provider (`createAnthropic(...)`, `createOpenAI(...)`) so
 * `provider(id, settings)` sends `effectiveModelId(id)`. Methods such as
 * `provider.chat` stay as they were.
 */
export function withModelOverrides<P>(provider: P): P {
  const call = provider as unknown as (id: string, ...rest: unknown[]) => unknown
  const mapped = ((id: string, ...rest: unknown[]) => call(effectiveModelId(id), ...rest)) as unknown as P
  return Object.assign(mapped as object, provider) as P
}
