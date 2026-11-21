/**
 * FILE: packages/server/supabase/functions/_shared/route-request-params.ts
 * PURPOSE: A KENSAURUS AI route's request params (CONTRACT §7, §10) reach the
 *          chat-completions request of the candidate that runs them, without
 *          every call site passing them along.
 *
 * `withPlatformRoute` (llm-failover.ts) runs each OpenAI-family candidate
 * inside `runWithRouteParams`; the fetch wrapper in openai-compat.ts reads the
 * active params and adds them to the request body:
 *   - `reasoning_effort`: OpenAI takes `reasoning_effort`, OpenRouter
 *     `reasoning: { effort }`. Luna rows say 'none' (latency and cost), Sol
 *     rows 'low' (Sol refuses 'none').
 *   - `temperature`, `max_output_tokens`: used when the caller set none.
 *   - `body`: extra chat-completions fields from the row, merged in.
 * Claude calls read the same params in claude-messages.ts (`thinking`,
 * `effort`, `max_output_tokens`, `temperature`).
 * A field the caller already set wins. Only route calls carry params, so an
 * app's own key (BYOK) is never changed. Plain module (no npm), so the api
 * function's static graph stays small.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const active = new AsyncLocalStorage<Record<string, unknown>>()

/** Run `fn` with this route candidate's params active for its requests. */
export function runWithRouteParams<T>(params: Record<string, unknown> | undefined, fn: () => Promise<T>): Promise<T> {
  return params && Object.keys(params).length > 0 ? active.run(params, fn) : fn()
}

/**
/** The active route candidate's params, or undefined outside a route call. */
export function activeRouteParams(): Record<string, unknown> | undefined {
  return active.getStore()
}

/**
 * The chat-completions body with the active route params added. Unchanged
 * outside a route call, and for fields the caller set.
 *
 * @internal Exported for tests only.
 */
export function applyRouteParams(body: Record<string, unknown>, url: string): Record<string, unknown> {
  const params = active.getStore()
  if (!params) return body
  const out: Record<string, unknown> = { ...body }
  const extra = params.body
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [k, v] of Object.entries(extra as Record<string, unknown>)) if (!(k in out)) out[k] = v
  }
  if (typeof params.temperature === 'number' && !('temperature' in out)) out.temperature = params.temperature
  const maxOut = params.max_output_tokens
  if (typeof maxOut === 'number' && maxOut > 0 && !('max_tokens' in out) && !('max_completion_tokens' in out)) {
    // OpenAI's own host takes the new name; other OpenAI-compatible hosts the old one.
    if (/api\.openai\.com/i.test(url)) out.max_completion_tokens = maxOut
    else out.max_tokens = maxOut
  }
  const effort = params.reasoning_effort
  if (typeof effort === 'string' && effort) {
    if (/openrouter\.ai/i.test(url)) {
      if (!('reasoning' in out)) out.reasoning = { effort }
    } else if (!('reasoning_effort' in out)) {
      out.reasoning_effort = effort
    }
  }
  return out
}

/** Wrap a fetch so chat-completions requests carry the active route params. */
export function withRouteParamsFetch(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!active.getStore() || !init?.body || typeof init.body !== 'string' || !url.endsWith('/chat/completions')) {
      return inner(input, init)
    }
    try {
      const body = applyRouteParams(JSON.parse(init.body) as Record<string, unknown>, url)
      return inner(input, { ...init, body: JSON.stringify(body) })
    } catch {
      return inner(input, init)
    }
  }) as typeof fetch
}
