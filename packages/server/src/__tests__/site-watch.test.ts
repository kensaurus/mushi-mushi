/**
 * FILE: site-watch.test.ts
 * PURPOSE: Live-site watch (ADR 0024). Which monitor pages count as broken,
 *          which checks are read, and that a broken page files one report,
 *          stays quiet while still broken, resolves when it loads again and
 *          files again if it breaks later. Page shapes are copied from a real
 *          Firecrawl monitor check of kensaur.us/help-her-take-photo
 *          (2026-10-10), including a 404.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const sw = await import('../../supabase/functions/_shared/site-watch.ts')
type Page = Parameters<typeof sw.classifyPage>[0]

const BASE = 'https://kensaur.us/help-her-take-photo'
const ok = (url: string, status = 'same'): Page => ({ url, status, statusCode: 200, error: null, judgment: null, metadata: { title: 'Page' } })

describe('classifyPage', () => {
  it('a clean page, a new one and a removed one are not broken', () => {
    expect(sw.classifyPage(ok(`${BASE}/terms`))).toBeNull()
    expect(sw.classifyPage(ok(`${BASE}/terms`, 'new'))).toBeNull()
    expect(sw.classifyPage({ ...ok(`${BASE}/old`), status: 'removed' })).toBeNull()
  })

  it('a linked page that 404s or a 5xx is an HTTP error', () => {
    expect(sw.classifyPage({ ...ok(`${BASE}/this-page-does-not-exist`, 'new'), statusCode: 404, metadata: { title: '' } })).toMatchObject({
      problem: 'http_error',
      statusCode: 404,
      detail: 'The page returned HTTP 404 (not found).',
    })
    expect(sw.classifyPage({ ...ok(`${BASE}/pair`), statusCode: 502 })).toMatchObject({ problem: 'http_error', statusCode: 502 })
  })

  it('an auth wall or a rate limit is not breakage', () => {
    for (const code of [401, 403, 407, 429]) expect(sw.classifyPage({ ...ok(`${BASE}/account`), statusCode: code })).toBeNull()
  })

  it("Firecrawl's duplicate skip (a redirect or UTM variant) is not breakage", () => {
    // Verbatim from glot.it's first check (2026-10-10).
    const error =
      'This URL was not scraped because another scrape job in this same crawl or batch scrape has already scraped this URL (usually due to a redirect). This is an expected error used to prevent duplicate scrapes of the same URL and ensure efficiency. No action is needed - the content is already captured by the other scrape job.'
    expect(sw.classifyPage({ url: 'https://kensaur.us/glot-it/?utm_source=seo', status: 'error', statusCode: null, error })).toBeNull()
  })

  it('a page that fails to load, or a change the judge calls broken', () => {
    expect(sw.classifyPage({ url: `${BASE}/x`, status: 'error', statusCode: null, error: 'timeout' })).toMatchObject({
      problem: 'load_error',
      detail: 'timeout',
    })
    expect(
      sw.classifyPage({ ...ok(`${BASE}/pair`, 'changed'), judgment: { meaningful: true, reason: 'The page now shows "Application error".' } }),
    ).toMatchObject({ problem: 'judged_broken', detail: 'The page now shows "Application error".' })
    // A change the judge does not call broken is normal editing.
    expect(sw.classifyPage({ ...ok(`${BASE}/pair`, 'changed'), judgment: { meaningful: false, reason: 'copy edit' } })).toBeNull()
  })
})

describe('checksToProcess', () => {
  const c = (id: string, status = 'completed') => ({ id, status })
  it('finished checks newer than the last one read, oldest first', () => {
    expect(sw.checksToProcess([c('4', 'running'), c('3'), c('2', 'partial'), c('1')], '1').map((x) => x.id)).toEqual(['2', '3'])
  })
  it('nothing new when the newest finished check was read', () => {
    expect(sw.checksToProcess([c('2', 'queued'), c('1')], '1')).toEqual([])
  })
  it('skips failed and skipped checks; reads all on the first poll', () => {
    expect(sw.checksToProcess([c('3', 'failed'), c('2', 'skipped_no_credits'), c('1')], null).map((x) => x.id)).toEqual(['1'])
  })
})

/** A fake db: site_watch_pages rows, reports inserts, and recorded updates. */
function makeDb(pages: Array<Record<string, unknown>>) {
  const reports: Array<Record<string, unknown>> = []
  return {
    reports,
    pages,
    db: {
      from(table: string) {
        let filter: Record<string, unknown> = {}
        const q: Record<string, unknown> = {
          select: () => q,
          eq: (col: string, v: unknown) => ((filter[col] = v), q),
          then: (resolve: (v: unknown) => void) => resolve({ data: table === 'site_watch_pages' ? pages : [], error: null }),
          insert: (row: Record<string, unknown>) => {
            if (table === 'reports') reports.push(row)
            if (table === 'site_watch_pages') pages.push({ id: `p${pages.length + 1}`, ...row })
            return Promise.resolve({ error: null })
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: unknown) => {
              const row = pages.find((p) => p.id === id)
              if (row) Object.assign(row, patch)
              return Promise.resolve({ error: null })
            },
          }),
        }
        filter = {}
        return q
      },
    } as never,
  }
}

describe('processCheck', () => {
  const watch = { id: 'w1', project_id: 'p1', base_url: BASE }
  const deps = { now: () => new Date('2026-10-11T01:35:00Z'), classify: vi.fn(async () => {}) }
  const broken = { ...ok(`${BASE}/pair`), statusCode: 500, metadata: { title: 'Pair' } }
  afterEach(() => deps.classify.mockClear())

  it('files one report for a newly broken page and queues its diagnosis', async () => {
    const f = makeDb([])
    const r = await sw.processCheck(f.db, watch, [ok(`${BASE}/terms`), broken], deps)
    expect(r).toEqual({ broken: 1, filed: 1, resolved: 0 })
    expect(f.reports).toHaveLength(1)
    expect(f.reports[0]).toMatchObject({
      project_id: 'p1',
      source: 'site_watch',
      title: 'Live site: /help-her-take-photo/pair returns HTTP 500',
      severity: 'high',
      category: 'bug',
    })
    expect(f.pages[0]).toMatchObject({ url: `${BASE}/pair`, problem: 'http_error', status_code: 500, resolved_at: null })
    expect(deps.classify).toHaveBeenCalledWith(f.db, f.reports[0]!.id, 'p1')
  })

  it('stays quiet while the page is still broken', async () => {
    const f = makeDb([{ id: 'p1', url: `${BASE}/pair`, resolved_at: null, report_id: 'r1' }])
    const r = await sw.processCheck(f.db, watch, [broken], deps)
    expect(r).toEqual({ broken: 1, filed: 0, resolved: 0 })
    expect(f.reports).toHaveLength(0)
    expect(f.pages[0]!.last_seen_at).toBe('2026-10-11T01:35:00.000Z')
  })

  it('resolves when the page loads again, and files again if it breaks later', async () => {
    const f = makeDb([{ id: 'p1', url: `${BASE}/pair`, resolved_at: null, report_id: 'r1' }])
    expect(await sw.processCheck(f.db, watch, [ok(`${BASE}/pair`)], deps)).toEqual({ broken: 0, filed: 0, resolved: 1 })
    expect(f.pages[0]!.resolved_at).toBe('2026-10-11T01:35:00.000Z')

    expect(await sw.processCheck(f.db, watch, [broken], deps)).toEqual({ broken: 1, filed: 1, resolved: 0 })
    expect(f.reports).toHaveLength(1)
    expect(f.pages).toHaveLength(1)
    expect(f.pages[0]!.resolved_at).toBeNull()
  })

  it('a page dropped from the crawl does not resolve an open finding', async () => {
    const f = makeDb([{ id: 'p1', url: `${BASE}/pair`, resolved_at: null, report_id: 'r1' }])
    await sw.processCheck(f.db, watch, [{ ...ok(`${BASE}/pair`), status: 'removed' }], deps)
    expect(f.pages[0]!.resolved_at).toBeNull()
  })
})

describe('Firecrawl monitor calls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a daily crawl monitor with the breakage goal', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { id: 'mon-1', estimatedCreditsPerMonth: 660 } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await sw.createMonitor('fc-key', { name: 'watch', baseUrl: BASE, pageLimit: 25, scheduleCron: sw.DEFAULT_SCHEDULE_CRON })
    expect(res).toEqual({ id: 'mon-1', estimatedCreditsPerMonth: 660 })
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.dev/v2/monitor')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      schedule: { cron: '30 1 * * *', timezone: 'UTC' },
      goal: sw.SITE_WATCH_GOAL,
      targets: [{ type: 'crawl', url: BASE, crawlOptions: { limit: 25, ignoreQueryParameters: true } }],
    })
    expect(body).not.toHaveProperty('webhook')
  })

  it('reads every page of a check but follows only Firecrawl links', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { pages: [ok(`${BASE}/a`)] }, next: 'https://api.firecrawl.dev/v2/monitor/m/checks/c?skip=100' })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { pages: [ok(`${BASE}/b`)] }, next: 'https://evil.example/next' })))
    vi.stubGlobal('fetch', fetchMock)
    const pages = await sw.checkPages('fc-key', 'm', 'c')
    expect(pages.map((p) => p.url)).toEqual([`${BASE}/a`, `${BASE}/b`])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a monitor already gone counts as deleted; a 404 elsewhere is a typed error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    await expect(sw.deleteMonitor('fc-key', 'gone')).resolves.toBeUndefined()
    await expect(sw.listChecks('fc-key', 'gone')).rejects.toMatchObject({ status: 404, message: 'FIRECRAWL_MONITOR_NOT_FOUND' })
  })
})
