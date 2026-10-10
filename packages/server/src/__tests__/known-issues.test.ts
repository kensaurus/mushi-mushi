/**
 * FILE: known-issues.test.ts
 * PURPOSE: "Has anyone hit this?" — the query built from a report's error,
 *          and the lookup's skip / once-per-report / attach behaviour.
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

  it('caps a long error at a word boundary', async () => {
    const long = `Error: ${'something went quite wrong '.repeat(20)}`
    const q = (await queryFor({ description: null, customMetadata: null, consoleLogs: [{ level: 'error', message: long }] }))!
    expect(q.length).toBeLessThanOrEqual(150)
    expect(q.endsWith(' ')).toBe(false)
  })
})

/** A fake db that records inserts and answers the "already attached?" count. */
function makeDb(state: { attachedCount: number; inserted: Array<{ table: string; rows: unknown }> }) {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        then: (resolve: (v: unknown) => void) => resolve({ count: state.attachedCount, error: null }),
        insert(rows: unknown) {
          state.inserted.push({ table, rows })
          const ins = {
            select: () => ins,
            single: () => Promise.resolve({ data: { id: 'sess-1' }, error: null }),
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          }
          return ins
        },
      }
      return q
    },
  } as never
}

describe('lookupKnownIssues', () => {
  let state: { attachedCount: number; inserted: Array<{ table: string; rows: unknown }> }
  beforeEach(() => {
    state = { attachedCount: 0, inserted: [] }
    firecrawl.resolveFirecrawl.mockReset().mockResolvedValue({ key: 'k' })
    firecrawl.firecrawlSearch.mockReset().mockResolvedValue([
      { url: 'https://github.com/supabase/realtime-js/issues/1', title: 'cannot add callbacks', snippet: 'reuse of channel' },
    ])
  })
  const input = { projectId: 'p1', reportId: 'r1', ...sentryReport }

  it('searches GitHub and Stack Overflow once and attaches the results to the report', async () => {
    const res = await mod.lookupKnownIssues(makeDb(state), input)
    expect(res).toEqual({ attached: 1 })
    expect(firecrawl.firecrawlSearch).toHaveBeenCalledWith(expect.anything(), 'p1', expect.any(String), {
      limit: 3,
      domains: ['github.com', 'stackoverflow.com'],
    })
    const snippets = state.inserted.find((i) => i.table === 'research_snippets')!.rows as Array<Record<string, unknown>>
    expect(snippets[0]).toMatchObject({ attached_to_report_id: 'r1', attached_by: null, session_id: 'sess-1' })
    const session = state.inserted.find((i) => i.table === 'research_sessions')!.rows as Record<string, unknown>
    expect(session).toMatchObject({ created_by: null, mode: 'search' })
  })

  it('does nothing without a Firecrawl key, or when results are already attached', async () => {
    firecrawl.resolveFirecrawl.mockResolvedValueOnce(null)
    expect(await mod.lookupKnownIssues(makeDb(state), input)).toEqual({ attached: 0, skipped: 'no_key' })
    state.attachedCount = 2
    expect(await mod.lookupKnownIssues(makeDb(state), input)).toEqual({ attached: 0, skipped: 'already_attached' })
    expect(firecrawl.firecrawlSearch).not.toHaveBeenCalled()
  })

  it('never throws: a failed search is reported as skipped', async () => {
    firecrawl.firecrawlSearch.mockRejectedValueOnce(new Error('FIRECRAWL_RATE_LIMITED'))
    expect(await mod.lookupKnownIssues(makeDb(state), input)).toEqual({ attached: 0, skipped: 'error' })
  })

  it('spends nothing on a report with no error message', async () => {
    const res = await mod.lookupKnownIssues(makeDb(state), { ...input, description: 'Add dark mode', customMetadata: null })
    expect(res).toEqual({ attached: 0, skipped: 'no_query' })
    expect(firecrawl.resolveFirecrawl).not.toHaveBeenCalled()
  })
})
