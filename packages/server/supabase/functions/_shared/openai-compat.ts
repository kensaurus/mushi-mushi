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
  const make = ((modelId: string, settings?: unknown) =>
    jsonObjectMode((base as unknown as (id: string, s?: unknown) => unknown)(openAiCompatibleModelId(modelId, options.baseURL), settings))
  ) as unknown as OpenAiProvider
  return Object.assign(make, base)
}

/**
 * generateObject on an OpenAI-pool model asks for a JSON answer, never a
 * forced function call. With structured outputs off (the default here: our
 * schemas have optional fields strict mode rejects), AI SDK 1.x picked "tool"
 * mode, and OpenAI refuses function tools alongside a model's default
 * reasoning on chat completions ("Function tools with reasoning_effort are not
 * supported for gpt-6.1-sol", 2026-10-31). In "json" mode the SDK puts the
 * schema in the prompt and validates the answer, and the model keeps reasoning.
 * A model with structured outputs on already uses "json" with the strict schema.
 *
 * @internal Exported for tests only.
 */
export function jsonObjectMode<T>(model: T): T {
  const m = model as { defaultObjectGenerationMode?: string; supportsStructuredOutputs?: boolean } | null
  if (m && typeof m === 'object' && m.defaultObjectGenerationMode === 'tool' && !m.supportsStructuredOutputs) {
    Object.defineProperty(m, 'defaultObjectGenerationMode', { value: 'json', configurable: true })
  }
  return model
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
 * Optional sampling settings a model may refuse. OpenAI answers 400 with
 * `error.param` naming one ("Unsupported value: 'temperature' does not support
 * 0 with this model. Only the default (1) value is supported", gpt-6.1-sol,
 * 2026-10-31); dropping it keeps the model's default. Nothing else is dropped.
 */
const DROPPABLE_PARAMS = new Set(['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'seed'])
/** model → settings it refused in this isolate, so later calls skip the failed try. */
const refusedParams = new Map<string, Set<string>>()

/** Forget learned refusals (tests). */
export function clearRefusedOpenAiParams(): void {
  refusedParams.clear()
}

/**
 * Adapts chat-completion requests to what the model accepts:
 *  - `max_tokens` is sent as `max_completion_tokens`. OpenAI deprecated the old
 *    name, every current model takes the new one, and newer models refuse the
 *    old ("Use 'max_completion_tokens' instead", gpt-6.1-sol). AI SDK 1.x renames
 *    it only for models it knows.
 *  - an optional sampling setting the model refuses (DROPPABLE_PARAMS) is
 *    dropped and the request retried once; the refusal is remembered per model.
 * Only OpenAI's own host gets this: other OpenAI-compatible hosts may not know
 * the new name.
 *
 * @internal Exported for tests only.
 */
export function withMaxCompletionTokens(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!init?.body || typeof init.body !== 'string' || !url.endsWith('/chat/completions')) return inner(input, init)
    let body: Record<string, unknown>
    try {
      body = JSON.parse(init.body) as Record<string, unknown>
    } catch {
      return inner(input, init)
    }
    if ('max_tokens' in body) {
      const { max_tokens, ...rest } = body
      if (rest.max_completion_tokens === undefined) rest.max_completion_tokens = max_tokens
      body = rest
    }
    const model = typeof body.model === 'string' ? body.model : ''
    for (const param of refusedParams.get(model) ?? []) delete body[param]
    const send = (b: Record<string, unknown>) => inner(input, { ...init, body: JSON.stringify(b) })
    const res = await send(body)
    if (res.status !== 400) return res
    const refused = await refusedParam(res.clone())
    if (!refused || !(refused in body)) return res
    const known = refusedParams.get(model) ?? new Set<string>()
    known.add(refused)
    refusedParams.set(model, known)
    const { [refused]: _dropped, ...retry } = body
    return send(retry)
  }) as typeof fetch
}

/** The droppable setting a 400 names as unsupported, if any. */
async function refusedParam(res: Response): Promise<string | null> {
  try {
    const err = ((await res.json()) as { error?: { param?: unknown; code?: unknown; message?: unknown } }).error
    const param = typeof err?.param === 'string' ? err.param : null
    const unsupported = /unsupported/i.test(String(err?.code ?? '')) || /unsupported/i.test(String(err?.message ?? ''))
    return param && unsupported && DROPPABLE_PARAMS.has(param) ? param : null
  } catch {
    return null
  }
}
