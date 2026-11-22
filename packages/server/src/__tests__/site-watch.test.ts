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
const { tagMonitorUrl } = await import('../../supabase/functions/_shared/monitor-url.ts')
type Page = Parameters<typeof sw.classifyPage>[0]

const BASE = 'https://kensaur.us/help-her-take-photo'
/** What monitor-url.ts appends to every watch page load. */
const WATCH_TAG = 'mushi_monitor=watch&utm_source=mushi-monitor&utm_medium=watch'
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
        // A snapshot, like PostgREST: later writes do not change rows already read.
        return { data: rows().map((r) => structuredClone(r)), error: null }
      }
      const q: Record<string, unknown> = {
        select: () => ((returning = op !== 'select'), q),
        eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
        in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q),
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

type Problem = Parameters<typeof sw.judgeConfirmation>[1]
const jc = (scrape: Parameters<typeof sw.judgeConfirmation>[0], problem: Problem = 'judged_broken') =>
  sw.judgeConfirmation(scrape, problem)

describe('judgeConfirmation: does the settled page still fail?', () => {
  it('a skip-link-only first frame is broken; the settled article is not', () => {
    expect(jc(loaded(SKIP_LINK_FRAME))).toMatchObject({ outcome: 'broken' })
    expect(jc(loaded(SKIP_LINK_FRAME)).detail).toMatch(/only a skip link/)
    expect(jc(loaded(SETTLED_ARTICLE))).toMatchObject({ outcome: 'healthy', statusCode: 200 })
  })

  it('a boot card or a mid-request status line is a loading screen; the hydrated page is not', () => {
    expect(jc(loaded(BOOT_CARD)).detail).toMatch(/loading screen/)
    expect(jc(loaded(DEMO_STATUS_LINE))).toMatchObject({ outcome: 'broken' })
    expect(jc(loaded(SETTLED_LEGAL))).toMatchObject({ outcome: 'healthy' })
  })

  it('error-panel copy beside real content is not an error screen', () => {
    expect(jc(loaded(SHOP_CATALOG))).toMatchObject({ outcome: 'healthy' })
    expect(jc(loaded('# Application error: a client-side exception has occurred'))).toMatchObject({ outcome: 'broken' })
  })

  it('a page that stays blank, or a 5xx or 404 that reproduces, is broken for any kind of suspect', () => {
    expect(jc(loaded('   \n'))).toMatchObject({ outcome: 'broken', detail: expect.stringMatching(/still blank/) })
    for (const p of ['judged_broken', 'http_error', 'load_error'] as const) {
      expect(jc(loaded('<h1>502 Bad Gateway</h1>', 502), p)).toMatchObject({ outcome: 'broken', statusCode: 502 })
      expect(jc(loaded('# Not found', 404), p)).toMatchObject({ outcome: 'broken', statusCode: 404 })
    }
  })

  it('a 408 is broken only for a page that did not load; a slow page is not an error screen or a 5xx', () => {
    const timedOut = { kind: 'timed_out' as const, error: 'Request Timeout' }
    expect(jc(timedOut, 'load_error')).toMatchObject({ outcome: 'broken' })
    expect(jc(timedOut, 'http_error')).toMatchObject({ outcome: 'inconclusive' })
    expect(jc(timedOut, 'judged_broken')).toMatchObject({ outcome: 'inconclusive' })
  })

  it('an unreachable site (DNS, connection, TLS) is broken for an HTTP error or load failure, not for a judgment', () => {
    const down = { kind: 'unreachable' as const, code: 'SCRAPE_DNS_RESOLUTION_ERROR', error: 'DNS resolution failed' }
    expect(jc(down, 'load_error')).toMatchObject({ outcome: 'broken', detail: expect.stringMatching(/SCRAPE_DNS_RESOLUTION_ERROR/) })
    expect(jc(down, 'http_error')).toMatchObject({ outcome: 'broken' })
    expect(jc(down, 'judged_broken')).toMatchObject({ outcome: 'inconclusive' })
  })

  it('an auth wall, a Firecrawl failure or an empty answer decides nothing', () => {
    expect(jc(loaded('Sign in', 403))).toMatchObject({ outcome: 'inconclusive' })
    expect(jc({ kind: 'unavailable', reason: 'FIRECRAWL_HTTP_502' })).toMatchObject({ outcome: 'inconclusive' })
    expect(jc(loaded('', null))).toMatchObject({ outcome: 'inconclusive' })
  })

  it('a non-HTML page that loads is healthy', () => {
    expect(jc({ ...loaded(''), contentType: 'application/xml' })).toMatchObject({ outcome: 'healthy' })
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
      // Marked as Mushi's watch traffic (monitor-url.ts).
      url: `${BASE}/docs?${WATCH_TAG}`,
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

  it('keeps the error code: an unreachable site is not a Firecrawl failure (codes from Firecrawl source)', async () => {
    const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
    // DNS failures come back as HTTP 200 with success: false (controllers/v2/scrape.ts).
    answer(200, { success: false, code: 'SCRAPE_DNS_RESOLUTION_ERROR', error: 'DNS resolution failed for the hostname.' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toEqual({
      kind: 'unreachable',
      code: 'SCRAPE_DNS_RESOLUTION_ERROR',
      error: 'DNS resolution failed for the hostname.',
    })
    answer(500, { success: false, code: 'SCRAPE_SITE_ERROR', error: 'net::ERR_CONNECTION_REFUSED' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toMatchObject({ kind: 'unreachable', code: 'SCRAPE_SITE_ERROR' })
    answer(500, { success: false, code: 'SCRAPE_SSL_ERROR', error: 'certificate has expired' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toMatchObject({ kind: 'unreachable', code: 'SCRAPE_SSL_ERROR' })
    // Anti-bot walls end in all-engines-failed too: not proof the site is down.
    answer(500, { success: false, code: 'SCRAPE_ALL_ENGINES_FAILED', error: 'All scraping engines failed.' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toMatchObject({ kind: 'unavailable' })
    // 408 is the page timing out, unless it was Firecrawl's own queue.
    answer(408, { success: false, code: 'SCRAPE_TIMEOUT', error: 'Scrape timed out' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toMatchObject({ kind: 'timed_out' })
    answer(408, { success: false, code: 'CONCURRENCY_QUEUE_TIMEOUT', error: 'Queued too long' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toEqual({ kind: 'unavailable', reason: 'FIRECRAWL_QUEUE_TIMEOUT' })
    // A site Firecrawl will not scrape is not a bad key.
    answer(403, { success: false, code: 'UNSUPPORTED_SITE', error: 'We do not support this site.' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toEqual({ kind: 'unavailable', reason: 'FIRECRAWL_UNSUPPORTED_SITE' })
    answer(401, { success: false, error: 'Unauthorized' })
    expect(await sw.confirmScrape('k', `${BASE}/a`)).toEqual({ kind: 'unavailable', reason: 'FIRECRAWL_AUTH_FAILED' })
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

function harness(seed: Array<Record<string, unknown>> = [], opts: { failReports?: boolean; canConfirm?: boolean } = {}) {
  const f = makeDb(seed, opts)
  let clock = new Date('2026-10-21T01:35:00Z')
  const confirm = vi.fn(async (_url: string): Promise<Awaited<ReturnType<typeof sw.confirmScrape>>> => ({ kind: 'unavailable', reason: 'not stubbed' }))
  const classify = vi.fn(async () => {})
  const budget = { remaining: 100, deadline: Number.MAX_SAFE_INTEGER }
  const deps = { now: () => clock, classify, confirm, budget, canConfirm: opts.canConfirm ?? true }
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
    expect(String(report.description)).toContain('Seen again: Loaded again, the page returned HTTP 503.')
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

describe('review fixes 2026-10-21 (PR #533)', () => {
  const unavailable = { kind: 'unavailable' as const, reason: 'FIRECRAWL_HTTP_502' }
  const same = (path: string): Page => ok(`${BASE}${path}`, 'same')
  /** Use up a check's confirm attempts, one poll per retry window. */
  const exhaust = async (h: ReturnType<typeof harness>) => {
    for (let i = 0; i < sw.CONFIRM_ATTEMPTS_PER_CHECK; i++) {
      await h.settle()
      h.later()
    }
  }

  // Finding 1: a judged break the next check shows unchanged is still broken.
  it('a persistent judged break survives `same`, gets fresh confirms, and files unconfirmed at low after 2 fully inconclusive checks', async () => {
    const h = harness()
    h.confirm.mockResolvedValue(unavailable)
    await h.check([judged('/shop', 'The page renders blank.')], 'c1')
    await exhaust(h)
    expect(h.pages[0]).toMatchObject({ inconclusive_checks: 1, confirm_attempts: sw.CONFIRM_ATTEMPTS_PER_CHECK })

    // The page did not change, so Firecrawl's judge did not run: `same`.
    expect(await h.check([same('/shop')], 'c2')).toEqual({ broken: 1, suspects: 1, resolved: 0 })
    expect(h.pages[0]).toMatchObject({ resolved_at: null, last_failed_check_id: 'c2', confirm_attempts: 0 })

    for (let i = 1; i < sw.CONFIRM_ATTEMPTS_PER_CHECK; i++) {
      expect(await h.settle()).toMatchObject({ scrapes: 1, filed: 0 })
      h.later()
    }
    expect(await h.settle()).toMatchObject({ scrapes: 1, filed: 1 })
    expect(h.reports[0]).toMatchObject({
      title: 'Live site: /help-her-take-photo/shop looks broken (unconfirmed)',
      severity: 'low',
      custom_metadata: { confirmation: { basis: 'unconfirmed' } },
    })
  })

  // Re-review finding 3: one inconclusive confirm (a single 429) is not a check's worth of evidence.
  it('a check counts as inconclusive only once all its confirm attempts came back inconclusive', async () => {
    const h = harness()
    h.confirm.mockResolvedValue({ kind: 'unavailable', reason: 'FIRECRAWL_RATE_LIMITED' })
    await h.check([judged('/shop', 'The page renders blank.')], 'c1')
    for (let i = 1; i < sw.CONFIRM_ATTEMPTS_PER_CHECK; i++) {
      await h.settle()
      h.later()
      expect(h.pages[0]!.inconclusive_checks).toBe(0)
    }
    await h.settle()
    h.later()
    expect(h.pages[0]!.inconclusive_checks).toBe(1)
    // No attempts left for this check: no more scrapes, no more counting.
    expect((await h.settle()).scrapes).toBe(0)
    expect(h.confirm).toHaveBeenCalledTimes(sw.CONFIRM_ATTEMPTS_PER_CHECK)
    expect(h.pages[0]).toMatchObject({ inconclusive_checks: 1, confirmed_at: null })
    expect(h.reports).toHaveLength(0)
  })

  it('a fail-open judgment never files unconfirmed, however long it stays', async () => {
    const h = harness()
    h.confirm.mockResolvedValue(unavailable)
    await h.check([judged('/', 'Judge response not valid JSON — defaulting to meaningful')], 'c1')
    await exhaust(h)
    for (const c of ['c2', 'c3', 'c4']) {
      await h.check([same('/')], c)
      await exhaust(h)
    }
    expect(h.reports).toHaveLength(0)
    expect(h.pages[0]).toMatchObject({ judge_fail_open: true, resolved_at: null })
    expect(h.pages[0]!.inconclusive_checks).toBeGreaterThanOrEqual(2)
  })

  // Re-review finding 1: a measured failure that turns into a fail-open judgment.
  it('a 500 with an inconclusive confirm, then a fail-open judgment, never files unconfirmed', async () => {
    const h = harness()
    h.confirm.mockResolvedValue(unavailable)
    await h.check([broken('/pair', 500)], 'c1')
    await exhaust(h)
    // Only judged suspects count inconclusive checks.
    expect(h.pages[0]).toMatchObject({ problem: 'http_error', judge_fail_open: false, inconclusive_checks: 0 })
    // Even a row that carries a count from before this fix starts over on a new kind.
    h.pages[0]!.inconclusive_checks = 1

    await h.check([judged('/pair', 'Judge response not valid JSON — defaulting to meaningful')], 'c2')
    expect(h.pages[0]).toMatchObject({ problem: 'judged_broken', judge_fail_open: true, inconclusive_checks: 0 })
    await exhaust(h)
    for (const c of ['c3', 'c4']) {
      await h.check([same('/pair')], c)
      await exhaust(h)
    }
    expect(h.reports).toHaveLength(0)
    expect(h.pages[0]).toMatchObject({ confirmed_at: null, resolved_at: null })
  })

  // Re-review finding 2: a watch on the platform key cannot confirm.
  it('an env-key watch files a confident judged break as unconfirmed after 2 checks that still show it, with no confirm', async () => {
    const h = harness([], { canConfirm: false })
    h.budget.remaining = 0
    await h.check([judged('/shop', 'The page renders blank.')], 'c1')
    await h.settle()
    await h.settle()
    expect(h.pages[0]).toMatchObject({ inconclusive_checks: 1, confirmed_at: null })
    await h.check([same('/shop')], 'c2')
    expect(await h.settle()).toMatchObject({ scrapes: 0, filed: 1 })
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.reports[0]).toMatchObject({ severity: 'low', custom_metadata: { confirmation: { basis: 'unconfirmed' } } })
    expect(String(h.reports[0]!.description)).toMatch(/no Firecrawl key of its own/)
  })

  it('an env-key watch never files a fail-open judgment, and keeps the two-checks rule for a 5xx', async () => {
    const h = harness([], { canConfirm: false })
    h.budget.remaining = 0
    for (const c of ['c1', 'c2', 'c3']) {
      await h.check([judged('/', 'Judge response not valid JSON — defaulting to meaningful'), broken('/pair', 502)], c)
      await h.settle()
    }
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.reports).toHaveLength(1)
    expect(h.reports[0]).toMatchObject({ title: 'Live site: /help-her-take-photo/pair returns HTTP 502' })
    expect(h.pages.find((p) => p.url === `${BASE}/`)).toMatchObject({ confirmed_at: null, judge_fail_open: true })
  })

  // Re-review finding 4 (optional): fail-open judgments cannot starve the budget.
  it('confirms go to measured failures and confident judgments before fail-open ones', async () => {
    const w = (watchId: string, oldestPendingAt: string, failOpenOnly: boolean) => ({ watchId, oldestPendingAt, eligible: 3, failOpenOnly })
    expect(
      Object.fromEntries(sw.allocateConfirms([w('noise', '2026-10-01T00:00:00Z', true), w('real', '2026-10-20T00:00:00Z', false)], 2)),
    ).toEqual({ real: 2 })
    const h = harness()
    h.confirm.mockResolvedValue(unavailable)
    h.budget.remaining = 1
    await h.check([judged('/noise', 'Judge response not valid JSON — defaulting to meaningful'), judged('/real', 'The page renders blank.')], 'c1')
    await h.settle()
    expect(h.confirm).toHaveBeenCalledWith(`${BASE}/real`)
  })

  it('a judged break closes on a change the judge does not call broken, or on a healthy confirm', async () => {
    const h = harness()
    await h.check([judged('/a', 'The page renders blank.'), judged('/b', 'The page renders blank.')], 'c1')
    await h.check([{ ...ok(`${BASE}/a`, 'changed'), judgment: { meaningful: false, confidence: 'high', reason: 'content restored' } }], 'c2')
    expect(h.pages.find((p) => p.url === `${BASE}/a`)).toMatchObject({ resolved_at: expect.any(String) })
    h.confirm.mockResolvedValue(loaded(SETTLED_ARTICLE))
    expect(await h.settle()).toMatchObject({ dismissed: 1, filed: 0 })
    expect(h.pages.every((p) => p.resolved_at)).toBe(true)
  })

  it('a filed judged finding stays open on `same`, so it does not file again on the next change', async () => {
    const h = harness([{ ...filedRow('f1', '/shop'), problem: 'judged_broken' }])
    expect(await h.check([same('/shop')], 'c1')).toEqual({ broken: 1, suspects: 0, resolved: 0 })
    expect(h.pages[0]!.resolved_at).toBeNull()
  })

  // Finding 2: a site that is down files within the hour, as one outage.
  it('a fully down site: the confirm sample cannot reach it, and every page files as one outage on the first poll', async () => {
    const h = harness()
    await h.check(
      Array.from({ length: 6 }, (_, i): Page => ({ url: `${BASE}/p${i}`, status: 'error', statusCode: null, error: 'ERR_NAME_NOT_RESOLVED' })),
      'c1',
    )
    h.confirm.mockResolvedValue({ kind: 'unreachable', code: 'SCRAPE_DNS_RESOLUTION_ERROR', error: 'DNS resolution failed' })
    expect(await h.settle()).toMatchObject({ scrapes: sw.CONFIRM_SCRAPES_PER_WATCH, confirmed: 6, filed: 1 })
    expect(h.reports[0]).toMatchObject({ title: 'Live site: 6 pages broke at once', severity: 'critical' })
  })

  // Finding 4: a 408 on judged suspects is not an outage.
  it('a burst of judged suspects that only time out files nothing', async () => {
    const h = harness()
    await h.check(Array.from({ length: 6 }, (_, i) => judged(`/p${i}`, 'The page shows only a loading message.')), 'c1')
    h.confirm.mockResolvedValue({ kind: 'timed_out', error: 'Request Timeout' })
    expect(await h.settle()).toMatchObject({ scrapes: sw.CONFIRM_SCRAPES_PER_WATCH, filed: 0 })
    expect(h.reports).toHaveLength(0)
  })

  // Finding 5: a 5xx that keeps coming back but loads on every confirm.
  it('a flapping 5xx files at low as intermittent on its 3rd healthy confirm in 7 days, across reopens', async () => {
    const h = harness()
    h.confirm.mockResolvedValue(loaded(SETTLED_ARTICLE))
    for (const c of ['c1', 'c2']) {
      await h.check([broken('/pair', 502)], c)
      expect(await h.settle()).toMatchObject({ dismissed: 1, filed: 0 })
      h.later(24 * 3_600_000)
    }
    expect(h.pages[0]!.flap_dismissals).toHaveLength(2)
    await h.check([broken('/pair', 502)], 'c3')
    expect(await h.settle()).toMatchObject({ dismissed: 0, filed: 1 })
    expect(h.reports[0]).toMatchObject({
      title: 'Live site: /help-her-take-photo/pair returns HTTP 502 (intermittent)',
      severity: 'low',
      custom_metadata: { confirmation: { basis: 'flapping' } },
    })
    expect(h.pages[0]).toMatchObject({ flap_dismissals: [], report_id: h.reports[0]!.id })
  })

  it('dismissals older than 7 days do not count toward flapping', async () => {
    const h = harness()
    h.confirm.mockResolvedValue(loaded(SETTLED_ARTICLE))
    for (const c of ['c1', 'c2', 'c3']) {
      await h.check([broken('/pair', 500)], c)
      await h.settle()
      h.later(4 * 24 * 3_600_000)
    }
    expect(h.reports).toHaveLength(0)
    expect(h.pages[0]!.flap_dismissals).toHaveLength(2)
  })

  // Finding 6: rows the old poll filed (report_id set, confirmed_at null).
  it('a row the pre-0029 poll filed is never a suspect: no confirm, no second report', async () => {
    const legacy = { ...filedRow('L1', '/pair'), confirmed_at: null }
    const h = harness([legacy])
    h.confirm.mockResolvedValue(loaded('', 500))
    expect(await h.check([broken('/pair')], 'c1')).toEqual({ broken: 1, suspects: 0, resolved: 0 })
    expect(await h.settle()).toEqual({ scrapes: 0, dismissed: 0, confirmed: 0, filed: 0 })
    expect(h.reports).toHaveLength(0)
    expect(sw.isFiled(legacy)).toBe(true)
    expect(await h.check([ok(`${BASE}/pair`)], 'c2')).toMatchObject({ resolved: 1 })
  })

  // Finding 7: the confirm's status code only titles the report when it is an error.
  it('a 5xx suspect confirmed by a blank 200 page keeps its 5xx in the title and severity', async () => {
    const h = harness()
    await h.check([broken('/pair', 503)], 'c1')
    h.confirm.mockResolvedValue(loaded('', 200))
    await h.settle()
    expect(h.reports[0]).toMatchObject({ title: 'Live site: /help-her-take-photo/pair returns HTTP 503', severity: 'high' })
  })

  // Finding 3: fair sharing of a run's confirm scrapes.
  it('allocateConfirms: oldest pending suspect first, one per watch before any gets a second', () => {
    const w = (watchId: string, oldestPendingAt: string, eligible: number) => ({ watchId, oldestPendingAt, eligible })
    const watches = [w('new', '2026-10-21T00:00:00Z', 5), w('old', '2026-10-01T00:00:00Z', 5), w('mid', '2026-10-10T00:00:00Z', 1), w('x', '2026-10-15T00:00:00Z', 4)]
    expect(Object.fromEntries(sw.allocateConfirms(watches, 6))).toEqual({ old: 2, mid: 1, x: 2, new: 1 })
    expect(Object.fromEntries(sw.allocateConfirms(watches, 2))).toEqual({ old: 1, mid: 1 })
    expect(Object.fromEntries(sw.allocateConfirms([w('a', '2026-10-01T00:00:00Z', 9)], 6))).toEqual({ a: sw.CONFIRM_SCRAPES_PER_WATCH })
  })

  it('pendingConfirmsByWatch counts only confirm-eligible suspects, per watch', async () => {
    const suspect = (id: string, watch_id: string, url: string, extra: Record<string, unknown> = {}) => ({
      id,
      watch_id,
      url,
      problem: 'http_error',
      first_seen_at: '2026-10-20T00:00:00.000Z',
      resolved_at: null,
      confirmed_at: null,
      report_id: null,
      confirm_attempts: 0,
      ...extra,
    })
    const f = makeDb([
      suspect('a1', 'w1', `${BASE}/a`, { first_seen_at: '2026-10-19T00:00:00.000Z' }),
      suspect('a2', 'w1', `${BASE}/b`, { confirm_attempts: sw.CONFIRM_ATTEMPTS_PER_CHECK }),
      suspect('a3', 'w1', `${BASE}/c`, { report_id: 'r-old' }),
      suspect('b1', 'w2', 'https://kensaur.us/glot-it/x'),
      suspect('b2', 'w2', 'https://evil.example/x'),
    ])
    const out = await sw.pendingConfirmsByWatch(
      f.db,
      [watch, { id: 'w2', project_id: 'p2', base_url: 'https://kensaur.us/glot-it' }],
      new Date('2026-10-21T01:35:00Z'),
    )
    expect(out.sort((x, y) => x.watchId.localeCompare(y.watchId))).toEqual([
      { watchId: 'w1', oldestPendingAt: '2026-10-19T00:00:00.000Z', eligible: 1, failOpenOnly: false },
      { watchId: 'w2', oldestPendingAt: '2026-10-20T00:00:00.000Z', eligible: 1, failOpenOnly: false },
    ])
  })

  // Finding 10: a confirm starts only when it can finish by the run deadline.
  it('no confirm starts when its worst case would overrun the run deadline', async () => {
    const h = harness()
    await h.check([broken('/pair')], 'c1')
    h.confirm.mockResolvedValue(loaded('', 500))
    const now = new Date('2026-10-21T01:35:00Z').getTime()
    h.budget.deadline = now + sw.CONFIRM_WORST_CASE_MS - 1
    expect((await h.settle()).scrapes).toBe(0)
    h.budget.deadline = now + sw.CONFIRM_WORST_CASE_MS
    expect((await h.settle()).scrapes).toBe(1)
    expect(sw.CONFIRM_RUN_DEADLINE_MS).toBeLessThan(150_000)
  })
})

describe('Firecrawl monitor calls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a daily scrape monitor over the page list, every URL marked (ADR 0059)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { id: 'mon-1', estimatedCreditsPerMonth: 660 } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const urls = [`${BASE}/`, `${BASE}/terms`, `${BASE}/s?q=a#top`]
    const res = await sw.createMonitor('fc-key', { name: 'watch', urls, scheduleCron: sw.DEFAULT_SCHEDULE_CRON })
    expect(res).toEqual({ id: 'mon-1', estimatedCreditsPerMonth: 660 })
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.dev/v2/monitor')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ schedule: { cron: '30 1 * * *', timezone: 'UTC' }, goal: sw.SITE_WATCH_GOAL })
    expect(body.targets).toEqual([
      {
        type: 'scrape',
        urls: [`${BASE}/?${WATCH_TAG}`, `${BASE}/terms?${WATCH_TAG}`, `${BASE}/s?q=a&${WATCH_TAG}#top`],
        scrapeOptions: { headers: { 'User-Agent': sw.SITE_WATCH_USER_AGENT } },
      },
    ])
    expect(body).not.toHaveProperty('webhook')
    // No crawl target anywhere: a crawl marks only its seed.
    expect(JSON.stringify(body)).not.toContain('"crawl"')
  })

  it('splits a long list into targets of MONITOR_URLS_PER_TARGET (Firecrawl: 1-50 targets)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: 'mon-1' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const urls = Array.from({ length: sw.MONITOR_URLS_PER_TARGET * 2 + 1 }, (_, i) => `${BASE}/p${i}`)
    await sw.createMonitor('fc-key', { name: 'watch', urls, scheduleCron: sw.DEFAULT_SCHEDULE_CRON })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.targets.map((t: { urls: string[] }) => t.urls.length)).toEqual([sw.MONITOR_URLS_PER_TARGET, sw.MONITOR_URLS_PER_TARGET, 1])
    expect(body.targets.every((t: { urls: string[] }) => t.urls.every((u) => u.includes('mushi_monitor=watch')))).toBe(true)
    // A watch holds at most 100 pages (site_watches.page_limit): one target today.
    expect(sw.MONITOR_URLS_PER_TARGET).toBeGreaterThanOrEqual(100)
  })

  it('identifies as MushiSiteWatch on create and on a list update; a status-only update sends no targets', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: 'mon-1' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const spec = { name: 'watch', urls: [`${BASE}/`], scheduleCron: sw.DEFAULT_SCHEDULE_CRON }
    await sw.createMonitor('fc-key', spec)
    await sw.updateMonitor('fc-key', 'mon-1', { ...spec, status: 'active' })
    await sw.updateMonitor('fc-key', 'mon-1', { name: 'watch', scheduleCron: sw.DEFAULT_SCHEDULE_CRON, status: 'active' })
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)))
    for (const body of bodies.slice(0, 2)) {
      expect(body.targets[0].scrapeOptions).toEqual({ headers: { 'User-Agent': sw.SITE_WATCH_USER_AGENT } })
      expect(body.targets[0].urls).toEqual([`${BASE}/?${WATCH_TAG}`])
    }
    // Sending targets resets every page's history (probe 2026-11-13).
    expect(bodies[2]).toEqual({ status: 'active' })
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

  it('keys the seed page by its bare URL: the marker the crawl was sent with is removed', async () => {
    // metadata form (utm_* already dropped by Firecrawl) and the as-sent form.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { pages: [ok(`${BASE}?mushi_monitor=watch`), ok(`${BASE}/a?x=1&${WATCH_TAG}`)] } }))),
    )
    const pages = await sw.checkPages('fc-key', 'm', 'c')
    expect(pages.map((p) => p.url)).toEqual([BASE, `${BASE}/a?x=1`])
  })

  it('flags a live monitor for reconcile: a crawl, a missing User-Agent, or an unmarked page URL', async () => {
    const ua = { headers: { 'User-Agent': sw.SITE_WATCH_USER_AGENT } }
    const scrape = (urls: string[], scrapeOptions: Record<string, unknown> = ua) => ({ type: 'scrape', urls, scrapeOptions })
    // Every monitor before ADR 0059 is a crawl, even one with the UA and a marked seed.
    expect(sw.monitorNeedsReconcile({ targets: [{ type: 'crawl', url: `${BASE}?${WATCH_TAG}`, scrapeOptions: ua }] })).toBe(true)
    expect(sw.monitorNeedsReconcile({})).toBe(true)
    // The six 2026-10-10 monitors came back with scrapeOptions {} and reached glot.it unmarked.
    expect(sw.monitorNeedsReconcile({ targets: [scrape([`${BASE}/?${WATCH_TAG}`], {})] })).toBe(true)
    expect(sw.monitorNeedsReconcile({ targets: [scrape([`${BASE}/?${WATCH_TAG}`], { headers: { 'User-Agent': 'MushiSiteWatch/0.9' } })] })).toBe(true)
    expect(sw.monitorNeedsReconcile({ targets: [scrape([`${BASE}/?${WATCH_TAG}`, `${BASE}/terms`])] })).toBe(true)
    expect(sw.monitorNeedsReconcile({ targets: [scrape([])] })).toBe(true)
    expect(sw.monitorNeedsReconcile({ targets: [scrape([`${BASE}/?${WATCH_TAG}`, `${BASE}/terms?${WATCH_TAG}`])] })).toBe(false)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: { name: 'watch', targets: [{ type: 'crawl', url: BASE, scrapeOptions: {} }] } }))),
    )
    const live = await sw.getMonitor('fc-key', 'mon-1')
    expect(live.name).toBe('watch')
    expect(sw.monitorNeedsReconcile(live)).toBe(true)
    expect(sw.liveTargetUrls(live)).toEqual([])
    expect(sw.liveTargetUrls({ targets: [scrape([`${BASE}/terms?x=1&${WATCH_TAG}`])] })).toEqual([`${BASE}/terms?x=1`])
  })

  it('a monitor already gone counts as deleted; a 404 elsewhere is a typed error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    await expect(sw.deleteMonitor('fc-key', 'gone')).resolves.toBeUndefined()
    await expect(sw.listChecks('fc-key', 'gone')).rejects.toMatchObject({ status: 404, message: 'FIRECRAWL_MONITOR_NOT_FOUND' })
  })
})

// ── The page list a watch loads (ADR 0059) ──────────────────────────────

describe('selectWatchUrls / nextWatchUrls', () => {
  const page = (path: string, statusCode: number | null = 200) => ({ url: `${BASE}${path}`, statusCode })
  const base = {
    baseUrl: BASE,
    limit: 100,
    current: [] as string[],
    lastPages: [] as Array<{ url: string; statusCode: number | null }>,
    mapped: null as string[] | null,
  }

  it('base first, same-site pages under the base path only, no sitemaps or files, at most the limit', () => {
    const urls = sw.selectWatchUrls({
      ...base,
      limit: 4,
      mapped: [
        `${BASE}/sitemap.xml`,
        `${BASE}/a/b/c`,
        `${BASE}/terms`,
        'https://kensaur.us/other-app/x',
        'https://elsewhere.example/terms',
        `${BASE}/assets/og.png`,
        `${BASE}/privacy?utm_source=x#top`,
        `${BASE}/guides/one`,
      ],
    })
    // Shallow paths first; query and fragment dropped.
    expect(urls).toEqual([BASE, `${BASE}/privacy`, `${BASE}/terms`, `${BASE}/guides/one`])
  })

  it('on the switch from a crawl, keeps every page the crawl reached by following links, 404s included', () => {
    const urls = sw.selectWatchUrls({
      ...base,
      lastPages: [page('/'), page('/linked-only'), page('/broken-link', 404)],
      mapped: [`${BASE}/terms`],
      pending: [`${BASE}/broken-link`],
    })
    // The base keeps its stored spelling here; the site's own spelling is resolved before sending.
    expect(urls).toEqual([BASE, `${BASE}/linked-only`, `${BASE}/broken-link`, `${BASE}/terms`])
  })

  it('a dead URL the map lists is watched, so its 404 files', () => {
    const urls = sw.selectWatchUrls({
      ...base,
      current: [`${BASE}/`],
      lastPages: [page('/'), page('/gone', 404)],
      mapped: [`${BASE}/`, `${BASE}/gone`],
    })
    expect(urls).toContain(`${BASE}/gone`)
  })

  it('drops a watched page that left the site: unmapped, 404/410, nothing waiting to file', () => {
    const input = {
      ...base,
      current: [`${BASE}/`, `${BASE}/old`, `${BASE}/flaky`, `${BASE}/unmapped-ok`],
      lastPages: [page('/'), page('/old', 410), page('/flaky', 503), page('/unmapped-ok')],
      mapped: [`${BASE}/`, `${BASE}/flaky`],
    }
    expect(sw.selectWatchUrls(input)).toEqual([`${BASE}/`, `${BASE}/flaky`, `${BASE}/unmapped-ok`])
    // A 404 whose suspect has not filed yet stays until it reaches its report.
    expect(sw.selectWatchUrls({ ...input, pending: [`${BASE}/old`] })).toContain(`${BASE}/old`)
  })

  it('keeps the spelling a page is watched under (it was resolved against the site when it joined)', () => {
    expect(sw.selectWatchUrls({ ...base, current: [`${BASE}/`], mapped: [BASE, `${BASE}/terms`] })).toEqual([`${BASE}/`, `${BASE}/terms`])
    expect(sw.selectWatchUrls({ ...base, current: [BASE], mapped: [`${BASE}/`, `${BASE}/terms`] })).toEqual([BASE, `${BASE}/terms`])
  })

  it('leaves the monitor alone when the page set is unchanged, in any spelling or order', () => {
    const current = [`${BASE}/`, `${BASE}/terms`]
    expect(sw.nextWatchUrls({ ...base, current, lastPages: [page('/'), page('/terms')], mapped: [`${BASE}/terms/`, BASE] })).toBeNull()
  })

  it('a failed or thin map cannot shrink the list (a flaky map must not reset every page)', () => {
    const pagesNow = Array.from({ length: 10 }, (_, i) => `${BASE}/p${i}`)
    const lastPages = pagesNow.map((u) => ({ url: u, statusCode: 200 }))
    const current = [BASE, ...pagesNow]
    expect(sw.nextWatchUrls({ ...base, current, lastPages, mapped: null })).toBeNull()
    expect(sw.nextWatchUrls({ ...base, current, lastPages, mapped: [BASE, `${BASE}/new`] })).toBeNull()
  })

  it('never switches a crawl to a one-page watch from nothing', () => {
    expect(sw.nextWatchUrls({ ...base, current: [], lastPages: [], mapped: null })).toBeNull()
    expect(sw.nextWatchUrls({ ...base, current: [], lastPages: [], mapped: [`${BASE}/`, `${BASE}/terms`] })).toEqual([BASE, `${BASE}/terms`])
  })

  it('adds new mapped pages while there is room', () => {
    const current = [`${BASE}/`, `${BASE}/terms`]
    const next = sw.nextWatchUrls({
      ...base,
      current,
      lastPages: [page('/'), page('/terms')],
      mapped: [`${BASE}/`, `${BASE}/terms`, `${BASE}/new`],
    })
    expect(next).toEqual([`${BASE}/`, `${BASE}/terms`, `${BASE}/new`])
  })
})

describe('refreshWatchPages (the daily page-list refresh)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const W = { id: 'w1', base_url: BASE, page_limit: 100, schedule_cron: '30 1 * * *', firecrawl_monitor_id: 'mon-1' }
  const ua = { headers: { 'User-Agent': sw.SITE_WATCH_USER_AGENT } }
  const crawlMonitor = { name: 'watch', targets: [{ type: 'crawl', url: BASE, scrapeOptions: ua }] }
  const listMonitor = (urls: string[]) => ({
    name: 'watch',
    targets: [{ type: 'scrape', urls: urls.map((u) => tagMonitorUrl(u, 'watch')), scrapeOptions: ua }],
  })

  /** A fake Firecrawl: GET monitor, GET check pages, PATCH monitor (recorded). */
  function firecrawl(monitor: unknown, checkPagesData: unknown[] = []) {
    const patches: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (init.method === 'PATCH') {
          patches.push(JSON.parse(String(init.body)))
          return new Response(JSON.stringify({ success: true, data: {} }))
        }
        if (String(url).includes('/checks/')) return new Response(JSON.stringify({ data: { pages: checkPagesData } }))
        return new Response(JSON.stringify({ success: true, data: monitor }))
      }),
    )
    return patches
  }
  const deps = (mapped: string[] | Error) => ({
    map: vi.fn(async (_baseUrl: string, _limit: number) => {
      if (mapped instanceof Error) throw mapped
      return mapped
    }),
    // Like kensaur.us: the bare base answers 301 to its trailing-slash form.
    resolve: vi.fn(async (urls: string[]) => urls.map((u) => (u === BASE ? `${BASE}/` : u))),
    now: () => new Date('2026-11-14T02:14:00Z'),
  })
  /** Reads `reports` from `reports`; everything else from the site-watch fake. */
  const withReports = (inner: { from: (t: string) => unknown }, reports: Array<{ id: string; status: string }>) =>
    ({
      from: (t: string) =>
        t === 'reports'
          ? {
              select: () => ({ in: async (_c: string, ids: string[]) => ({ data: reports.filter((r) => ids.includes(r.id)), error: null }) }),
            }
          : inner.from(t),
    }) as never
  const done = (id: string) => ({ id, status: 'completed' })

  it('switches a crawl monitor to a marked page list on the first poll, from the newest check and the map', async () => {
    const { db, pages } = makeDb([
      // An open finding for a crawl page that will not be watched any more.
      { id: 'f1', watch_id: 'w1', url: `${BASE}/elsewhere`, problem: 'http_error', resolved_at: null, report_id: 'r1', confirmed_at: '2026-11-10T00:00:00Z' },
    ])
    const patches = firecrawl(crawlMonitor, [ok(`${BASE}/`), ok(`${BASE}/linked`)])
    const d = deps([`${BASE}/`, `${BASE}/terms`])
    const r = await sw.refreshWatchPages(db, W, 'fc-key', [done('c9')], null, d)
    expect(r).toMatchObject({ reconciled: true, pages: 3, closedFindings: 1 })
    expect(patches).toHaveLength(1)
    expect(patches[0].targets).toEqual([
      { type: 'scrape', urls: [`${BASE}/`, `${BASE}/linked`, `${BASE}/terms`].map((u) => `${u}?${WATCH_TAG}`), scrapeOptions: ua },
    ])
    // The map is URL discovery: asked for room to choose from, and never marked.
    expect(d.map).toHaveBeenCalledWith(BASE, 500)
    // Every page new to the monitor was resolved to the site's own spelling first.
    expect(d.resolve).toHaveBeenCalledWith([BASE, `${BASE}/linked`, `${BASE}/terms`])
    expect(pages.find((p) => p.id === 'f1')!.resolved_at).toBe('2026-11-14T02:14:00.000Z')
  })

  it('does nothing between daily checks on a current monitor (no map credit, no PATCH)', async () => {
    const { db } = makeDb()
    const patches = firecrawl(listMonitor([`${BASE}/`, `${BASE}/terms`]))
    const d = deps([`${BASE}/`])
    expect(await sw.refreshWatchPages(db, W, 'fc-key', [], null, d)).toBeNull()
    expect(d.map).not.toHaveBeenCalled()
    expect(patches).toHaveLength(0)
  })

  it('after a daily check, PATCHes only when the page set changed', async () => {
    const { db } = makeDb()
    const patches = firecrawl(listMonitor([`${BASE}/`, `${BASE}/terms`]))
    const read = [ok(`${BASE}/`), ok(`${BASE}/terms`)]
    expect(await sw.refreshWatchPages(db, W, 'fc-key', [], read, deps([`${BASE}/`, `${BASE}/terms`]))).toMatchObject({ pages: 2 })
    expect(patches).toHaveLength(0)
    await sw.refreshWatchPages(db, W, 'fc-key', [], read, deps([`${BASE}/`, `${BASE}/terms`, `${BASE}/new`]))
    expect(patches).toHaveLength(1)
  })

  it('keeps a broken link watched while its finding is open, even after the sitemap dropped it; drops it once a person closes the report', async () => {
    const suspect = { id: 's1', watch_id: 'w1', url: `${BASE}/gone`, problem: 'http_error', resolved_at: null, report_id: null, confirmed_at: null }
    const f = makeDb([suspect])
    const reports: Array<{ id: string; status: string }> = []
    const db = withReports(f.db as never, reports)
    const patches = firecrawl(listMonitor([`${BASE}/`, `${BASE}/gone`]))
    const read = [ok(`${BASE}/`), broken('/gone', 404)]
    const mapWithoutGone = [`${BASE}/`, `${BASE}/terms`]
    // A suspect not filed yet: stays.
    await sw.refreshWatchPages(db, W, 'fc-key', [], read, deps(mapWithoutGone))
    expect(JSON.stringify(patches.at(-1))).toContain(`/gone?${WATCH_TAG}`)
    expect(f.pages[0].resolved_at).toBeNull()
    // Filed, report open, still 404: stays, and its finding stays open (the Home light stays red).
    Object.assign(f.pages[0], { report_id: 'r-s1', confirmed_at: '2026-11-14T01:40:00Z' })
    reports.push({ id: 'r-s1', status: 'new' })
    const before = patches.length
    await sw.refreshWatchPages(db, W, 'fc-key', [], read, deps(mapWithoutGone))
    expect(patches.length).toBeGreaterThan(before)
    expect(JSON.stringify(patches.at(-1))).toContain(`/gone?${WATCH_TAG}`)
    expect(f.pages[0].resolved_at).toBeNull()
    // A person dismissed the report (the page was removed on purpose): it may leave.
    reports[0].status = 'dismissed'
    await sw.refreshWatchPages(db, W, 'fc-key', [], read, deps(mapWithoutGone))
    expect(JSON.stringify(patches.at(-1))).not.toContain('/gone')
    expect(f.pages[0].resolved_at).toBe('2026-11-14T02:14:00.000Z')
  })

  it('stores the estimate Firecrawl returns for the new page list', async () => {
    const f = makeDb()
    const updates: Array<Record<string, unknown>> = []
    const db = {
      from: (t: string) =>
        t === 'site_watches'
          ? { update: (p: Record<string, unknown>) => ({ eq: async () => (updates.push(p), { error: null }) }) }
          : (f.db as unknown as { from: (t: string) => unknown }).from(t),
    } as never
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit = {}) =>
        init.method === 'PATCH'
          ? new Response(JSON.stringify({ success: true, data: { estimatedCreditsPerMonth: 1530 } }))
          : new Response(JSON.stringify({ success: true, data: crawlMonitor })),
      ),
    )
    await sw.refreshWatchPages(db, W, 'fc-key', [], [ok(`${BASE}/`), ok(`${BASE}/a`)], deps([`${BASE}/`, `${BASE}/a`]))
    expect(updates).toEqual([{ estimated_credits_per_month: 1530 }])
  })

  it('a failed map still fixes a stale shape from the pages it has, and never PATCHes a one-page list from nothing', async () => {
    const { db } = makeDb()
    const patches = firecrawl(crawlMonitor, [])
    const r = await sw.refreshWatchPages(db, W, 'fc-key', [done('c1')], null, deps(new Error('FIRECRAWL_HTTP_500')))
    expect(r).toMatchObject({ mapFailed: true })
    expect(patches).toHaveLength(0)
    await sw.refreshWatchPages(db, W, 'fc-key', [], [ok(`${BASE}/`), ok(`${BASE}/a`)], deps(new Error('down')))
    expect(patches[0].targets).toEqual([expect.objectContaining({ urls: [`${BASE}/?${WATCH_TAG}`, `${BASE}/a?${WATCH_TAG}`] })])
  })
})

describe('resolveSameSiteRedirects', () => {
  it('takes the redirect target only for the same page (a slash added or removed); a HEAD, no redirect followed', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const f = (async (url: string, init: RequestInit = {}) => {
      seen.push({ url, init })
      const at = (status: number, location?: string) => new Response(null, { status, headers: location ? { location } : {} })
      if (url === BASE) return at(301, `${BASE}/`)
      if (url === `${BASE}/old`) return at(301, `${BASE}/new`)
      if (url === `${BASE}/away`) return at(302, 'https://elsewhere.example/away/')
      if (url === `${BASE}/rel`) return at(308, '/help-her-take-photo/rel/')
      if (url === `${BASE}/boom`) throw new TypeError('network down')
      return at(200)
    }) as unknown as typeof fetch
    const urls = [BASE, `${BASE}/old`, `${BASE}/away`, `${BASE}/rel`, `${BASE}/boom`, `${BASE}/ok`]
    expect(await sw.resolveSameSiteRedirects(urls, f)).toEqual([
      `${BASE}/`,
      `${BASE}/old`,
      `${BASE}/away`,
      `${BASE}/rel/`,
      `${BASE}/boom`,
      `${BASE}/ok`,
    ])
    for (const { init } of seen) {
      expect(init.method).toBe('HEAD')
      expect(init.redirect).toBe('manual')
      expect((init.headers as Record<string, string>)['User-Agent']).toBe(sw.SITE_WATCH_USER_AGENT)
    }
  })
})
