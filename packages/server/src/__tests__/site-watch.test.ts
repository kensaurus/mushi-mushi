/**
 * FILE: site-watch.test.ts
 * PURPOSE: Live-site watch (ADR 0024, filing rule ADR 0029). Which monitor
 *          pages count as broken, which checks are read, and that a broken
 *          page files only when it is seen failing a second time (a confirm
 *          scrape, or two checks in a row for an HTTP error or load failure),
 *          stays quiet while still broken, resolves when it loads again and
 *          needs a second observation again if it breaks later. Page shapes
 *          are copied from a real Firecrawl monitor check of
 *          kensaur.us/help-her-take-photo (2026-10-10), including a 404; the
 *          false-positive shapes are the ones coding agents found on pages
 *          that were fine (2026-10).
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

// ── False-positive and real-outage fixtures ─────────────────────────────

/** What a confirm scrape returns for a page that rendered (markdown, main content only). */
const loaded = (markdown: string, statusCode: number | null = 200, title: string | null = 'Page') => ({
  kind: 'loaded' as const,
  statusCode,
  markdown,
  title,
  contentType: 'text/html; charset=utf-8',
})

/** A docs route's first frame: still on DocsRouteLoading, only the skip link in the DOM. */
const SKIP_LINK_FRAME = '[Skip to content](#main-content)'
/** The same route ~500 ms later: the article. */
const SETTLED_ARTICLE =
  '[Skip to content](#main-content)\n\n# Getting started\n\nInstall the SDK with your package manager, then call `initMushi()` once ' +
  'at startup with your project id and API key. The widget appears in the corner of every page, and reports arrive in the ' +
  'console with a screenshot, the console log and the route the user was on.\n\n## Next steps\n\nConnect your repo so fixes open as pull requests.'
/** The boot card in index.html before the SPA hydrates (/legal/ai-disclaimer, ~4.5 s cold). */
const BOOT_CARD = '読み込み中\n\nヒント: 1日5分でも、毎日続けると上達が早くなります。'
/** /legal/ai-disclaimer after hydration. */
const SETTLED_LEGAL =
  '# AI生成コンテンツに関する免責事項\n\n本サービスの解説、例文、翻訳の一部はAIによって生成されています。AIの出力には誤りが含まれる可能性があり、' +
  '内容の正確性、完全性、最新性を保証するものではありません。学習の参考としてご利用いただき、重要な判断の前には信頼できる情報源で確認してください。' +
  '誤りを見つけた場合は、各ページのフィードバックボタンからお知らせください。いただいた報告は確認のうえ順次修正します。'
/** The public demo's status line while GET /api/public/demo/stats is in flight. */
const DEMO_STATUS_LINE = '「接続確認中…」'
/** The shop page: a full catalog, and an error panel's copy that never mounted (empty role="alert" in the shell). */
const SHOP_CATALOG =
  '# Shop\n\nSomething went wrong. Try again.\n\n' +
  Array.from({ length: 8 }, (_, i) => `## Print no. ${i + 1}\n\nA4 giclée print on cotton rag paper, signed. ¥${3000 + i * 500}\n\n[Add to cart](#)`).join(
    '\n\n',
  )

describe('judge fail-open is not evidence', () => {
  const changed = (judgment: Page['judgment']): Page => ({ ...ok(`${BASE}/pair`, 'changed'), judgment })

  it('"defaulting to meaningful" is a suspect flagged fail-open, not the judge\'s words', () => {
    // Verbatim from Firecrawl's change-monitor judge on a page that was fine (2026-10).
    const p = sw.classifyPage(changed({ meaningful: true, reason: 'Judge response not valid JSON — defaulting to meaningful' }))
    expect(p).toMatchObject({ problem: 'judged_broken', judgeFailOpen: true })
    expect(p!.detail).not.toMatch(/defaulting/)
  })

  it('a low-confidence "meaningful" is fail-open too; a confident one is not', () => {
    expect(sw.classifyPage(changed({ meaningful: true, confidence: 'low', reason: 'maybe empty' }))).toMatchObject({ judgeFailOpen: true })
    const confident = sw.classifyPage(changed({ meaningful: true, confidence: 'high', reason: 'The page now shows "Application error".' }))
    expect(confident).toMatchObject({ problem: 'judged_broken', detail: 'The page now shows "Application error".' })
    expect(confident!.judgeFailOpen).toBeUndefined()
  })
})

describe('judgeConfirmation: does the settled page still fail?', () => {
  it('a skip-link-only first frame is broken; the settled article is not', () => {
    expect(sw.judgeConfirmation(loaded(SKIP_LINK_FRAME))).toMatchObject({ outcome: 'broken' })
    expect(sw.judgeConfirmation(loaded(SKIP_LINK_FRAME)).detail).toMatch(/only a skip link/)
    expect(sw.judgeConfirmation(loaded(SETTLED_ARTICLE))).toMatchObject({ outcome: 'healthy', statusCode: 200 })
  })

  it('a boot card or a mid-request status line is a loading screen; the hydrated page is not', () => {
    expect(sw.judgeConfirmation(loaded(BOOT_CARD)).detail).toMatch(/loading screen/)
    expect(sw.judgeConfirmation(loaded(DEMO_STATUS_LINE))).toMatchObject({ outcome: 'broken' })
    expect(sw.judgeConfirmation(loaded(SETTLED_LEGAL))).toMatchObject({ outcome: 'healthy' })
  })

  it('error-panel copy beside real content is not an error screen', () => {
    expect(sw.judgeConfirmation(loaded(SHOP_CATALOG))).toMatchObject({ outcome: 'healthy' })
    expect(sw.judgeConfirmation(loaded('# Application error: a client-side exception has occurred'))).toMatchObject({ outcome: 'broken' })
  })

  it('a page that stays blank, a 5xx or a 404 that reproduces, and a 408 are broken', () => {
    expect(sw.judgeConfirmation(loaded('   \n'))).toMatchObject({ outcome: 'broken', detail: expect.stringMatching(/still blank/) })
    expect(sw.judgeConfirmation(loaded('<h1>502 Bad Gateway</h1>', 502))).toMatchObject({ outcome: 'broken', statusCode: 502 })
    expect(sw.judgeConfirmation(loaded('# Not found', 404))).toMatchObject({ outcome: 'broken', statusCode: 404 })
    expect(sw.judgeConfirmation({ kind: 'timed_out', error: 'Request Timeout' })).toMatchObject({ outcome: 'broken' })
  })

  it('an auth wall, a Firecrawl failure or an empty answer decides nothing', () => {
    expect(sw.judgeConfirmation(loaded('Sign in', 403))).toMatchObject({ outcome: 'inconclusive' })
    expect(sw.judgeConfirmation({ kind: 'unavailable', reason: 'FIRECRAWL_HTTP_502' })).toMatchObject({ outcome: 'inconclusive' })
    expect(sw.judgeConfirmation(loaded('', null))).toMatchObject({ outcome: 'inconclusive' })
  })

  it('a non-HTML page that loads is healthy', () => {
    expect(sw.judgeConfirmation({ ...loaded(''), contentType: 'application/xml' })).toMatchObject({ outcome: 'healthy' })
  })
})

describe('confirmScrape', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks /v2/scrape for a fresh, settled page with only documented parameters', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ success: true, data: { markdown: SETTLED_ARTICLE, metadata: { statusCode: 200, title: ['Docs'], contentType: 'text/html' } } }),
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await sw.confirmScrape('fc-key', `${BASE}/docs`)
    expect(r).toEqual({ kind: 'loaded', statusCode: 200, markdown: SETTLED_ARTICLE, title: 'Docs', contentType: 'text/html' })
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.dev/v2/scrape')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fc-key')
    expect(JSON.parse(String(init.body))).toEqual({
      url: `${BASE}/docs`,
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: sw.CONFIRM_WAIT_MS,
      timeout: sw.CONFIRM_TIMEOUT_MS,
      maxAge: 0,
      headers: { 'User-Agent': sw.SITE_WATCH_USER_AGENT },
    })
    expect(sw.CONFIRM_WAIT_MS).toBeGreaterThanOrEqual(5_000)
    expect(sw.CONFIRM_WAIT_MS).toBeLessThanOrEqual(60_000)
  })

  it("keeps the site's error status; 408 is a page that did not load; Firecrawl's own failures say nothing", async () => {
    const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
    answer(200, { success: true, data: { markdown: 'Bad gateway', metadata: { statusCode: 502 } } })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toMatchObject({ kind: 'loaded', statusCode: 502 })
    answer(408, { success: false, error: 'Request Timeout' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toEqual({ kind: 'timed_out', error: 'Request Timeout' })
    answer(402, { success: false, error: 'Payment Required: Insufficient credits' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toEqual({ kind: 'unavailable', reason: 'FIRECRAWL_NO_CREDITS' })
    answer(500, { success: false, code: 'UNKNOWN_ERROR', error: 'An unexpected error occurred on the server.' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toMatchObject({ kind: 'unavailable' })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))))
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toMatchObject({ kind: 'unavailable' })
  })
})

// ── Recording checks and filing ─────────────────────────────────────────

const watch = { id: 'w1', project_id: 'p1', base_url: BASE }
const broken = (path: string, code = 500): Page => ({ ...ok(`${BASE}${path}`), statusCode: code, metadata: { title: 'Page' } })
const judged = (path: string, reason: string, confidence = 'high'): Page => ({
  ...ok(`${BASE}${path}`, 'changed'),
  judgment: { meaningful: true, confidence, reason },
})
/** A filed, still-open finding as it is after the migration. */
const filedRow = (id: string, path: string) => ({
  id,
  watch_id: 'w1',
  url: `${BASE}${path}`,
  problem: 'http_error',
  resolved_at: null,
  report_id: `r-${id}`,
  confirmed_at: '2026-10-10T01:35:00.000Z',
  fail_streak: 0,
  confirm_attempts: 0,
})

function harness(seed: Array<Record<string, unknown>> = [], opts: { failReports?: boolean } = {}) {
  const f = makeDb(seed, opts)
  let clock = new Date('2026-10-21T01:35:00Z')
  const confirm = vi.fn(async (_url: string): Promise<Awaited<ReturnType<typeof sw.confirmScrape>>> => ({ kind: 'unavailable', reason: 'not stubbed' }))
  const classify = vi.fn(async () => {})
  const budget = { remaining: 100, deadline: Number.MAX_SAFE_INTEGER }
  const deps = { now: () => clock, classify, confirm, budget }
  return {
    ...f,
    confirm,
    classify,
    budget,
    deps,
    /** Move the clock past the confirm retry window. */
    later: (ms = sw.CONFIRM_RETRY_AFTER_MS + 1) => (clock = new Date(clock.getTime() + ms)),
    check: (pages: Page[], checkId: string) => sw.processCheck(f.db, watch, pages, deps, checkId),
    settle: () => sw.settleSuspects(f.db, watch, deps),
  }
}

describe('processCheck records suspects, files nothing', () => {
  it('a newly broken page is a suspect: one row, no report', async () => {
    const h = harness()
    expect(await h.check([ok(`${BASE}/terms`), broken('/pair')], 'c1')).toEqual({ broken: 1, suspects: 1, resolved: 0 })
    expect(h.reports).toHaveLength(0)
    expect(h.pages).toEqual([
      expect.objectContaining({ url: `${BASE}/pair`, problem: 'http_error', confirmed_at: null, fail_streak: 1, last_failed_check_id: 'c1' }),
    ])
  })

  it('two polls reading the same check count it once; the next check counts again', async () => {
    const h = harness()
    await Promise.all([h.check([broken('/pair')], 'c1'), h.check([broken('/pair')], 'c1')])
    expect(h.pages).toHaveLength(1)
    await h.check([broken('/pair')], 'c1')
    expect(h.pages[0]!.fail_streak).toBe(1)
    await h.check([broken('/pair')], 'c2')
    expect(h.pages[0]).toMatchObject({ fail_streak: 2, last_failed_check_id: 'c2' })
  })

  it('a judged page, fail-open or not, never adds to the two-checks streak', async () => {
    const h = harness()
    await h.check([judged('/', 'Judge response not valid JSON — defaulting to meaningful')], 'c1')
    await h.check([judged('/', 'Judge response not valid JSON — defaulting to meaningful')], 'c2')
    await h.check([judged('/', 'The page shows only a loading message.')], 'c3')
    expect(h.pages[0]).toMatchObject({ problem: 'judged_broken', fail_streak: 0, confirmed_at: null })
  })

  it('a page that is fine again closes a filed finding and drops a suspect', async () => {
    const h = harness([filedRow('f1', '/pair')])
    await h.check([broken('/other')], 'c1')
    expect(await h.check([ok(`${BASE}/pair`), ok(`${BASE}/other`)], 'c2')).toEqual({ broken: 0, suspects: 0, resolved: 1 })
    expect(h.pages.every((p) => p.resolved_at === '2026-10-21T01:35:00.000Z')).toBe(true)
  })

  it('stays quiet while a filed page is still broken', async () => {
    const h = harness([filedRow('f1', '/pair')])
    expect(await h.check([broken('/pair')], 'c1')).toEqual({ broken: 1, suspects: 0, resolved: 0 })
    h.confirm.mockResolvedValue(loaded('', 500))
    expect(await h.settle()).toMatchObject({ scrapes: 0, filed: 0 })
    expect(h.reports).toHaveLength(0)
  })

  it('resolves a page removed from the site or now skipped on purpose', async () => {
    const h = harness([filedRow('f1', '/old'), filedRow('f2', '/feedback')])
    const r = await h.check(
      [
        { ...ok(`${BASE}/old`), status: 'removed' },
        { url: `${BASE}/feedback`, status: 'error', statusCode: null, error: "This URL is blocked by the website's robots.txt file" },
      ],
      'c1',
    )
    expect(r.resolved).toBe(2)
  })
})

describe('settleSuspects: file only what is seen failing twice', () => {
  it('a real outage: the 5xx reproduces on the confirm scrape and files one report', async () => {
    const h = harness()
    await h.check([broken('/pair', 503)], 'c1')
    h.confirm.mockResolvedValue(loaded('<h1>503 Service Unavailable</h1>', 503, '503'))
    expect(await h.settle()).toEqual({ scrapes: 1, dismissed: 0, confirmed: 1, filed: 1 })
    expect(h.confirm).toHaveBeenCalledWith(`${BASE}/pair`)
    expect(h.reports).toHaveLength(1)
    const report = h.reports[0]!
    expect(report).toMatchObject({
      project_id: 'p1',
      source: 'site_watch',
      title: 'Live site: /help-her-take-photo/pair returns HTTP 503',
      severity: 'high',
      custom_metadata: { confirmation: { basis: 'confirm_scrape', statusCode: 503, waitForMs: sw.CONFIRM_WAIT_MS } },
    })
    expect(String(report.description)).toContain('Seen again: Loaded again, the page still returned HTTP 503.')
    // No fake 0×0 viewport: the real one is unknown.
    expect(report.environment).not.toHaveProperty('viewport')
    expect(h.pages[0]).toMatchObject({ confirmed_at: '2026-10-21T01:35:00.000Z', report_id: report.id })
    expect(h.classify).toHaveBeenCalledWith(h.db, report.id, 'p1')
  })

  it('skip-link-only first frame: the confirm scrape sees the settled article, nothing files', async () => {
    const h = harness()
    await h.check([judged('/docs/start', 'The page lost its main content; only a skip link remains.')], 'c1')
    h.confirm.mockResolvedValue(loaded(SETTLED_ARTICLE))
    expect(await h.settle()).toMatchObject({ scrapes: 1, dismissed: 1, filed: 0 })
    expect(h.reports).toHaveLength(0)
    expect(h.pages[0]).toMatchObject({ resolved_at: '2026-10-21T01:35:00.000Z', confirmed_at: null })
    expect(h.pages[0]!.last_confirm).toMatchObject({ outcome: 'healthy' })
  })

  it('boot-card shell before hydration: the settled page files nothing, check after check', async () => {
    const h = harness()
    h.confirm.mockResolvedValue(loaded(SETTLED_LEGAL))
    // The boot card's tip rotates, so every check is "changed" and judged again.
    for (const c of ['c1', 'c2', 'c3']) {
      await h.check([judged('/legal/ai-disclaimer', 'The page shows only 読み込み中 and a tip.')], c)
      await h.settle()
      h.later()
    }
    expect(h.reports).toHaveLength(0)
  })

  it('judge fail-open never files, even when every confirm scrape fails', async () => {
    const h = harness()
    h.confirm.mockResolvedValue({ kind: 'unavailable', reason: 'FIRECRAWL_HTTP_502' })
    for (const c of ['c1', 'c2', 'c3', 'c4']) {
      await h.check([judged('/', 'Judge response not valid JSON — defaulting to meaningful')], c)
      await h.settle()
      h.later()
    }
    expect(h.reports).toHaveLength(0)
    expect(h.pages[0]).toMatchObject({ confirmed_at: null, resolved_at: null })
  })

  it('a page that stays blank after it settles files', async () => {
    const h = harness()
    await h.check([judged('/shop', 'The page renders blank.')], 'c1')
    h.confirm.mockResolvedValue(loaded(''))
    expect(await h.settle()).toMatchObject({ filed: 1 })
    expect(h.reports[0]).toMatchObject({ title: 'Live site: /help-her-take-photo/shop looks broken', severity: 'medium' })
    expect(String(h.reports[0]!.description)).toMatch(/still blank/)
  })

  it('a page that does not load files when Firecrawl times out on it again', async () => {
    const h = harness()
    await h.check([{ url: `${BASE}/x`, status: 'error', statusCode: null, error: 'timeout' }], 'c1')
    h.confirm.mockResolvedValue({ kind: 'timed_out', error: 'Request Timeout' })
    expect(await h.settle()).toMatchObject({ filed: 1 })
    expect(h.reports[0]).toMatchObject({ title: 'Live site: /help-her-take-photo/x does not load' })
  })

  it('without a conclusive confirm scrape, a 5xx files on the second check in a row', async () => {
    const h = harness()
    h.confirm.mockResolvedValue({ kind: 'unavailable', reason: 'FIRECRAWL_RATE_LIMITED' })
    await h.check([broken('/pair', 500)], 'c1')
    expect(await h.settle()).toMatchObject({ filed: 0 })
    h.later()
    await h.check([broken('/pair', 500)], 'c2')
    expect(await h.settle()).toMatchObject({ filed: 1 })
    expect(h.reports[0]).toMatchObject({ custom_metadata: { confirmation: { basis: 'two_checks' } } })
  })

  it('a 5xx that the confirm scrape finds healthy is dropped, even on its second check', async () => {
    const h = harness()
    await h.check([broken('/pair', 500)], 'c1')
    await h.check([broken('/pair', 500)], 'c2')
    h.confirm.mockResolvedValue(loaded(SETTLED_ARTICLE))
    expect(await h.settle()).toMatchObject({ dismissed: 1, filed: 0 })
    expect(h.reports).toHaveLength(0)
  })

  it('self-heal: a filed page that loads again closes, and must fail twice again to file again', async () => {
    const h = harness([filedRow('f1', '/pair')])
    await h.check([ok(`${BASE}/pair`)], 'c1')
    expect(h.pages[0]!.resolved_at).not.toBeNull()

    h.confirm.mockResolvedValue({ kind: 'unavailable', reason: 'FIRECRAWL_HTTP_503' })
    await h.check([broken('/pair')], 'c2')
    expect(await h.settle()).toMatchObject({ filed: 0 })
    expect(h.pages).toHaveLength(1)
    expect(h.pages[0]).toMatchObject({ resolved_at: null, confirmed_at: null, report_id: null, fail_streak: 1 })

    h.later()
    await h.check([broken('/pair')], 'c3')
    expect(await h.settle()).toMatchObject({ filed: 1 })
    expect(h.pages[0]).toMatchObject({ report_id: h.reports[0]!.id })
  })

  it('two polls settling at once scrape each page once and file it once', async () => {
    const h = harness()
    await h.check([broken('/pair')], 'c1')
    h.confirm.mockResolvedValue(loaded('', 500))
    const [a, b] = await Promise.all([h.settle(), h.settle()])
    expect(a.filed + b.filed).toBe(1)
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.reports).toHaveLength(1)
  })

  it('a burst: a broken sample files every page of it as one outage report', async () => {
    const h = harness()
    await h.check(Array.from({ length: 7 }, (_, i) => broken(`/p${i}`, 503)), 'c1')
    h.confirm.mockResolvedValue(loaded('', 503))
    const r = await h.settle()
    expect(r).toMatchObject({ scrapes: sw.CONFIRM_SCRAPES_PER_WATCH, confirmed: 7, filed: 1 })
    expect(h.reports).toHaveLength(1)
    expect(h.reports[0]).toMatchObject({ title: 'Live site: 7 pages broke at once', severity: 'critical', source: 'site_watch' })
    expect(h.reports[0]!.environment).not.toHaveProperty('viewport')
    expect(h.pages.every((p) => p.report_id === h.reports[0]!.id)).toBe(true)
    expect(h.classify).toHaveBeenCalledTimes(1)
  })

  it('a burst whose sample loads fine files nothing', async () => {
    const h = harness()
    await h.check(Array.from({ length: 7 }, (_, i) => judged(`/p${i}`, 'The page shows only a loading message.')), 'c1')
    h.confirm.mockResolvedValue(loaded(SETTLED_ARTICLE))
    expect(await h.settle()).toMatchObject({ dismissed: sw.CONFIRM_SCRAPES_PER_WATCH, filed: 0 })
    expect(h.reports).toHaveLength(0)
  })

  it('a failed report gives the claim back so the next poll files it', async () => {
    const h = harness([], { failReports: true })
    await h.check([broken('/pair')], 'c1')
    h.confirm.mockResolvedValue(loaded('', 500))
    expect(await h.settle()).toMatchObject({ confirmed: 0, filed: 0 })
    expect(h.pages[0]).toMatchObject({ confirmed_at: null, resolved_at: null })
    const g = harness(h.pages)
    g.later()
    g.confirm.mockResolvedValue(loaded('', 500))
    expect(await g.settle()).toMatchObject({ filed: 1 })
  })

  it('confirm scrapes stay bounded: per watch, per run budget, per check, and the retry window', async () => {
    const h = harness()
    h.confirm.mockResolvedValue({ kind: 'unavailable', reason: 'FIRECRAWL_HTTP_503' })
    await h.check([judged('/a', 'blank'), judged('/b', 'blank'), judged('/c', 'blank'), judged('/d', 'blank')], 'c1')

    h.budget.remaining = 2
    expect((await h.settle()).scrapes).toBe(2)
    expect(h.budget.remaining).toBe(0)
    expect((await h.settle()).scrapes).toBe(0)

    h.budget.remaining = 100
    // The two just tried are inside the retry window; the other two are not.
    expect((await h.settle()).scrapes).toBe(2)
    expect((await h.settle()).scrapes).toBe(0)

    // At most CONFIRM_ATTEMPTS_PER_CHECK per page until a new check sees it failing.
    for (let i = 0; i < 5; i++) {
      h.later()
      await h.settle()
    }
    expect(h.confirm).toHaveBeenCalledTimes(4 * sw.CONFIRM_ATTEMPTS_PER_CHECK)
    await h.check([judged('/a', 'blank')], 'c2')
    h.later()
    expect((await h.settle()).scrapes).toBe(1)
  })

  it('no confirm scrape starts past the run deadline, and none for another site', async () => {
    const h = harness([
      { id: 'x1', watch_id: 'w1', url: 'https://evil.example/pair', problem: 'judged_broken', resolved_at: null, confirmed_at: null, fail_streak: 0, confirm_attempts: 0 },
    ])
    expect((await h.settle()).scrapes).toBe(0)
    await h.check([judged('/a', 'blank')], 'c1')
    h.budget.deadline = 0
    expect((await h.settle()).scrapes).toBe(0)
    expect(h.confirm).not.toHaveBeenCalled()
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

  it('identifies the crawler as MushiSiteWatch on create and on a full update, and sets nothing else', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: 'mon-1' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const spec = { name: 'watch', baseUrl: BASE, pageLimit: 25, scheduleCron: sw.DEFAULT_SCHEDULE_CRON }
    await sw.createMonitor('fc-key', spec)
    await sw.updateMonitor('fc-key', 'mon-1', { ...spec, status: 'active' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String((call as unknown as [string, RequestInit])[1].body))
      expect(body.targets[0].scrapeOptions).toEqual({ headers: { 'User-Agent': sw.SITE_WATCH_USER_AGENT } })
    }
    expect(sw.SITE_WATCH_USER_AGENT).toMatch(/^Mozilla\/5\.0 .* Chrome\/[\d.]+ Safari\/537\.36 MushiSiteWatch\/1\.0 \(\+https:\/\/kensaur\.us\/mushi-mushi\)$/)
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

  it('flags a live monitor that lacks the current User-Agent for reconcile', async () => {
    // The six 2026-10-10 monitors came back with scrapeOptions {} and their
    // crawls reached glot.it unmarked.
    expect(sw.monitorNeedsReconcile({ targets: [{ scrapeOptions: {} }] })).toBe(true)
    expect(sw.monitorNeedsReconcile({})).toBe(true)
    expect(sw.monitorNeedsReconcile({ targets: [{ scrapeOptions: { headers: { 'User-Agent': 'MushiSiteWatch/0.9' } } }] })).toBe(true)
    expect(
      sw.monitorNeedsReconcile({ targets: [{ scrapeOptions: { headers: { 'User-Agent': sw.SITE_WATCH_USER_AGENT } } }] }),
    ).toBe(false)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: { name: 'watch', targets: [{ scrapeOptions: {} }] } }))),
    )
    const live = await sw.getMonitor('fc-key', 'mon-1')
    expect(live.name).toBe('watch')
    expect(sw.monitorNeedsReconcile(live)).toBe(true)
  })

  it('a monitor already gone counts as deleted; a 404 elsewhere is a typed error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    await expect(sw.deleteMonitor('fc-key', 'gone')).resolves.toBeUndefined()
    await expect(sw.listChecks('fc-key', 'gone')).rejects.toMatchObject({ status: 404, message: 'FIRECRAWL_MONITOR_NOT_FOUND' })
  })
})
