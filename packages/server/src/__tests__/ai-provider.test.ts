/**
 * FILE: ai-provider.test.ts
 * PURPOSE: An organization can run its AI on OpenAI instead of Claude (ADR 0039
 *          amendment, 2026-10-31; the owner's Claude credits ran low). When it
 *          does, no Claude key reaches any caller: not its own pooled key, not
 *          a legacy field, not the platform's ANTHROPIC_API_KEY. A failed read
 *          keeps the default, so one bad row never moves spend to a vendor,
 *          and it logs a warning, so a broken read never passes unnoticed.
 *
 *          The fake answers like PostgREST: an embed of organizations from
 *          projects errors with PGRST201. From 2026-11-17 the ops_mutes junction
 *          made that embed ambiguous, the provider read failed silently, and
 *          the OpenAI organization ran Claude calls on its byok keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const warn = vi.hoisted(() => vi.fn())
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = { info: () => {}, warn, error: () => {}, debug: () => {}, child: () => l }
  return { log: l }
})

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const provider = await import('../../supabase/functions/_shared/ai-provider.ts')
const byok = await import('../../supabase/functions/_shared/byok.ts')

const P = '542b34e0-019e-41fe-b900-7b637717bb86'
const ORG = '0f0e0d0c-0b0a-4908-8706-050403020100'

/** An embed of organizations from projects (or the reverse) errors like PostgREST did from 2026-11-17. */
const PGRST201 = { code: 'PGRST201', message: "Could not embed because more than one relationship was found for 'projects' and 'organizations'" }

/**
 * projects holds the app's organization_id; organizations holds its ai_provider;
 * byok_keys holds one shared key per provider. `aiProvider` an Error: the read
 * rejects. `{ error }`: the organizations read answers with that error.
 */
function fakeDb(aiProvider: string | null | Error | { error: { code: string; message: string } }, orgId: string | null = ORG) {
  const reads = { projects: 0, selects: [] as string[] }
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
      let columns = ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: (cols = '*') => ((columns = cols), reads.selects.push(`${table}:${cols}`), b),
        eq: (col: string, v: unknown) => ((filters[col] = v), b),
        in: () => b,
        order: () => b,
        or: () => b,
        update: () => b,
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => {
          if (table !== 'projects' && table !== 'organizations') return Promise.resolve({ data: null, error: null })
          if (/\b(organizations|projects)(!\w+)?\(/.test(columns)) return Promise.resolve({ data: null, error: PGRST201 })
          if (table === 'projects') {
            reads.projects++
            return Promise.resolve({ data: filters.id === P ? { organization_id: orgId } : null, error: null })
          }
          if (aiProvider instanceof Error) return Promise.reject(aiProvider)
          if (aiProvider && typeof aiProvider === 'object') return Promise.resolve({ data: null, error: aiProvider.error })
          return Promise.resolve({ data: filters.id === orgId ? { ai_provider: aiProvider } : null, error: null })
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
  warn.mockClear()
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

  it('reads with two plain selects, never an embed PostgREST can find ambiguous', async () => {
    const { db, reads } = fakeDb('openai')
    expect(await provider.aiProviderForProject(db, P)).toBe('openai')
    expect(reads.selects).toEqual(['projects:organization_id', 'organizations:ai_provider'])
  })

  it('logs a warning when the read errors or rejects, instead of failing open silently', async () => {
    for (const value of [{ error: PGRST201 }, new Error('db down')]) {
      provider.clearAiProviderCache()
      warn.mockClear()
      expect(await provider.aiProviderForProject(fakeDb(value).db, P)).toBe('anthropic')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][1]).toMatchObject({ projectId: P })
    }
  })

  it('does not cache a failed read, so the next call tries again', async () => {
    const { db, reads } = fakeDb({ error: PGRST201 })
    await provider.aiProviderForProject(db, P, 1_000)
    await provider.aiProviderForProject(db, P, 2_000)
    expect(reads.projects).toBe(2)
  })

  it('an app with no organization keeps the default without a warning', async () => {
    expect(await provider.aiProviderForProject(fakeDb('openai', null).db, P)).toBe('anthropic')
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('the platform Claude key', () => {
  it('is never handed out by the resolver: platform calls take it only through a KENSAURUS AI route', async () => {
    expect(await byok.resolveLlmKeys(fakeDb('anthropic', null).db, P, 'anthropic')).toEqual([])
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
