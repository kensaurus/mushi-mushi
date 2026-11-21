/**
 * FILE: packages/server/src/__tests__/llm-route-failover.test.ts
 * PURPOSE: The Claude-out-of-credit drill (owner, 2026-11-21: Claude down to
 *          $1.30, OpenAI at $221) against the KENSAURUS AI routes contract.
 *          Platform-key calls take provider, model and order from kenji
 *          `kensaurus_ai_routes` (here: a stubbed endpoint, or the baked
 *          OpenAI-first list when kenji cannot be read). Anthropic's real
 *          low-credit 400 is classified `payment` and falls over to the next
 *          candidate. An app's own Claude key (BYOK) keeps Claude first.
 *
 * Runs the real byok.ts → llm-failover.ts → kensaurus-ai-routes-client.ts
 * chain against a fake database; only the provider calls and kenji are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => l }
  return { log: l }
})
vi.mock('../../supabase/functions/_shared/hosted-llm-billing.ts', () => ({
  hostedLlmPreflight: async () => ({ allowed: true }),
  scheduleHostedLlmCharge: () => {},
  providerFromModel: () => 'openai',
  WalletDeniedError: class WalletDeniedError extends Error {},
}))

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const failover = await import('../../supabase/functions/_shared/llm-failover.ts')
const routes = await import('../../supabase/functions/_shared/kensaurus-ai-routes-client.ts')
const provider = await import('../../supabase/functions/_shared/ai-provider.ts')
const params = await import('../../supabase/functions/_shared/route-request-params.ts')

const P = '542b34e0-019e-41fe-b900-7b637717bb86'
const ORG = '0f0e0d0c-0b0a-4908-8706-050403020100'
const FAST = { feature: 'ask-mushi', tier: 'fast' as const }

/** Anthropic's answer to a spent account, as its SDK throws it (APIError, status 400). */
function lowCreditError(): Error {
  return Object.assign(new Error(`400 ${failover.ANTHROPIC_LOW_CREDIT_BODY}`), { status: 400 })
}

/** An app in an organization (Claude by default); `ownClaudeKey` adds one BYOK Claude key. */
function fakeDb(opts: { ownClaudeKey?: boolean; aiProvider?: 'anthropic' | 'openai' } = {}) {
  const keys = opts.ownClaudeKey
    ? [{
        id: 'own-claude', provider_slug: 'anthropic', project_id: P, organization_id: null, vault_secret_id: 'own-claude',
        label: null, priority: 1, status: 'active', cooldown_until: null, test_status: 'ok', base_url: null,
      }]
    : []
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b, in: () => b, order: () => b, or: () => b, is: () => b, update: () => b,
        eq: (col: string, v: unknown) => ((filters[col] = v), b),
        insert: () => Promise.resolve({ error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => {
          if (table === 'projects') return Promise.resolve({ data: { organization_id: ORG }, error: null })
          if (table === 'organizations') return Promise.resolve({ data: { ai_provider: opts.aiProvider ?? 'anthropic' }, error: null })
          return Promise.resolve({ data: null, error: null })
        },
        then(resolveFn: (v: unknown) => void) {
          if (table !== 'byok_keys') return resolveFn({ data: [], error: null })
          resolveFn({ data: keys.filter((k) => !filters.provider_slug || k.provider_slug === filters.provider_slug), error: null })
        },
      }
      return b
    },
    rpc: (_fn: string, args: { secret_id: string }) => Promise.resolve({ data: `secret-${args.secret_id}`, error: null }),
  } as never
}

/** kenji's routes endpoint answering with these candidates; every other URL (provider-ingest) answers 200. */
function stubKenji(candidates: Array<{ priority: number; provider: string; model: string; params?: Record<string, unknown> }>) {
  const calls: Array<{ url: string; body?: unknown; headers?: Record<string, string> }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers as Record<string, string> })
    if (url.includes('kensaurus-ai-routes')) {
      return new Response(JSON.stringify({ candidates: candidates.map((c) => ({ params: {}, provider_state: 'ok', ...c })) }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }))
  return calls
}

const ENV_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'KENSAURUS_ROUTES_TOKEN', 'KENSAURUS_WALLET_INTERNAL_TOKEN', 'KENSAURUS_ROUTES_URL', 'KENSAURUS_LLM_DRILL']
const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]))

beforeEach(() => {
  provider.clearAiProviderCache()
  routes.resetRoutesClient()
  process.env.ANTHROPIC_API_KEY = 'sk-ant-platform'
  process.env.OPENAI_API_KEY = 'sk-openai-platform'
  process.env.OPENROUTER_API_KEY = 'sk-or-platform'
  delete process.env.KENSAURUS_ROUTES_TOKEN
  delete process.env.KENSAURUS_WALLET_INTERNAL_TOKEN
  delete process.env.KENSAURUS_ROUTES_URL
  delete process.env.KENSAURUS_LLM_DRILL
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const n of ENV_NAMES) {
    if (saved[n] === undefined) delete process.env[n]
    else process.env[n] = saved[n]
  }
})

describe('Anthropic low-credit classification', () => {
  it("reads Anthropic's real low-credit 400 as payment, not quota, config or other", () => {
    expect(failover.classifyLlmError(lowCreditError())).toBe('payment')
    expect(failover.classifyLlmError(Object.assign(new Error('Insufficient credits'), { status: 402 }))).toBe('payment')
    expect(failover.classifyLlmError(new Error('429 insufficient_quota: You exceeded your current quota'))).toBe('payment')
    expect(routes.classifyProviderError(400, failover.ANTHROPIC_LOW_CREDIT_BODY)).toBe('payment')
    // A busy account is still quota, a bad key still auth.
    expect(failover.classifyLlmError(new Error('429 Too Many Requests'))).toBe('quota')
    expect(failover.classifyLlmError(new Error('401 invalid x-api-key'))).toBe('auth')
  })
})

describe('platform calls follow the KENSAURUS AI route', () => {
  it('without a kenji token (a self-host) it never calls kenji and runs the baked OpenAI-first list', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const claude = vi.fn(async () => 'claude')
    const out = await failover.withAnthropicOrOpenAi(fakeDb(), P, claude, async (k) => `${k.key} ${k.model}`, FAST)
    expect(out).toMatchObject({ result: 'sk-openai-platform gpt-6-luna', usedProvider: 'openai', model: 'gpt-6-luna', routeSource: 'baked', fallbackUsed: false, keySource: 'env' })
    expect(claude).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("takes the route's order and model from kenji, and a Claude low-credit 400 falls over to the next candidate", async () => {
    process.env.KENSAURUS_ROUTES_TOKEN = 'routes-token'
    const calls = stubKenji([
      { priority: 1, provider: 'anthropic', model: 'claude-haiku-5-5' },
      { priority: 2, provider: 'openai', model: 'gpt-6.1-terra' },
    ])
    const claude = vi.fn(async () => {
      throw lowCreditError()
    })
    const out = await failover.withAnthropicOrOpenAi(fakeDb(), P, claude, async (k) => `${k.key} ${k.model}`, FAST)
    expect(out).toMatchObject({ result: 'sk-openai-platform gpt-6.1-terra', model: 'gpt-6.1-terra', vendor: 'openai', fallbackUsed: true, routeSource: 'live' })
    expect(claude.mock.calls[0][0]).toMatchObject({ source: 'env', key: 'sk-ant-platform', model: 'claude-haiku-5-5' })
    expect(calls[0].url).toContain('app=mushi-mushi&feature=ask-mushi')
    expect(calls[0].headers?.['x-kensaurus-routes-token']).toBe('routes-token')
    // The spent account is reported to kenji's provider ingest (incident → Slack + Mushi ops).
    await new Promise((r) => setTimeout(r, 0))
    expect(calls.find((c) => c.url.includes('kensaurus-provider-ingest'))?.body).toMatchObject({
      project: 'mushi-mushi',
      incidents: [{ provider: 'anthropic', class: 'payment', app: 'mushi-mushi', feature: 'ask-mushi' }],
    })
  })

  it('OpenAI out of credit → OpenRouter on the route model; fallback_used only when priority 1 did not answer', async () => {
    const tried: string[] = []
    const openai = async (k: { key: string; model?: string }) => {
      tried.push(`${k.key}:${k.model}`)
      if (k.key === 'sk-openai-platform') throw new Error('429 insufficient_quota: You exceeded your current quota')
      return 'ok'
    }
    const out = await failover.withAnthropicOrOpenAi(fakeDb(), P, async () => 'claude', openai, FAST)
    expect(tried).toEqual(['sk-openai-platform:gpt-6-luna', 'sk-or-platform:openai/gpt-6-luna'])
    expect(out).toMatchObject({ vendor: 'openrouter', model: 'openai/gpt-6-luna', fallbackUsed: true })
  })

  it("an app's own Claude key still runs first, with the caller's model (BYOK untouched)", async () => {
    const claude = vi.fn(async (k: { keyId?: string; model?: string }) => `claude ${k.keyId} ${k.model ?? 'caller-model'}`)
    const openai = vi.fn(async () => 'openai')
    expect(await failover.withAnthropicOrOpenAi(fakeDb({ ownClaudeKey: true }), P, claude, openai, FAST)).toEqual({
      result: 'claude own-claude caller-model',
      usedProvider: 'anthropic',
      fallbackUsed: false,
      keySource: 'byok',
    })
    expect(openai).not.toHaveBeenCalled()
  })

  it('an organization that runs AI on OpenAI gets no Claude candidate from the route either', async () => {
    process.env.KENSAURUS_ROUTES_TOKEN = 'routes-token'
    stubKenji([{ priority: 1, provider: 'anthropic', model: 'claude-haiku-5-5' }, { priority: 2, provider: 'openai', model: 'gpt-6-luna' }])
    const claude = vi.fn(async () => 'claude')
    const out = await failover.withAnthropicOrOpenAi(fakeDb({ aiProvider: 'openai' }), P, claude, async () => 'openai', FAST)
    expect(out.usedProvider).toBe('openai')
    expect(claude).not.toHaveBeenCalled()
  })

  it('KENSAURUS_LLM_DRILL=anthropic:payment on a drill call: Claude fails without a request, OpenAI answers', async () => {
    process.env.KENSAURUS_ROUTES_TOKEN = 'routes-token'
    stubKenji([{ priority: 1, provider: 'anthropic', model: 'claude-haiku-5-5' }, { priority: 2, provider: 'openai', model: 'gpt-6-luna' }])
    process.env.KENSAURUS_LLM_DRILL = 'anthropic:payment'
    const claude = vi.fn(async () => 'claude')
    const out = await failover.withAnthropicOrOpenAi(fakeDb(), P, claude, async () => 'openai', { ...FAST, drill: true })
    expect(out).toMatchObject({ result: 'openai', fallbackUsed: true })
    expect(claude).not.toHaveBeenCalled()
    // Without `drill: true` the flag does nothing.
    const real = vi.fn(async () => 'claude')
    expect((await failover.withAnthropicOrOpenAi(fakeDb(), P, real, async () => 'openai', FAST)).result).toBe('claude')
  })

  it('a route row can point a provider at another secret (the dummy-key drill), and a missing key just skips it', async () => {
    process.env.KENSAURUS_ROUTES_TOKEN = 'routes-token'
    stubKenji([
      { priority: 1, provider: 'openai', model: 'gpt-6-luna', params: { secret_name: 'DRILL_DUMMY_OPENAI_KEY' } },
      { priority: 2, provider: 'openrouter', model: 'openai/gpt-6-luna' },
    ])
    const seen: string[] = []
    const out = await failover.withAnthropicOrOpenAi(fakeDb(), P, null, async (k) => (seen.push(k.key), 'ok'), FAST)
    expect(seen).toEqual(['sk-or-platform'])
    expect(out.vendor).toBe('openrouter')
  })

  it("applies the route row's params to that candidate's request only (Luna 'none' on OpenAI, reasoning.effort on OpenRouter)", async () => {
    process.env.KENSAURUS_ROUTES_TOKEN = 'routes-token'
    stubKenji([
      { priority: 1, provider: 'openai', model: 'gpt-6-luna', params: { reasoning_effort: 'none', body: { store: false } } },
      { priority: 2, provider: 'openrouter', model: 'openai/gpt-6-luna', params: { reasoning_effort: 'low' } },
    ])
    const seen: Array<Record<string, unknown>> = []
    await failover.withAnthropicOrOpenAi(fakeDb(), P, null, async (k) => {
      seen.push(params.applyRouteParams({ model: k.model }, `${k.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`))
      if (k.key === 'sk-openai-platform') throw new Error('429 insufficient_quota: You exceeded your current quota')
      return 'ok'
    }, FAST)
    expect(seen).toEqual([
      { model: 'gpt-6-luna', reasoning_effort: 'none', store: false },
      { model: 'openai/gpt-6-luna', reasoning: { effort: 'low' } },
    ])
    // Outside a route call (an app's own key) nothing is added.
    expect(params.applyRouteParams({ model: 'gpt-6-luna' }, 'https://api.openai.com/v1/chat/completions')).toEqual({ model: 'gpt-6-luna' })
  })

  it('no project (Ask Mushi without an app): only OpenAI-compatible candidates, and no Claude', async () => {
    const claude = vi.fn(async () => 'claude')
    const out = await failover.withPlatformRoute(fakeDb(), null, FAST, { anthropic: claude, openai: async (k) => k.model })
    expect(out.result).toBe('gpt-6-luna')
    expect(claude).not.toHaveBeenCalled()
  })
})
