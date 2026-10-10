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

  it('a page the site blocks in robots.txt is not breakage', () => {
    // Verbatim from yen-yen's first check (2026-10-10); /feedback is disallowed on purpose.
    const error =
      "This URL is blocked by the website's robots.txt file, which instructs crawlers not to access this page. Firecrawl respects robots.txt by default. To crawl this URL anyway, set ignoreRobotsTxt: true in your crawl request (note: this may violate the website's crawling policies)."
    expect(sw.classifyPage({ url: 'https://kensaur.us/yen-yen/feedback', status: 'error', statusCode: null, error })).toBeNull()
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

describe('review fixes 2026-10-10', () => {
  it('the judge only counts for pages: a sitemap that changed is not broken', () => {
    const judged = { ...ok(`${BASE}/sitemap.xml`, 'changed'), judgment: { meaningful: true, reason: 'nearly empty' } }
    expect(sw.classifyPage({ ...judged, metadata: { contentType: 'application/xml; charset=utf-8' } })).toBeNull()
    expect(sw.classifyPage({ ...judged, metadata: { contentType: 'text/html' } })).toMatchObject({ problem: 'judged_broken' })
  })

  it('a load error files at medium; a 5xx at high', () => {
    const now = new Date('2026-10-11T00:00:00Z')
    const load = sw.buildSiteWatchReport('p1', `${BASE}/x`, { problem: 'load_error', statusCode: null, detail: 'timeout' }, null, now)
    const http = sw.buildSiteWatchReport('p1', `${BASE}/x`, { problem: 'http_error', statusCode: 502, detail: '502' }, null, now)
    expect(load.severity).toBe('medium')
    expect(http.severity).toBe('high')
  })

  it('when the last check read has dropped off the list, only the newest finished one is read', () => {
    const c = (id: string, status = 'completed') => ({ id, status })
    expect(sw.checksToProcess([c('12', 'running'), c('11'), c('10'), c('9')], 'gone').map((x) => x.id)).toEqual(['11'])
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

/**
 * A fake db with the parts of PostgREST processCheck uses: site_watch_pages
 * rows (unique per url, like the real table), reports, and filters on
 * update/delete (eq id, is/not resolved_at null). `shared` lets two
 * "polls" use one table to test the race.
 */
function makeDb(pages: Array<Record<string, unknown>> = [], opts: { failReports?: boolean } = {}) {
  const reports: Array<Record<string, unknown>> = []
  let seq = pages.length
  const db = {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      let op: 'select' | 'update' | 'delete' = 'select'
      let patch: Record<string, unknown> = {}
      let returning = false
      const rows = () => (table === 'site_watch_pages' ? pages : []).filter((r) => filters.every((f) => f(r)))
      const run = () => {
        if (op === 'update') {
          const hit = rows()
          hit.forEach((r) => Object.assign(r, patch))
          return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null }
        }
        if (op === 'delete') {
          for (const r of rows()) pages.splice(pages.indexOf(r), 1)
          return { data: null, error: null }
        }
        return { data: rows(), error: null }
      }
      const q: Record<string, unknown> = {
        select: () => ((returning = op !== 'select'), q),
        eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
        is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q),
        not: (col: string, _op: string, v: unknown) => (filters.push((r) => (r[col] ?? null) !== v), q),
        update: (p: Record<string, unknown>) => ((op = 'update'), (patch = p), q),
        delete: () => ((op = 'delete'), q),
        then: (resolve: (v: unknown) => void) => resolve(run()),
        insert: (row: Record<string, unknown>) => {
          if (table === 'reports') {
            if (opts.failReports) return Promise.resolve({ error: { message: 'boom' } })
            reports.push(row)
            return Promise.resolve({ error: null })
          }
          // site_watch_pages: unique (watch_id, url), like the real table.
          const clash = pages.some((p) => p.watch_id === row.watch_id && p.url === row.url)
          const created = clash ? null : { id: `p${++seq}`, ...row }
          if (created) pages.push(created)
          const result = clash
            ? { data: null, error: { code: '23505', message: 'duplicate key' } }
            : { data: { id: created!.id }, error: null }
          const chain = { select: () => chain, single: () => Promise.resolve(result), then: (r: (v: unknown) => void) => r(result) }
          return chain
        },
      }
      return q
    },
  }
  return { db: db as never, reports, pages }
}

describe('processCheck', () => {
  const watch = { id: 'w1', project_id: 'p1', base_url: BASE }
  const deps = { now: () => new Date('2026-10-11T01:35:00Z'), classify: vi.fn(async () => {}) }
  const broken = (path: string, code = 500) => ({ ...ok(`${BASE}${path}`), statusCode: code, metadata: { title: 'Page' } })
  afterEach(() => deps.classify.mockClear())

  it('files one report for a newly broken page and queues its diagnosis', async () => {
    const f = makeDb()
    const r = await sw.processCheck(f.db, watch, [ok(`${BASE}/terms`), broken('/pair')], deps)
    expect(r).toEqual({ broken: 1, filed: 1, resolved: 0 })
    expect(f.reports).toHaveLength(1)
    expect(f.reports[0]).toMatchObject({
      project_id: 'p1',
      source: 'site_watch',
      title: 'Live site: /help-her-take-photo/pair returns HTTP 500',
      severity: 'high',
      category: 'bug',
    })
    expect(f.pages[0]).toMatchObject({ url: `${BASE}/pair`, problem: 'http_error', status_code: 500, resolved_at: null, report_id: f.reports[0]!.id })
    expect(deps.classify).toHaveBeenCalledWith(f.db, f.reports[0]!.id, 'p1')
  })

  it('two polls reading the same check at once file the page once', async () => {
    const f = makeDb()
    const [a, b] = await Promise.all([
      sw.processCheck(f.db, watch, [broken('/pair')], deps),
      sw.processCheck(f.db, watch, [broken('/pair')], deps),
    ])
    expect(a.filed + b.filed).toBe(1)
    expect(f.reports).toHaveLength(1)
    expect(f.pages).toHaveLength(1)
    expect(deps.classify).toHaveBeenCalledTimes(1)
  })

  it('a burst of broken pages files one outage report, linked from every page', async () => {
    const f = makeDb()
    const many = Array.from({ length: 7 }, (_, i) => broken(`/p${i}`, 503))
    const r = await sw.processCheck(f.db, watch, many, deps)
    expect(r).toEqual({ broken: 7, filed: 1, resolved: 0 })
    expect(f.reports).toHaveLength(1)
    expect(f.reports[0]).toMatchObject({ title: 'Live site: 7 pages broke at once', severity: 'critical', source: 'site_watch' })
    expect(String(f.reports[0]!.description)).toContain(`${BASE}/p6`)
    expect(f.pages.every((p) => p.report_id === f.reports[0]!.id)).toBe(true)
    expect(deps.classify).toHaveBeenCalledTimes(1)
  })

  it('a failed report gives the claim back so the next poll files it', async () => {
    const f = makeDb([], { failReports: true })
    const r = await sw.processCheck(f.db, watch, [broken('/pair')], deps)
    expect(r.filed).toBe(0)
    expect(f.pages).toHaveLength(0)
    const g = makeDb(f.pages)
    expect((await sw.processCheck(g.db, watch, [broken('/pair')], deps)).filed).toBe(1)
  })

  it('stays quiet while the page is still broken', async () => {
    const f = makeDb([{ id: 'p1', watch_id: 'w1', url: `${BASE}/pair`, resolved_at: null, report_id: 'r1' }])
    const r = await sw.processCheck(f.db, watch, [broken('/pair')], deps)
    expect(r).toEqual({ broken: 1, filed: 0, resolved: 0 })
    expect(f.reports).toHaveLength(0)
    expect(f.pages[0]!.last_seen_at).toBe('2026-10-11T01:35:00.000Z')
  })

  it('resolves when the page loads again, and files again if it breaks later', async () => {
    const f = makeDb([{ id: 'p1', watch_id: 'w1', url: `${BASE}/pair`, resolved_at: null, report_id: 'r1' }])
    expect(await sw.processCheck(f.db, watch, [ok(`${BASE}/pair`)], deps)).toEqual({ broken: 0, filed: 0, resolved: 1 })
    expect(f.pages[0]!.resolved_at).toBe('2026-10-11T01:35:00.000Z')

    expect(await sw.processCheck(f.db, watch, [broken('/pair')], deps)).toEqual({ broken: 1, filed: 1, resolved: 0 })
    expect(f.reports).toHaveLength(1)
    expect(f.pages).toHaveLength(1)
    expect(f.pages[0]).toMatchObject({ resolved_at: null, report_id: f.reports[0]!.id })
  })

  it('resolves a page that was removed from the site or is now skipped on purpose', async () => {
    const f = makeDb([
      { id: 'p1', watch_id: 'w1', url: `${BASE}/old`, resolved_at: null, report_id: 'r1' },
      { id: 'p2', watch_id: 'w1', url: `${BASE}/feedback`, resolved_at: null, report_id: 'r2' },
    ])
    const r = await sw.processCheck(
      f.db,
      watch,
      [
        { ...ok(`${BASE}/old`), status: 'removed' },
        { url: `${BASE}/feedback`, status: 'error', statusCode: null, error: "This URL is blocked by the website's robots.txt file" },
      ],
      deps,
    )
    expect(r.resolved).toBe(2)
    expect(f.pages.every((p) => p.resolved_at === '2026-10-11T01:35:00.000Z')).toBe(true)
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
