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
  const base = createOpenAI(isOpenAiHost(options.baseURL) ? { ...options, fetch: withMaxCompletionTokens(options.fetch ?? fetch) } : options)
  if (!isOpenRouterBaseUrl(options.baseURL)) return base
  const qualified = ((modelId: string, settings?: unknown) =>
    (base as unknown as (id: string, s?: unknown) => unknown)(
      openAiCompatibleModelId(modelId, options.baseURL),
      settings,
    )) as unknown as OpenAiProvider
  return Object.assign(qualified, base)
}

/** api.openai.com itself (no base URL means the SDK default, which is OpenAI's). */
function isOpenAiHost(baseURL: string | undefined): boolean {
  if (!baseURL) return true
  try {
    return new URL(baseURL).hostname === 'api.openai.com'
  } catch {
    return false
  }
}

/**
 * OpenAI deprecated `max_tokens` on chat completions for `max_completion_tokens`,
 * which every current model accepts, and newer ones refuse the old name
 * ("Unsupported parameter: 'max_tokens' … Use 'max_completion_tokens'
 * instead", gpt-6.1-sol, 2026-10-31). AI SDK 1.x renames it only for models it
 * knows, so every PR review failed once Mushi ran on OpenAI. Only OpenAI's own
 * host gets the rename: other OpenAI-compatible hosts may not know the new name.
 *
 * @internal Exported for tests only.
 */
export function withMaxCompletionTokens(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.body && typeof init.body === 'string' && url.endsWith('/chat/completions')) {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>
        if ('max_tokens' in body) {
          const { max_tokens, ...rest } = body
          if (rest.max_completion_tokens === undefined) rest.max_completion_tokens = max_tokens
          return inner(input, { ...init, body: JSON.stringify(rest) })
        }
      } catch {
        // Not JSON: send it as it is.
      }
    }
    return inner(input, init)
  }) as typeof fetch
}
