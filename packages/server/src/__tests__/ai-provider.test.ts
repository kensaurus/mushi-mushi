/**
 * FILE: ai-provider.test.ts
 * PURPOSE: An organization can run its AI on OpenAI instead of Claude (ADR 0039
 *          amendment, 2026-10-31; the owner's Claude credits ran low). When it
 *          does, no Claude key reaches any caller: not its own pooled key, not
 *          a legacy field, not the platform's ANTHROPIC_API_KEY. A failed read
 *          keeps the default, so one bad row never moves spend to a vendor.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const provider = await import('../../supabase/functions/_shared/ai-provider.ts')
const byok = await import('../../supabase/functions/_shared/byok.ts')

const P = '542b34e0-019e-41fe-b900-7b637717bb86'
const ORG = '0f0e0d0c-0b0a-4908-8706-050403020100'

/** projects answers with the org's ai_provider; byok_keys holds one shared key per provider. */
function fakeDb(aiProvider: string | null | Error) {
  const reads = { projects: 0 }
  const keys = [
    { id: 'org-claude', provider_slug: 'anthropic' },
    { id: 'org-openai', provider_slug: 'openai' },
  ].map((k) => ({
    ...k,
    project_id: null,
    organization_id: ORG,
    vault_secret_id: k.id,
    label: null,
    priority: 1,
    status: 'active',
    cooldown_until: null,
    test_status: 'ok',
    base_url: null,
  }))
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: (col: string, v: unknown) => ((filters[col] = v), b),
        in: () => b,
        order: () => b,
        or: () => b,
        update: () => b,
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => {
          if (table !== 'projects') return Promise.resolve({ data: null, error: null })
          reads.projects++
          if (aiProvider instanceof Error) return Promise.reject(aiProvider)
          return Promise.resolve({ data: { organization_id: ORG, organizations: { ai_provider: aiProvider } }, error: null })
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
  return { db, reads }
}

const ENV = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  provider.clearAiProviderCache()
  process.env.ANTHROPIC_API_KEY = 'sk-ant-platform'
})
afterEach(() => {
  if (ENV === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = ENV
})

describe('aiProviderForProject', () => {
  it("reads the organization's choice, and caches it for a minute", async () => {
    const { db, reads } = fakeDb('openai')
    expect(await provider.aiProviderForProject(db, P, 1_000)).toBe('openai')
    expect(await provider.aiProviderForProject(db, P, 30_000)).toBe('openai')
    expect(reads.projects).toBe(1)
    await provider.aiProviderForProject(db, P, 62_000)
    expect(reads.projects).toBe(2)
  })

  it("keeps 'anthropic' when unset, unknown, or unreadable", async () => {
    for (const value of [null, 'gemini', new Error('db down')]) {
      provider.clearAiProviderCache()
      expect(await provider.aiProviderForProject(fakeDb(value).db, P)).toBe('anthropic')
    }
  })
})

describe('platformAnthropicKey', () => {
  it('hands out the platform Claude key only while the organization runs on Claude', async () => {
    expect(await provider.platformAnthropicKey(fakeDb('anthropic').db, P)).toBe('sk-ant-platform')
    provider.clearAiProviderCache()
    expect(await provider.platformAnthropicKey(fakeDb('openai').db, P)).toBeUndefined()
  })
})

describe('resolveLlmKeys on an OpenAI organization', () => {
  it('returns no Claude key at all, and still resolves the OpenAI key', async () => {
    const { db } = fakeDb('openai')
    expect(await byok.resolveLlmKeys(db, P, 'anthropic')).toEqual([])
    const openai = await byok.resolveLlmKeys(db, P, 'openai')
    expect(openai.map((k) => k.keyId)).toContain('org-openai')
  })

  it('a Claude organization still gets its Claude key first', async () => {
    const keys = await byok.resolveLlmKeys(fakeDb('anthropic').db, P, 'anthropic')
    expect(keys[0]).toMatchObject({ keyId: 'org-claude', source: 'byok' })
  })
})
