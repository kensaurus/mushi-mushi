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
 * LM Studio) serves other model names, so `MUSHI_OPENAI_MODEL_MAP` renames
 * Mushi's ids on the way out: `gpt-6-luna=qwen3:8b,gpt-6.1-terra=qwen3:14b`.
 * A renamed id is sent exactly as written.
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

let envMap: ReadonlyMap<string, string> | undefined

function operatorModelMap(): ReadonlyMap<string, string> {
  if (!envMap) {
    const raw = typeof Deno !== 'undefined' ? Deno.env.get('MUSHI_OPENAI_MODEL_MAP') : undefined
    envMap = parseOpenAiModelMap(raw)
  }
  return envMap
}

/** The model id to send: the operator's rename if any, else vendor-prefixed for OpenRouter, else unchanged. */
export function openAiCompatibleModelId(
  modelId: string,
  baseUrl: string | null | undefined,
  modelMap: ReadonlyMap<string, string> = operatorModelMap(),
): string {
  const renamed = modelMap.get(modelId)
  if (renamed) return renamed
  if (!isOpenRouterBaseUrl(baseUrl) || modelId.includes('/')) return modelId
  return `openai/${modelId}`
}
