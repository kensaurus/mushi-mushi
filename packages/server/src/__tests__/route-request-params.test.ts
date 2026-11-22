/**
 * FILE: packages/server/src/__tests__/route-request-params.test.ts
 * PURPOSE: A KENSAURUS AI route row's params reach the request of the model it
 *          names (CONTRACT §7/§10), so a routed model cannot 400 for want of
 *          them: gpt-6.2-sol rejects reasoning_effort 'none' and its rows send
 *          'low'; Luna rows send 'none'. Outside a route call (an app's own
 *          key) nothing is added, and a caller's own setting always wins.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => l }
  return { log: l }
})
const seen: Array<{ baseURL?: string; fetch?: typeof fetch }> = []
vi.mock('npm:@ai-sdk/openai@1', () => ({
  createOpenAI: (opts: { baseURL?: string; fetch?: typeof fetch }) => {
    seen.push(opts)
    return Object.assign((id: string) => ({ id }), { embedding: (id: string) => ({ id }) })
  },
}))

const { runWithRouteParams } = await import('../../supabase/functions/_shared/route-request-params.ts')
const { openAiProvider } = await import('../../supabase/functions/_shared/openai-compat.ts')
const { requestFor } = await import('../../supabase/functions/_shared/claude-messages.ts')

/** The body the provider would receive for one chat-completions call on `baseURL`. */
async function sentBody(baseURL: string | undefined, body: Record<string, unknown>, params?: Record<string, unknown>) {
  seen.length = 0
  let out: Record<string, unknown> = {}
  const inner = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    out = JSON.parse(String(init?.body))
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  openAiProvider({ apiKey: 'k', fetch: inner, ...(baseURL ? { baseURL } : {}) })('m')
  const url = `${baseURL ?? 'https://api.openai.com/v1'}/chat/completions`
  const send = () => seen[0].fetch!(url, { method: 'POST', body: JSON.stringify(body) })
  await (params ? runWithRouteParams(params, send) : send())
  return out
}

describe('route params on the OpenAI family', () => {
  it("sends a Sol row's reasoning_effort 'low', its temperature and max_output_tokens on OpenAI", async () => {
    expect(await sentBody(undefined, { model: 'gpt-6.2-sol' }, { reasoning_effort: 'low', temperature: 0.2, max_output_tokens: 900 })).toEqual({
      model: 'gpt-6.2-sol',
      reasoning_effort: 'low',
      temperature: 0.2,
      max_completion_tokens: 900,
    })
  })

  it('sends reasoning.effort and max_tokens on OpenRouter, and merges a row body', async () => {
    expect(await sentBody('https://openrouter.ai/api/v1', { model: 'openai/gpt-6-luna' }, { reasoning_effort: 'none', max_output_tokens: 300, body: { provider: { sort: 'price' } } })).toEqual({
      model: 'openai/gpt-6-luna',
      reasoning: { effort: 'none' },
      max_tokens: 300,
      provider: { sort: 'price' },
    })
  })

  it("keeps the caller's own max tokens and temperature, and adds nothing outside a route call", async () => {
    expect(await sentBody(undefined, { model: 'gpt-6-luna', max_tokens: 50, temperature: 1 }, { max_output_tokens: 900, temperature: 0.2, reasoning_effort: 'none' })).toEqual({
      model: 'gpt-6-luna',
      max_completion_tokens: 50,
      temperature: 1,
      reasoning_effort: 'none',
    })
    expect(await sentBody(undefined, { model: 'gpt-6-luna', max_tokens: 50 })).toEqual({ model: 'gpt-6-luna', max_completion_tokens: 50 })
  })
})

describe('route params on Claude (claude-messages requestFor)', () => {
  const base = { apiKey: 'k', model: 'claude-sonnet-5-5', prompt: 'hi' }

  it("uses the row's thinking, effort and max_output_tokens when the caller set none", async () => {
    const body = await runWithRouteParams({ thinking: { type: 'adaptive' }, effort: 'low', max_output_tokens: 1234 }, async () => requestFor(base)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 1234, thinking: { type: 'adaptive' }, output_config: { effort: 'low' } })
  })

  it("lets the caller's effort and max tokens win, and adds nothing outside a route call", async () => {
    const body = await runWithRouteParams({ effort: 'high', max_output_tokens: 1234 }, async () => requestFor({ ...base, effort: 'medium', maxTokens: 500 })) as Record<string, unknown>
    expect(body).toMatchObject({ max_tokens: 500, output_config: { effort: 'medium' } })
    const plain = requestFor(base) as Record<string, unknown>
    expect(plain.thinking).toBeUndefined()
    expect(plain.max_tokens).toBe(16_000)
  })
})
