/**
 * FILE: firecrawl-trusted-hosts.test.ts
 * PURPOSE: The project domain allow-list limits URLs a person or a model
 *          chose. With it empty, production refused every scrape — including
 *          the changelog URLs the library modernizer builds on package
 *          registries, so it never read one. Only the modernizer's changelog
 *          scrape (firecrawlScrapeChangelog) lets those registry hosts past
 *          the allow-list; every other caller, and every other host, is still
 *          refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: vi.fn(async () => ({ key: 'fc-test', source: 'env', hint: '…test' })),
  markKeyUsed: vi.fn(async () => {}),
}))

const { firecrawlScrape, firecrawlScrapeChangelog, firecrawlScrapeOwnSite, CHANGELOG_HOSTS } = await import(
  '../../supabase/functions/_shared/firecrawl.ts'
)

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

describe('trusted changelog hosts', () => {
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

  it('lets the changelog scrape read a registry URL although the project allow-list is empty', async () => {
    const res = await firecrawlScrapeChangelog(makeDb(), 'p1', 'https://github.com/vercel-next.js/releases')
    expect(res.markdown).toContain('changelog')
    for (const host of CHANGELOG_HOSTS) {
      await expect(firecrawlScrapeChangelog(makeDb(), 'p1', `https://${host}/x`)).resolves.toBeTruthy()
    }
  })

  it('refuses any other host on the changelog scrape', async () => {
    await expect(firecrawlScrapeChangelog(makeDb(), 'p1', 'https://evil.example/x')).rejects.toThrow(
      'FIRECRAWL_DOMAIN_NOT_ALLOWED',
    )
  })

  it('a look-alike host is not a subdomain of a trusted one', async () => {
    await expect(
      firecrawlScrapeChangelog(makeDb(), 'p1', 'https://github.com.evil.example/x'),
    ).rejects.toThrow('FIRECRAWL_DOMAIN_NOT_ALLOWED')
  })

  it('gives every other caller no bypass: plain firecrawlScrape refuses registry hosts', async () => {
    await expect(firecrawlScrape(makeDb(), 'p1', 'https://github.com/a/b')).rejects.toThrow(
      'FIRECRAWL_DOMAIN_NOT_ALLOWED',
    )
  })

  it('ignores a trustedHosts option smuggled into firecrawlScrape', async () => {
    await expect(
      firecrawlScrape(makeDb(), 'p1', 'https://github.com/a/b', { trustedHosts: ['github.com'] } as never),
    ).rejects.toThrow('FIRECRAWL_DOMAIN_NOT_ALLOWED')
    expect(fetch).not.toHaveBeenCalled()
  })

  it("lets the story mapper read its own site's host and nothing else", async () => {
    const site = 'https://app.example.com/'
    await expect(firecrawlScrapeOwnSite(makeDb(), 'p1', 'https://app.example.com/pricing', site)).resolves.toBeTruthy()
    await expect(firecrawlScrapeOwnSite(makeDb(), 'p1', 'https://github.com/a/b', site)).rejects.toThrow(
      'FIRECRAWL_DOMAIN_NOT_ALLOWED',
    )
    await expect(
      firecrawlScrapeOwnSite(makeDb(), 'p1', 'https://app.example.com.evil.example/x', site),
    ).rejects.toThrow('FIRECRAWL_DOMAIN_NOT_ALLOWED')
  })
})
