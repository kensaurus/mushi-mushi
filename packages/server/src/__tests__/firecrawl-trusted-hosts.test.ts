/**
 * FILE: firecrawl-trusted-hosts.test.ts
 * PURPOSE: The project domain allow-list limits URLs a person or a model
 *          chose. With it empty, production refused every scrape — including
 *          the changelog URLs the library modernizer builds on package
 *          registries, so it never read one. Trusted hosts pass; anything
 *          else is still refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: vi.fn(async () => ({ key: 'fc-test', source: 'env', hint: '…test' })),
  markKeyUsed: vi.fn(async () => {}),
}))

const { firecrawlScrape } = await import('../../supabase/functions/_shared/firecrawl.ts')

/** project_settings with an empty allow-list; an empty scrape cache. */
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

describe('firecrawlScrape trustedHosts', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_ENV', 'production')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { markdown: '# v2.0.0 changelog' } }), { status: 200 })),
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('scrapes a URL on a trusted host although the project allow-list is empty', async () => {
    const res = await firecrawlScrape(makeDb(), 'p1', 'https://github.com/vercel-next.js/releases', {
      trustedHosts: ['github.com'],
    })
    expect(res.markdown).toContain('changelog')
  })

  it('still refuses any other host, and refuses everything without trusted hosts', async () => {
    await expect(
      firecrawlScrape(makeDb(), 'p1', 'https://evil.example/x', { trustedHosts: ['github.com'] }),
    ).rejects.toThrow('FIRECRAWL_DOMAIN_NOT_ALLOWED')
    await expect(firecrawlScrape(makeDb(), 'p1', 'https://github.com/a/b')).rejects.toThrow(
      'FIRECRAWL_DOMAIN_NOT_ALLOWED',
    )
  })

  it('a look-alike host is not a subdomain of a trusted one', async () => {
    await expect(
      firecrawlScrape(makeDb(), 'p1', 'https://github.com.evil.example/x', { trustedHosts: ['github.com'] }),
    ).rejects.toThrow('FIRECRAWL_DOMAIN_NOT_ALLOWED')
  })
})
