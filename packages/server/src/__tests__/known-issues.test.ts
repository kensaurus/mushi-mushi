/**
 * FILE: known-issues.test.ts
 * PURPOSE: "Has anyone hit this?" — the query built from a report's error,
 *          and the lookup's opt-in / skip / once-per-report / attach
 *          behaviour. The search sends report text to Firecrawl, so it runs
 *          only when the project turned known_issues_search_enabled on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const firecrawl = vi.hoisted(() => ({
  resolveFirecrawl: vi.fn(),
  firecrawlSearch: vi.fn(),
}))
vi.mock('../../supabase/functions/_shared/firecrawl.ts', () => firecrawl)

const mod = await import('../../supabase/functions/_shared/known-issues.ts')

/** The query a report would be searched with, via the real lookup. */
async function queryFor(source: { description: string | null; customMetadata: Record<string, unknown> | null; consoleLogs: unknown }) {
  firecrawl.resolveFirecrawl.mockReset().mockResolvedValue({ key: 'k' })
  firecrawl.firecrawlSearch.mockReset().mockResolvedValue([])
  const db = {
    from() {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.then = (resolve: (v: unknown) => void) => resolve({ count: 0, error: null })
      q.maybeSingle = async () => ({ data: { known_issues_search_enabled: true }, error: null })
      q.insert = () => ({ select: () => ({ single: async () => ({ data: { id: 's' }, error: null }) }) })
      return q
    },
  } as never
  await mod.lookupKnownIssues(db, { projectId: 'p', reportId: 'r', ...source })
  return (firecrawl.firecrawlSearch.mock.calls[0]?.[2] as string | undefined) ?? null
}

const sentryReport = {
  description:
    'Error: cannot add `postgres_changes` callbacks for realtime:captures-camera-fbbcbafd-3872-4080-8fd4-057a79d59801 after `subscribe()`. in on(index.android) (captured by Sentry — no user description)\n\nEvent extra:\nx',
  customMetadata: { source: 'sentry_webhook', culprit: 'on(index.android)' },
  consoleLogs: [],
}

describe('the search query for a report', () => {
  it('takes the Sentry error line without the culprit, the capture note or the ids', async () => {
    const q = (await queryFor(sentryReport))!
    expect(q).toContain('cannot add postgres_changes callbacks for realtime:captures-camera')
    expect(q).toContain('after subscribe()')
    expect(q).not.toMatch(/fbbcbafd|in on\(index\.android\)|captured by Sentry|`/)
  })

  it('uses the first error-level console line for a widget report', async () => {
    const q = await queryFor({
      description: 'The button does nothing',
      customMetadata: { source: 'widget' },
      consoleLogs: [
        { level: 'warn', message: 'slow' },
        { level: 'error', message: 'TypeError: Cannot read properties of undefined (reading map) at https://x.example/app.js:1:2' },
      ],
    })
    expect(q).toBe('TypeError: Cannot read properties of undefined (reading map) at')
  })

  it('has nothing to search for feedback without an error, or a one-word error', async () => {
    expect(await queryFor({ description: 'Please add dark mode', customMetadata: null, consoleLogs: [] })).toBeNull()
    expect(await queryFor({ description: null, customMetadata: null, consoleLogs: [{ level: 'error', message: 'oops' }] })).toBeNull()
  })

  it('does not search app telemetry sent through Sentry (glot.it, 2026-10-10)', async () => {
    for (const line of [
      'Poor TTFB: 2467.2 on /account in https://kensaur.us/glot-it/account/',
      'Rage click: 3x on button[Skip].inline-flex at / in /glot-it/',
      'sync_timeout in /glot-it/learn/thai-on-duolingo/',
      '[mistakes] fetch_patterns_failed in /glot-it/practice/',
    ]) {
      const q = await queryFor({
        description: `${line} (captured by Sentry — no user description)`,
        customMetadata: { source: 'sentry_webhook' },
        consoleLogs: [],
      })
      expect(q, line).toBeNull()
    }
  })

  it('caps a long error at a word boundary', async () => {
    const long = `Error: ${'something went quite wrong '.repeat(20)}`
    const q = (await queryFor({ description: null, customMetadata: null, consoleLogs: [{ level: 'error', message: long }] }))!
    expect(q.length).toBeLessThanOrEqual(150)
    expect(q.endsWith(' ')).toBe(false)
  })
})

interface DbState {
  /** URLs already attached to the report. */
  attached: string[]
  /** Sessions with the same query in the repeat window. */
  recentSessions: number
  inserted: Array<{ table: string; rows: unknown }>
  /** What reading project_settings.known_issues_search_enabled returns. */
  settings: { data: unknown; error: { message: string } | null }
}

/** A fake db that answers the opt-in read, records inserts and answers the attached / recent reads. */
function makeDb(state: DbState) {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => (table === 'project_settings' ? state.settings : { data: null, error: null }),
        gte: () => q,
        then: (resolve: (v: unknown) => void) =>
          resolve(
            table === 'research_snippets'
              ? { data: state.attached.map((url) => ({ url })), error: null }
              : { count: state.recentSessions, error: null },
          ),
        insert(rows: unknown) {
          state.inserted.push({ table, rows })
          const ins = {
            select: () => ins,
            single: () => Promise.resolve({ data: { id: 'sess-1' }, error: null }),
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          }
          return ins
        },
        update(patch: Record<string, unknown>) {
          // The session's result_count, written after the search.
          const row = state.inserted.find((i) => i.table === table)
          if (row) Object.assign(row.rows as Record<string, unknown>, patch)
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
      return q
    },
  } as never
}

describe('lookupKnownIssues', () => {
  let state: DbState
  // Each mentions the error's first words, as a real result about it does.
  const PR = { url: 'https://github.com/o/r/pull/9', title: 'Fix: cannot add postgres_changes callbacks', snippet: 'resubscribe' }
  const ISSUE = { url: 'https://github.com/supabase/realtime-js/issues/1', title: 'Cannot add `postgres_changes` callbacks after subscribe()', snippet: 'reuse of channel' }
  const SO = { url: 'https://stackoverflow.com/q/1', title: 'Supabase realtime', snippet: 'Error: cannot add postgres_changes callbacks for realtime' }
  /** Developer-index results first, then web results. */
  function searches(developer: unknown[], web: unknown[] = []) {
    firecrawl.firecrawlSearch.mockReset().mockImplementation(async (_db: unknown, _p: string, _q: string, opts: { category?: string }) =>
      opts.category === 'developer' ? developer : web,
    )
  }
  beforeEach(() => {
    state = {
      attached: [],
      recentSessions: 0,
      inserted: [],
      settings: { data: { known_issues_search_enabled: true }, error: null },
    }
    firecrawl.resolveFirecrawl.mockReset().mockResolvedValue({ key: 'k' })
    searches([ISSUE])
  })
  const input = { projectId: 'p1', reportId: 'r1', ...sentryReport }
  const snippetUrls = () =>
    ((state.inserted.find((i) => i.table === 'research_snippets')?.rows ?? []) as Array<{ url: string }>).map((r) => r.url)

  it('searches the developer index first, then fills the rest from GitHub and Stack Overflow', async () => {
    searches([PR], [SO, PR])
    const res = await mod.lookupKnownIssues(makeDb(state), input)
    expect(res).toMatchObject({ attached: 2 })
    expect(firecrawl.firecrawlSearch.mock.calls[0]![3]).toMatchObject({ limit: 3, category: 'developer', scrape: false })
    expect(firecrawl.firecrawlSearch.mock.calls[1]![3]).toMatchObject({ limit: 3, domains: ['github.com', 'stackoverflow.com'] })
    // The PR comes first and the duplicate web copy of it is dropped.
    expect(snippetUrls()).toEqual([PR.url, SO.url])
    const snippets = state.inserted.find((i) => i.table === 'research_snippets')!.rows as Array<Record<string, unknown>>
    expect(snippets[0]).toMatchObject({ attached_to_report_id: 'r1', attached_by: null, session_id: 'sess-1' })
    const session = state.inserted.find((i) => i.table === 'research_sessions')!.rows as Record<string, unknown>
    expect(session).toMatchObject({ created_by: null, mode: 'search' })
  })

  it('skips the web search when the developer index fills every slot', async () => {
    searches([PR, ISSUE, SO])
    await mod.lookupKnownIssues(makeDb(state), input)
    expect(firecrawl.firecrawlSearch).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a Firecrawl key, or when results are already attached', async () => {
    firecrawl.resolveFirecrawl.mockResolvedValueOnce(null)
    expect(await mod.lookupKnownIssues(makeDb(state), input)).toMatchObject({ attached: 0, skipped: 'no_key' })
    state.attached = [ISSUE.url]
    expect(await mod.lookupKnownIssues(makeDb(state), input)).toMatchObject({ attached: 0, skipped: 'already_attached' })
    expect(firecrawl.firecrawlSearch).not.toHaveBeenCalled()
  })

  it('sends nothing to Firecrawl unless the project turned the search on', async () => {
    const off: Array<[string, DbState['settings']]> = [
      ['setting off', { data: { known_issues_search_enabled: false }, error: null }],
      ['no settings row', { data: null, error: null }],
      ['column missing (migration not applied)', { data: null, error: { message: 'column does not exist' } }],
    ]
    for (const [label, settings] of off) {
      state.settings = settings
      expect(await mod.lookupKnownIssues(makeDb(state), input), label).toMatchObject({ attached: 0, skipped: 'disabled' })
    }
    // "Search again" goes through the same gate.
    state.settings = off[0][1]
    expect(await mod.lookupKnownIssues(makeDb(state), { ...input, force: true, requestedBy: 'u1' })).toMatchObject({ skipped: 'disabled' })
    expect(firecrawl.resolveFirecrawl).not.toHaveBeenCalled()
    expect(firecrawl.firecrawlSearch).not.toHaveBeenCalled()
    expect(state.inserted).toEqual([])
  })

  it('searches when the project turned it on', async () => {
    state.settings = { data: { known_issues_search_enabled: true }, error: null }
    await mod.lookupKnownIssues(makeDb(state), input)
    expect(firecrawl.firecrawlSearch).toHaveBeenCalled()
  })

  it('"Search again" runs anyway, adds only new results, and records who asked', async () => {
    state.attached = [ISSUE.url]
    searches([ISSUE, PR])
    const res = await mod.lookupKnownIssues(makeDb(state), { ...input, force: true, requestedBy: 'user-1' })
    expect(res).toMatchObject({ attached: 1 })
    expect(snippetUrls()).toEqual([PR.url])
    expect(firecrawl.firecrawlSearch.mock.calls[0]![3]).toMatchObject({ bypassCache: true })
    const session = state.inserted.find((i) => i.table === 'research_sessions')!.rows as Record<string, unknown>
    expect(session).toMatchObject({ created_by: 'user-1' })
  })

  it('"Search again" twice within ten minutes searches once', async () => {
    state.recentSessions = 1
    expect(await mod.lookupKnownIssues(makeDb(state), { ...input, force: true })).toMatchObject({ attached: 0, skipped: 'recent' })
    expect(firecrawl.firecrawlSearch).not.toHaveBeenCalled()
  })

  it('a failed developer search falls back to the web search', async () => {
    firecrawl.firecrawlSearch.mockReset()
      .mockRejectedValueOnce(new Error('FIRECRAWL_HTTP_400'))
      .mockResolvedValueOnce([SO])
    expect(await mod.lookupKnownIssues(makeDb(state), input)).toMatchObject({ attached: 1 })
    expect(snippetUrls()).toEqual([SO.url])
  })

  it('drops results about something else that shares a word or two', async () => {
    // The solo-boss "Request was aborted" lookup (2026-10-10) attached these.
    const abortReport = {
      description: 'Error: Request was aborted. in POST /api/file-uploads/:file_id/analyze (captured by Sentry — no user description)',
      customMetadata: { source: 'sentry_webhook', culprit: 'POST /api/file-uploads/:file_id/analyze', platform: 'node' },
      consoleLogs: [],
    }
    const shopify = { url: 'https://community.shopify.dev/t/15054', title: 'AbortError: The user aborted a request', snippet: 'a request timeout or cancellation' }
    const aurelia = { url: 'https://github.com/aurelia/aurelia/blob/x/abort-controller.md', title: 'Request Cancellation with AbortController', snippet: 'aborted requests' }
    const vellum = { url: 'https://github.com/vellum-ai/vellum-assistant/pull/26676', title: 'vellum-ai/vellum-assistant#26676', snippet: 'remove /request was aborted/i from RETRYABLE_NETWORK_MESSAGE_PATTERNS' }
    searches([shopify, vellum], [aurelia])
    const res = await mod.lookupKnownIssues(makeDb(state), { projectId: 'p1', reportId: 'r1', ...abortReport })
    expect(res).toMatchObject({ attached: 1 })
    expect(snippetUrls()).toEqual([vellum.url])
  })

  it("searches Sentry's WatchdogTermination crash and keeps results about it", async () => {
    const watchdog = {
      description: 'WatchdogTermination: The OS watchdog terminated your app, possibly because it overused RAM. (captured by Sentry — no user description)',
      customMetadata: { source: 'sentry_webhook', platform: 'cocoa' },
      consoleLogs: [],
    }
    const lottie = { url: 'https://github.com/lottie-react-native/lottie-react-native/issues/1364', title: 'The OS watchdog terminated your app, possibly because it overused RAM.', snippet: '' }
    const other = { url: 'https://example.dev/watchdog', title: 'Watchdog timers in embedded C', snippet: 'reset the watchdog' }
    searches([lottie, other])
    const res = await mod.lookupKnownIssues(makeDb(state), { projectId: 'p1', reportId: 'r1', ...watchdog })
    expect(res).toMatchObject({ attached: 1 })
    expect(snippetUrls()).toEqual([lottie.url])
  })

  it('adds the runtime to a short error, not to a long one', async () => {
    const short = {
      description: 'Error: Request was aborted. (captured by Sentry — no user description)',
      customMetadata: { source: 'sentry_webhook', platform: 'node' },
      consoleLogs: [],
    }
    expect(await queryFor(short)).toBe('Error: Request was aborted. node')
    expect(await queryFor({ ...sentryReport, customMetadata: { ...sentryReport.customMetadata, platform: 'javascript' } })).not.toMatch(
      /javascript$/,
    )
  })

  describe('review fixes 2026-10-10', () => {
    const sentry = (line: string, platform = 'javascript') => ({
      projectId: 'p1',
      reportId: 'r1',
      description: `${line} (captured by Sentry — no user description)`,
      customMetadata: { source: 'sentry_webhook', platform },
      consoleLogs: [],
    })

    it('a short error keeps its matching results: the runtime word is not required', async () => {
      // "TypeError: Load failed" + javascript used to require "load failed javascript".
      const hit = { url: 'https://stackoverflow.com/q/load-failed', title: 'TypeError: Load failed in Safari', snippet: 'fetch' }
      searches([hit])
      const res = await mod.lookupKnownIssues(makeDb(state), sentry('TypeError: Load failed'))
      expect(firecrawl.firecrawlSearch.mock.calls[0]![2]).toBe('TypeError: Load failed javascript')
      // Two words: no phrase, nothing filtered.
      expect(res).toMatchObject({ attached: 1 })
    })

    it('an "Uncaught" prefix and chunk numbers do not make every result fail the filter', async () => {
      const uncaught = { url: 'https://github.com/a/b/issues/1', title: "Cannot read properties of undefined (reading 'map')", snippet: '' }
      searches([uncaught])
      expect(
        await mod.lookupKnownIssues(makeDb(state), sentry("Uncaught TypeError: Cannot read properties of undefined (reading 'map')")),
      ).toMatchObject({ attached: 1 })

      state.inserted = []
      const chunk = { url: 'https://github.com/vercel/next.js/issues/2', title: 'ChunkLoadError: Loading chunk 812 failed', snippet: '' }
      searches([chunk])
      expect(await mod.lookupKnownIssues(makeDb(state), sentry('ChunkLoadError: Loading chunk 123 failed'))).toMatchObject({ attached: 1 })
    })

    it('neither search pays for page fetches', async () => {
      searches([], [SO])
      await mod.lookupKnownIssues(makeDb(state), input)
      for (const call of firecrawl.firecrawlSearch.mock.calls) expect(call[3]).toMatchObject({ scrape: false })
    })

    it('the search is recorded before it spends, so a failed one still counts against the repeat window', async () => {
      firecrawl.firecrawlSearch.mockReset().mockRejectedValue(new Error('FIRECRAWL_HTTP_500'))
      expect(await mod.lookupKnownIssues(makeDb(state), { ...input, force: true })).toMatchObject({ skipped: 'error' })
      const sessions = state.inserted.filter((i) => i.table === 'research_sessions')
      expect(sessions).toHaveLength(1)
    })
  })

  it('never throws: a failed search is reported as skipped', async () => {
    firecrawl.firecrawlSearch.mockReset().mockRejectedValue(new Error('FIRECRAWL_RATE_LIMITED'))
    expect(await mod.lookupKnownIssues(makeDb(state), input)).toMatchObject({ attached: 0, skipped: 'error' })
  })

  it('spends nothing on a report with no error message', async () => {
    const res = await mod.lookupKnownIssues(makeDb(state), { ...input, description: 'Add dark mode', customMetadata: null })
    expect(res).toEqual({ attached: 0, skipped: 'no_query' })
    expect(firecrawl.resolveFirecrawl).not.toHaveBeenCalled()
  })
})
