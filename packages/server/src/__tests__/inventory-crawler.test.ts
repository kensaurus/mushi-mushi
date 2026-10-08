/**
 * inventory-crawler — pure helper tests.
 *
 * The Deno edge function uses `fetch` directly. We mock it via vi.stubGlobal
 * and exercise both the diff logic and the concurrency runner without
 * spinning up a real HTTP server.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  crawlPage,
  crawlVerdict,
  isDynamicPath,
  projectFirecrawlKey,
  renderUnverifiedPages,
  runWithConcurrency,
} from '../../supabase/functions/inventory-crawler/index.ts'

describe('runWithConcurrency', () => {
  it('processes every item even with concurrency > items.length', async () => {
    const items = [1, 2, 3]
    const out = await runWithConcurrency(items, async (n) => n * 2, 8)
    expect(out).toEqual([2, 4, 6])
  })

  it('caps in-flight workers', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 10 }, (_, i) => i)
    await runWithConcurrency(
      items,
      async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 10))
        inFlight -= 1
      },
      3,
    )
    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('crawlPage diff', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          `<html><body>
            <button data-testid="btn-submit">Submit</button>
            <a data-testid="lnk-streak" href="/streak">Streak</a>
            <script src="/api/practice/submit"></script>
          </body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        ),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an empty diff when discovery matches inventory', async () => {
    const r = await crawlPage(
      'https://example.com',
      { id: 'practice', path: '/practice' },
      ['btn-submit', 'lnk-streak'],
      {},
    )
    expect(r.status_code).toBe(200)
    expect(r.missing_in_app).toEqual([])
    expect(r.missing_in_inventory).toEqual([])
    expect(r.api_paths).toContain('/api/practice/submit')
  })

  it('flags missing-in-app when the inventory declares an unrendered testid', async () => {
    const r = await crawlPage(
      'https://example.com',
      { id: 'practice', path: '/practice' },
      ['btn-submit', 'btn-share'],
      {},
    )
    expect(r.missing_in_app).toEqual(['btn-share'])
  })

  it('flags missing-in-inventory when the page renders an undeclared testid', async () => {
    const r = await crawlPage(
      'https://example.com',
      { id: 'practice', path: '/practice' },
      ['btn-submit'],
      {},
    )
    expect(r.missing_in_inventory).toContain('lnk-streak')
  })

  it('records fetch failures as a structured error rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('refused')
      }),
    )
    const r = await crawlPage(
      'https://example.com',
      { id: 'practice', path: '/practice' },
      ['btn-submit'],
      {},
    )
    expect(r.error).toMatch(/refused/)
    expect(r.status_code).toBeNull()
  })
})

describe('what the edge crawl can check', () => {
  it('skips paths with a route parameter', () => {
    expect(isDynamicPath('/lessons/[lessonId]')).toBe(true)
    expect(isDynamicPath('/users/:id/edit')).toBe(true)
    expect(isDynamicPath('/practice')).toBe(false)
  })

  it('reports a page with none of its testids as unverified, not as N misses', () => {
    const none = { declared: ['a', 'b'], discovered: [] }
    expect(crawlVerdict(none, { authRequired: true, hasAuth: false })).toBe('unverified-auth')
    expect(crawlVerdict(none, { authRequired: false, hasAuth: false })).toBe('unverified-client')
    expect(crawlVerdict(none, { authRequired: true, hasAuth: true })).toBe('unverified-client')
  })

  it('keeps real misses when some declared testids rendered', () => {
    expect(crawlVerdict({ declared: ['a', 'b'], discovered: ['a'] }, { authRequired: true, hasAuth: false })).toBe('checked')
    expect(crawlVerdict({ declared: ['a'], discovered: [], error: 'timeout' }, { authRequired: true, hasAuth: false })).toBe('checked')
  })
})

describe('Firecrawl render of unverified pages', () => {
  type CrawlResult = Parameters<typeof renderUnverifiedPages>[0][number]
  const FIRECRAWL = 'https://api.firecrawl.dev/v2/scrape'
  const page = (path = '/practice', over: Partial<CrawlResult> = {}): CrawlResult => ({
    page_id: 'practice',
    path,
    status_code: 200,
    declared: ['btn-submit', 'btn-share'],
    discovered: [],
    missing_in_app: ['btn-submit', 'btn-share'],
    missing_in_inventory: [],
    ms: 1,
    html: '<div id="__next"></div>',
    href_paths: [],
    api_paths: [],
    ...over,
  })
  const opts = (over: Partial<Parameters<typeof renderUnverifiedPages>[1]> = {}) => ({
    baseUrl: 'https://example.com',
    urlOptions: { allowHosts: ['example.com'] },
    concurrency: 4,
    getKey: async () => ({ key: 'fc-test', keyId: 'key-1' }),
    ...over,
  })
  const firecrawlOk = (rawHtml: string, url = 'https://example.com/practice/') =>
    new Response(JSON.stringify({ success: true, data: { rawHtml, metadata: { url, statusCode: 200 } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const verdict = (r: CrawlResult) => crawlVerdict(r, { authRequired: false, hasAuth: false })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('checks the page against the rendered HTML when testids appear', async () => {
    const fetchMock = vi.fn(async () => firecrawlOk('<button data-testid="btn-submit">Go</button><span data-testid="extra"></span>'))
    vi.stubGlobal('fetch', fetchMock)

    const out = await renderUnverifiedPages([page()], opts())

    expect(out.rendered).toBe(1)
    expect(out.keyId).toBe('key-1')
    const r = out.results[0]!
    expect(r.rendered).toBe(true)
    expect(verdict(r)).toBe('checked')
    expect(r.missing_in_app).toEqual(['btn-share'])
    expect(r.missing_in_inventory).toEqual(['extra'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(input)).toBe(FIRECRAWL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fc-test')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ url: 'https://example.com/practice', formats: ['rawHtml'], onlyMainContent: false })
    expect(body).not.toHaveProperty('headers')
    expect(String(init.body)).not.toMatch(/cookie|authorization|fc-test/i)
  })

  it('keeps the page unverified when Firecrawl fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream error', { status: 500 })))
    const failed = await renderUnverifiedPages([page()], opts())
    expect(failed.rendered).toBe(0)
    expect(failed.results[0]!.rendered).toBeUndefined()
    expect(verdict(failed.results[0]!)).toBe('unverified-client')

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout')
    }))
    const timedOut = await renderUnverifiedPages([page()], opts())
    expect(timedOut.rendered).toBe(0)
    expect(verdict(timedOut.results[0]!)).toBe('unverified-client')
  })

  it('marks a render that still shows no testids, or redirects, as rendered but unverified', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => firecrawlOk('<main>Sign in</main>')))
    const none = await renderUnverifiedPages([page()], opts())
    expect(none.results[0]!.rendered).toBe(true)
    expect(verdict(none.results[0]!)).toBe('unverified-client')

    vi.stubGlobal('fetch', vi.fn(async () => firecrawlOk('<button data-testid="btn-submit"></button>', 'https://example.com/login')))
    const redirected = await renderUnverifiedPages([page()], opts())
    expect(redirected.results[0]!.rendered_to).toBe('/login')
    expect(verdict(redirected.results[0]!)).toBe('unverified-client')
  })

  it('never sends a disallowed host to Firecrawl, and ignores a render that lands off the allowlist', async () => {
    const fetchMock = vi.fn(async () => firecrawlOk('<button data-testid="btn-submit"></button>', 'https://evil.test/practice'))
    vi.stubGlobal('fetch', fetchMock)

    const blocked = await renderUnverifiedPages([page('https://evil.test/practice')], opts())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(blocked.rendered).toBe(0)

    const landedOff = await renderUnverifiedPages([page()], opts())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(landedOff.rendered).toBe(0)
    expect(verdict(landedOff.results[0]!)).toBe('unverified-client')
  })

  it('makes no Firecrawl call without a project key', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const out = await renderUnverifiedPages([page()], opts({ getKey: async () => null }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(out.rendered).toBe(0)
    expect(verdict(out.results[0]!)).toBe('unverified-client')
  })

  it('uses only a project BYOK key, never the platform env key', () => {
    expect(projectFirecrawlKey(null)).toBeNull()
    expect(projectFirecrawlKey({ key: 'fc-env', source: 'env', hint: '…env' })).toBeNull()
    expect(projectFirecrawlKey({ key: 'fc-own', keyId: 'k', source: 'byok', hint: '…own' })).toEqual({ key: 'fc-own', keyId: 'k' })
  })

  it('renders only unverified pages, up to the cap, and skips the key lookup when there are none', async () => {
    const fetchMock = vi.fn(async () => firecrawlOk('<button data-testid="btn-submit"></button>'))
    vi.stubGlobal('fetch', fetchMock)
    const getKey = vi.fn(async () => ({ key: 'fc-test' }))

    const checked = page('/practice', { discovered: ['btn-submit'] })
    const failed = page('/practice', { error: 'refused', status_code: null })
    await renderUnverifiedPages([checked, failed], opts({ getKey }))
    expect(getKey).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    const out = await renderUnverifiedPages([page(), page()], opts({ getKey, maxRenders: 1 }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(out.rendered).toBe(1)
    expect(out.results[1]!.rendered).toBeUndefined()
  })
})
