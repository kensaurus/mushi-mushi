/**
 * FILE: _shared/openai-compat.ts
 * PURPOSE: One OpenAI-compatible client for every key in the OpenAI pool:
 *          OpenAI itself, an OpenAI-compatible host, or OpenRouter.
 *
 * OpenRouter only accepts vendor-prefixed model ids (`openai/gpt-5.4`,
 * `openai/text-embedding-3-small`); Mushi's model constants are OpenAI's bare
 * ids, which OpenRouter rejects. Checked against its public catalogue on
 * 2026-10-05: `gpt-5.4` is absent, `openai/gpt-5.4` present. `openAiProvider`
 * takes the same options as `createOpenAI` and qualifies the id when the base
 * URL is OpenRouter's; `openAiCompatibleModelId` does the same for raw fetches
 * (embeddings).
 */
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { isOpenRouterBaseUrl, openAiCompatibleModelId } from './openai-model-id.ts'

// The id rule lives in an npm-free module so raw-fetch callers can use it
// without loading the AI SDK. Inside the api function, import this module
// lazily (`await import(...)`) from the handler that calls a model.
export { isOpenRouterBaseUrl, openAiCompatibleModelId }

type OpenAiOptions = NonNullable<Parameters<typeof createOpenAI>[0]>
type OpenAiProvider = ReturnType<typeof createOpenAI>

/**
 * `createOpenAI` for any key in the OpenAI pool. Called as a function
 * (`provider(MODEL, settings)`), it sends the right model id for the key's
 * host. Pass the key's `baseUrl` as `baseURL` so an OpenRouter key is never
 * sent to api.openai.com (that 401s and marks the key auth_failed).
 */
export function openAiProvider(options: OpenAiOptions): OpenAiProvider {
  const base = createOpenAI(options)
  if (!isOpenRouterBaseUrl(options.baseURL)) return base
  const qualified = ((modelId: string, settings?: unknown) =>
    (base as unknown as (id: string, s?: unknown) => unknown)(
      openAiCompatibleModelId(modelId, options.baseURL),
      settings,
    )) as unknown as OpenAiProvider
  return Object.assign(qualified, base)
}
