/**
 * FILE: packages/server/src/__tests__/hosted-llm-order.test.ts
 * PURPOSE: The Claude-out-of-credit drill (owner, 2026-11-21: Claude down to
 *          $1.30, OpenAI at $221). Mushi-hosted AI (the platform keys) runs on
 *          OpenAI first, then OpenRouter, then Claude last, by
 *          MUSHI_HOSTED_LLM_ORDER. A spent Claude account (Anthropic's real
 *          low-credit 400) is classified `payment` and falls over to OpenAI.
 *          An app's own Claude key (BYOK) keeps Claude first.
 *
 * Runs the real byok.ts → llm-failover.ts chain against a fake database, so
 * the resolver's order and the failover are the code under test; only the
 * provider calls are fakes.
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

const order = await import('../../supabase/functions/_shared/hosted-llm-order.ts')
const byok = await import('../../supabase/functions/_shared/byok.ts')
const failover = await import('../../supabase/functions/_shared/llm-failover.ts')
const provider = await import('../../supabase/functions/_shared/ai-provider.ts')

const P = '542b34e0-019e-41fe-b900-7b637717bb86'
const ORG = '0f0e0d0c-0b0a-4908-8706-050403020100'

/** Anthropic's answer to a spent account, as its SDK throws it (APIError, status 400). */
function lowCreditError(): Error {
  return Object.assign(new Error(`400 ${order.ANTHROPIC_LOW_CREDIT_BODY}`), { status: 400 })
}

/** An app in a Claude organization; `ownClaudeKey` adds one BYOK Claude key to its pool. */
function fakeDb(opts: { ownClaudeKey?: boolean } = {}) {
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
        select: () => b,
        eq: (col: string, v: unknown) => ((filters[col] = v), b),
        in: () => b,
        order: () => b,
        or: () => b,
        is: () => b,
        update: () => b,
        insert: () => Promise.resolve({ error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => {
          if (table === 'projects') return Promise.resolve({ data: { organization_id: ORG }, error: null })
          if (table === 'organizations') return Promise.resolve({ data: { ai_provider: 'anthropic' }, error: null })
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

const ENV_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'MUSHI_HOSTED_LLM_ORDER', 'MUSHI_LLM_DRILL']
const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]))

beforeEach(() => {
  provider.clearAiProviderCache()
  process.env.ANTHROPIC_API_KEY = 'sk-ant-platform'
  process.env.OPENAI_API_KEY = 'sk-openai-platform'
  process.env.OPENROUTER_API_KEY = 'sk-or-platform'
  delete process.env.MUSHI_HOSTED_LLM_ORDER
  delete process.env.MUSHI_LLM_DRILL
})
afterEach(() => {
  for (const n of ENV_NAMES) {
    if (saved[n] === undefined) delete process.env[n]
    else process.env[n] = saved[n]
  }
})

describe('MUSHI_HOSTED_LLM_ORDER parsing', () => {
  it('defaults to openai, openrouter, anthropic and drops unknown or repeated names', () => {
    expect(order.parseHostedLlmOrder(undefined)).toEqual(['openai', 'openrouter', 'anthropic'])
    expect(order.parseHostedLlmOrder(' gemini , ')).toEqual(['openai', 'openrouter', 'anthropic'])
    expect(order.parseHostedLlmOrder('Anthropic,openai,anthropic,x')).toEqual(['anthropic', 'openai'])
  })
})

describe('Anthropic low-credit classification', () => {
  it("reads Anthropic's real low-credit 400 as payment, not quota, config or other", () => {
    expect(failover.classifyLlmError(lowCreditError())).toBe('payment')
    expect(failover.classifyLlmError(new order.AnthropicLowCreditDrillError())).toBe('payment')
    expect(failover.classifyLlmError(Object.assign(new Error('Insufficient credits'), { status: 402 }))).toBe('payment')
    expect(failover.classifyLlmError(new Error('429 insufficient_quota: You exceeded your current quota'))).toBe('payment')
    // A busy account is still quota, a bad key still auth.
    expect(failover.classifyLlmError(new Error('429 Too Many Requests'))).toBe('quota')
    expect(failover.classifyLlmError(new Error('401 invalid x-api-key'))).toBe('auth')
  })
})

describe('platform keys follow the hosted order', () => {
  it('default: no platform Claude key up front; OpenAI then OpenRouter for the OpenAI pool', async () => {
    expect(await byok.resolveLlmKeys(fakeDb(), P, 'anthropic')).toEqual([])
    const pool = await byok.resolveLlmKeys(fakeDb(), P, 'openai')
    expect(pool.map((k) => [k.source, k.hint, k.provider ?? 'openai', k.baseUrl ?? null])).toEqual([
      ['env', expect.any(String), 'openai', null],
      ['env', expect.any(String), 'openrouter', byok.OPENROUTER_BASE_URL],
    ])
    expect(pool[0].key).toBe('sk-openai-platform')
    // Speech-to-text and fine-tuning only run on OpenAI itself.
    expect((await byok.resolveLlmKeys(fakeDb(), P, 'openai', { openAiOnly: true })).map((k) => k.key)).toEqual(['sk-openai-platform'])
    // The last-resort leg may still ask for it.
    expect((await byok.resolveLlmKeys(fakeDb(), P, 'anthropic', { hostedClaude: true })).map((k) => k.key)).toEqual(['sk-ant-platform'])
  })

  it('a vendor left out of the order is never used; Anthropic first restores the old order', async () => {
    process.env.MUSHI_HOSTED_LLM_ORDER = 'openai'
    expect(await byok.resolveLlmKeys(fakeDb(), P, 'anthropic', { hostedClaude: true })).toEqual([])
    expect((await byok.resolveLlmKeys(fakeDb(), P, 'openai')).map((k) => k.key)).toEqual(['sk-openai-platform'])
    process.env.MUSHI_HOSTED_LLM_ORDER = 'anthropic,openrouter,openai'
    expect((await byok.resolveLlmKeys(fakeDb(), P, 'anthropic')).map((k) => k.key)).toEqual(['sk-ant-platform'])
    expect((await byok.resolveLlmKeys(fakeDb(), P, 'openai')).map((k) => k.key)).toEqual(['sk-or-platform', 'sk-openai-platform'])
  })

  it("an app's own Claude key is untouched by the order", async () => {
    const keys = await byok.resolveLlmKeys(fakeDb({ ownClaudeKey: true }), P, 'anthropic')
    expect(keys.map((k) => [k.keyId, k.source])).toEqual([['own-claude', 'byok']])
  })
})

describe('withAnthropicOrOpenAi: the drill', () => {
  it('Claude first by config + its real low-credit 400 → OpenAI answers', async () => {
    process.env.MUSHI_HOSTED_LLM_ORDER = 'anthropic,openai,openrouter'
    const claude = vi.fn(async () => {
      throw lowCreditError()
    })
    const openai = vi.fn(async (k: { key: string }) => `answered on ${k.key}`)
    const out = await failover.withAnthropicOrOpenAi(fakeDb(), P, claude, openai)
    expect(out).toEqual({ result: 'answered on sk-openai-platform', usedProvider: 'openai' })
    expect(claude).toHaveBeenCalledTimes(1)
    expect(claude.mock.calls[0][0]).toMatchObject({ source: 'env', key: 'sk-ant-platform' })
  })

  it('MUSHI_LLM_DRILL=anthropic_no_credit: the platform Claude call fails without a request, OpenAI answers', async () => {
    process.env.MUSHI_HOSTED_LLM_ORDER = 'anthropic,openai'
    process.env.MUSHI_LLM_DRILL = 'anthropic_no_credit'
    const claude = vi.fn(async () => 'claude')
    const out = await failover.withAnthropicOrOpenAi(fakeDb(), P, claude, async () => 'openai')
    expect(out.usedProvider).toBe('openai')
    expect(claude).not.toHaveBeenCalled()
    // Single-key callers (classify-report, judge-batch, …) see no platform Claude key.
    expect(await byok.resolveLlmKey(fakeDb(), P, 'anthropic')).toBeNull()
    expect(await provider.platformAnthropicKey(fakeDb(), P)).toBeUndefined()
  })

  it('default order: a hosted call never touches Claude when OpenAI answers', async () => {
    const claude = vi.fn(async () => 'claude')
    const out = await failover.withAnthropicOrOpenAi(fakeDb(), P, claude, async (k) => k.key)
    expect(out).toEqual({ result: 'sk-openai-platform', usedProvider: 'openai' })
    expect(claude).not.toHaveBeenCalled()
  })

  it('OpenAI out of credit → OpenRouter; both spent → the platform Claude key last', async () => {
    const tried: string[] = []
    const openai = vi.fn(async (k: { key: string }) => {
      tried.push(k.key)
      if (k.key === 'sk-openai-platform') throw new Error('429 insufficient_quota: You exceeded your current quota')
      return 'openrouter answered'
    })
    expect((await failover.withAnthropicOrOpenAi(fakeDb(), P, async () => 'claude', openai)).result).toBe('openrouter answered')
    expect(tried).toEqual(['sk-openai-platform', 'sk-or-platform'])

    const spent = async () => {
      throw Object.assign(new Error('Insufficient credits'), { status: 402 })
    }
    const claude = vi.fn(async (k: { key: string; source: string }) => `claude on ${k.source}`)
    expect(await failover.withAnthropicOrOpenAi(fakeDb(), P, claude, spent)).toEqual({ result: 'claude on env', usedProvider: 'anthropic' })
    expect(claude).toHaveBeenCalledTimes(1)
  })

  it("an app's own Claude key still runs first under the default order (BYOK untouched)", async () => {
    const claude = vi.fn(async (k: { keyId?: string }) => `claude ${k.keyId}`)
    const openai = vi.fn(async () => 'openai')
    expect(await failover.withAnthropicOrOpenAi(fakeDb({ ownClaudeKey: true }), P, claude, openai)).toEqual({
      result: 'claude own-claude',
      usedProvider: 'anthropic',
    })
    expect(openai).not.toHaveBeenCalled()
  })
})
