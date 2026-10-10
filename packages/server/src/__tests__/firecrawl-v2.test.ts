/**
 * FILE: firecrawl-v2.test.ts
 * PURPOSE: The shared Firecrawl client speaks API v2: search groups results
 *          under `data.web`, takes `includeDomains` and `categories`, and map
 *          returns link objects. Reading a v2 reply with the v1 shape would
 *          return nothing and look like "no results".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: vi.fn(async () => ({ key: 'fc-test', source: 'env', hint: '…test' })),
  markKeyUsed: vi.fn(async () => {}),
}))

const { firecrawlSearch, firecrawlMap } = await import('../../supabase/functions/_shared/firecrawl.ts')

function makeDb() {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.gt = () => q
      q.maybeSingle = async () =>
        table === 'project_settings'
          ? { data: { firecrawl_allowed_domains: [], firecrawl_max_pages_per_call: 5 }, error: null }
          : { data: null, error: null }
      q.upsert = async () => ({ error: null })
      return q
    },
  } as never
}

let fetchMock: ReturnType<typeof vi.fn>
const sent = () => {
  const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
  return { url, body: JSON.parse(String(init.body)) as Record<string, unknown> }
}
function reply(json: unknown) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
}

describe('firecrawl v2 client', () => {
  beforeEach(() => vi.stubEnv('SUPABASE_ENV', 'production'))
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('search reads data.web and passes domains as includeDomains', async () => {
    reply({
      success: true,
      data: {
        web: [
          { url: 'https://github.com/a/b/issues/1', title: 'Issue', description: 'same error' },
          { url: 'https://evil.example/x', title: 'Off-domain', description: 'x' },
        ],
      },
    })
    const res = await firecrawlSearch(makeDb(), 'p1', 'TypeError: x is undefined', {
      domains: ['github.com', 'https://stackoverflow.com/'],
      bypassCache: true,
    })
    const { url, body } = sent()
    expect(url).toBe('https://api.firecrawl.dev/v2/search')
    expect(body).toMatchObject({ query: 'TypeError: x is undefined', includeDomains: ['github.com', 'stackoverflow.com'] })
    expect(body).not.toHaveProperty('categories')
    expect(res.map((r) => r.url)).toEqual(['https://github.com/a/b/issues/1'])
    expect(res[0]!.snippet).toBe('same error')
  })

  it('the developer index is a category, not combined with domains, and can skip page fetches', async () => {
    reply({ data: { web: [{ url: 'https://github.com/o/r/pull/9', title: 'fix', description: 'merged', category: 'developer' }] } })
    const res = await firecrawlSearch(makeDb(), 'p1', 'Request was aborted', {
      category: 'developer',
      domains: ['github.com'],
      scrape: false,
      bypassCache: true,
    })
    const { body } = sent()
    expect(body.categories).toEqual(['developer'])
    expect(body).not.toHaveProperty('includeDomains')
    expect(body).not.toHaveProperty('scrapeOptions')
    expect(res).toHaveLength(1)
  })

  it('still reads a v1-shaped flat array', async () => {
    reply({ data: [{ url: 'https://github.com/a/b', title: 't', description: 'd' }] })
    const res = await firecrawlSearch(makeDb(), 'p1', 'some query here', { bypassCache: true })
    expect(res).toHaveLength(1)
  })

  it('map returns URLs from v2 link objects and keeps the allow-list rule', async () => {
    reply({ success: true, links: [{ url: 'https://app.example/a', title: 'A' }, 'https://app.example/b'] })
    const links = await firecrawlMap(makeDb(), 'p1', 'https://app.example', { trustedHosts: ['app.example'] })
    expect(sent().url).toBe('https://api.firecrawl.dev/v2/map')
    expect(links).toEqual(['https://app.example/a', 'https://app.example/b'])
    await expect(firecrawlMap(makeDb(), 'p1', 'https://other.example')).rejects.toThrow('FIRECRAWL_DOMAIN_NOT_ALLOWED')
  })
})
