/**
 * FILE: _shared/openai-model-id.ts
 * PURPOSE: The OpenRouter model-id rule from openai-compat.ts, without the
 *          `@ai-sdk/openai` import, so raw-fetch callers (embeddings) do not
 *          pull the AI SDK into the api function's boot graph (ai-sdk.ts).
 *
 * OpenRouter only accepts vendor-prefixed model ids (`openai/gpt-5.4`,
 * `openai/text-embedding-3-small`); Mushi's model constants are OpenAI's bare
 * ids, which OpenRouter rejects. openai-compat.ts re-exports both helpers.
 *
 * A self-hoster running a local OpenAI-compatible server (Ollama, vLLM,
 * LM Studio) serves other model names. Open models change every few weeks,
 * so Mushi names none: the operator picks.
 *  - `MUSHI_OPENAI_MODEL`: one model for every chat call (filter, diagnosis,
 *    judge, fixes), e.g. `qwen3.8:27b`.
 *  - `MUSHI_OPENAI_EMBEDDING_MODEL`: the model for embeddings, kept apart so a
 *    chat model never gets an embedding call. It must return 1536-dimension
 *    vectors (the stored size).
 *  - `MUSHI_OPENAI_MODEL_MAP`: per-id renames, which win over both:
 *    `gpt-6-luna=qwen3:8b,gpt-6.1-terra=qwen3:14b`.
 * A chosen name is sent exactly as written.
 */

/** True when an OpenAI-compatible base URL points at OpenRouter. */
export function isOpenRouterBaseUrl(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai')
  } catch {
    return false
  }
}

/**
 * Parse `from=to` pairs separated by commas. Blank or malformed pairs are
 * skipped; the last pair for an id wins.
 * @internal Exported for tests only.
 */
export function parseOpenAiModelMap(raw: string | null | undefined): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const pair of (raw ?? '').split(',')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const from = pair.slice(0, eq).trim()
    const to = pair.slice(eq + 1).trim()
    if (from && to) map.set(from, to)
  }
  return map
}

/** The operator's model choices (see the file header). */
export interface OperatorModels {
  map: ReadonlyMap<string, string>
  chat?: string
  embedding?: string
}

/** OpenAI's embedding ids (`text-embedding-3-small`, `text-embedding-ada-002`). */
function isEmbeddingModelId(modelId: string): boolean {
  return /^text-embedding-/.test(modelId)
}

let envModels: OperatorModels | undefined

function operatorModels(): OperatorModels {
  if (!envModels) {
    const get = (k: string) => (typeof Deno !== 'undefined' ? Deno.env.get(k)?.trim() : undefined) || undefined
    envModels = {
      map: parseOpenAiModelMap(get('MUSHI_OPENAI_MODEL_MAP')),
      chat: get('MUSHI_OPENAI_MODEL'),
      embedding: get('MUSHI_OPENAI_EMBEDDING_MODEL'),
    }
  }
  return envModels
}

/**
 * The model id to send: the operator's rename for this id, else the
 * operator's chat or embedding model, else vendor-prefixed for OpenRouter,
 * else unchanged. A bare map is accepted too (older callers and tests).
 */
export function openAiCompatibleModelId(
  modelId: string,
  baseUrl: string | null | undefined,
  models: OperatorModels | ReadonlyMap<string, string> = operatorModels(),
): string {
  const op: OperatorModels = models instanceof Map ? { map: models } : (models as OperatorModels)
  const renamed = op.map.get(modelId)
  if (renamed) return renamed
  const chosen = isEmbeddingModelId(modelId) ? op.embedding : op.chat
  if (chosen) return chosen
  if (!isOpenRouterBaseUrl(baseUrl) || modelId.includes('/')) return modelId
  return `openai/${modelId}`
}
