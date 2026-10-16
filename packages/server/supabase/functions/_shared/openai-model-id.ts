/**
 * FILE: _shared/openai-model-id.ts
 * PURPOSE: The OpenRouter model-id rule from openai-compat.ts, without the
 *          `@ai-sdk/openai` import, so raw-fetch callers (embeddings) do not
 *          pull the AI SDK into the api function's boot graph (ai-sdk.ts).
 *
 * OpenRouter only accepts vendor-prefixed model ids (`openai/gpt-5.4`,
 * `openai/text-embedding-3-small`); Mushi's model constants are OpenAI's bare
 * ids, which OpenRouter rejects. openai-compat.ts re-exports both helpers.
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

/** The model id to send: vendor-prefixed for OpenRouter, unchanged elsewhere. */
export function openAiCompatibleModelId(modelId: string, baseUrl: string | null | undefined): string {
  if (!isOpenRouterBaseUrl(baseUrl) || modelId.includes('/')) return modelId
  return `openai/${modelId}`
}
