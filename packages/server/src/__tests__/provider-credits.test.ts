/**
 * Remaining credits per BYOK key, from the providers that publish a balance
 * (shapes from their docs, 2026-10-04).
 */
import { describe, expect, it } from 'vitest'
import { fetchProviderCredits, isOpenRouterBaseUrl } from '../../supabase/functions/_shared/provider-credits.ts'

function fakeFetch(map: Record<string, { status: number; body: unknown }>) {
  const calls: Array<{ url: string; auth: string | null }> = []
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') })
    const hit = map[url]
    if (!hit) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(hit.body), { status: hit.status })
  }
  return { impl, calls }
}

describe('fetchProviderCredits', () => {
  it('reads Firecrawl remaining and plan credits', async () => {
    const f = fakeFetch({
      'https://api.firecrawl.dev/v2/team/credit-usage': {
        status: 200,
        body: { success: true, data: { remainingCredits: 812, planCredits: 1000, billingPeriodEnd: '2026-10-31T23:59:59Z' } },
      },
    })
    const r = await fetchProviderCredits('firecrawl', 'fc-test', null, f.impl)
    expect(r).toEqual({ kind: 'credits', remaining: 812, unit: 'credits', limit: 1000, used: 188, periodEnd: '2026-10-31T23:59:59Z', source: 'Firecrawl /v2/team/credit-usage' })
    expect(f.calls[0].auth).toBe('Bearer fc-test')
  })

  it('reads an OpenRouter key through the OpenAI provider when the base URL is OpenRouter', async () => {
    const f = fakeFetch({
      'https://openrouter.ai/api/v1/key': { status: 200, body: { data: { limit: 10, limit_remaining: 6.42, usage: 3.58 } } },
    })
    const r = await fetchProviderCredits('openai', 'sk-or-test', 'https://openrouter.ai/api/v1', f.impl)
    expect(r).toMatchObject({ kind: 'credits', remaining: 6.42, unit: 'usd', limit: 10, used: 3.58 })
  })

  it('says a native OpenAI or Anthropic key has no balance API, without calling anything', async () => {
    const f = fakeFetch({})
    for (const p of ['openai', 'anthropic', 'cursor']) {
      const r = await fetchProviderCredits(p, 'k', null, f.impl)
      expect(r.kind).toBe('unavailable')
    }
    expect(f.calls).toHaveLength(0)
  })

  it('reports a provider error instead of throwing', async () => {
    const f = fakeFetch({ 'https://api.firecrawl.dev/v2/team/credit-usage': { status: 401, body: { error: 'Unauthorized' } } })
    const r = await fetchProviderCredits('firecrawl', 'bad', null, f.impl)
    expect(r.kind).toBe('error')
    const thrower = async () => { throw new Error('socket hang up') }
    expect((await fetchProviderCredits('firecrawl', 'k', null, thrower)).kind).toBe('error')
  })
})

describe('isOpenRouterBaseUrl', () => {
  it('matches only openrouter.ai hosts', () => {
    expect(isOpenRouterBaseUrl('https://openrouter.ai/api/v1')).toBe(true)
    expect(isOpenRouterBaseUrl('https://api.openai.com/v1')).toBe(false)
    expect(isOpenRouterBaseUrl('https://openrouter.ai.evil.com/v1')).toBe(false)
    expect(isOpenRouterBaseUrl(null)).toBe(false)
  })
})
