/**
 * FILE: sentry-import.test.ts
 * PURPOSE: Pin the Sentry pull-import: request validation, REST → webhook
 *          event mapping, id dedupe, the one-Sentry-project boundary, and
 *          that every issue goes through ingestSentryError.
 */

import { describe, it, expect, beforeEach } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const api = await import('../../supabase/functions/_shared/sentry-api.ts')
const imp = await import('../../supabase/functions/_shared/sentry-import.ts')

interface Row {
  [k: string]: unknown
}

function makeDb(state: { links: Row[]; inserted: { table: string; row: Row }[] }) {
  function table(name: string) {
    return {
      select: () => table(name),
      eq: () => table(name),
      insert: (row: Row) => {
        state.inserted.push({ table: name, row })
        if (name === 'report_external_issues') state.links.push({ report_id: row.report_id, external_id: row.external_id })
        return Promise.resolve({ error: null })
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      maybeSingle: () => Promise.resolve({ data: name === 'report_external_issues' ? null : null }),
    }
  }
  return { from: (name: string) => table(name) } as never
}

const ISSUE = {
  id: '4501',
  shortId: 'GLOT-IT-C4',
  title: 'Error: [object Object]',
  culprit: 'stores/mistake-patterns',
  level: 'error',
  permalink: 'https://sakuramoto.sentry.io/issues/4501/',
  platform: 'javascript',
  project: { slug: 'glot-it' },
}

const EVENT = {
  eventID: 'evt-9',
  title: 'Error: [object Object]',
  platform: 'javascript',
  release: { version: '2.3.1' },
  tags: [
    { key: 'environment', value: 'production' },
    { key: 'level', value: 'error' },
  ],
  context: { logMessage: 'fetch_patterns_failed' },
  entries: [
    {
      type: 'exception',
      data: {
        values: [
          {
            type: 'Error',
            value: '[object Object]',
            stacktrace: {
              frames: [
                { filename: 'app:///_next/static/chunks/main.js', lineNo: 1, inApp: false },
                { filename: 'app:///stores/mistake-patterns.ts', function: 'fetchPatterns', lineNo: 58, colNo: 11, inApp: true },
              ],
            },
          },
        ],
      },
    },
    { type: 'request', data: { url: 'https://glot.it/review' } },
  ],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeSentry(routes: Record<string, () => Response>) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    const path = url.replace(api.SENTRY_API_BASE, '')
    calls.push(path)
    const key = Object.keys(routes).find((k) => path.startsWith(k))
    return key ? routes[key]() : json({ detail: 'not found' }, 404)
  }
  return { fetchImpl, calls }
}

describe('parseSentryImportRequest', () => {
  it('defaults limit and dedupes ids', () => {
    const r = imp.parseSentryImportRequest({ issueIds: ['GLOT-IT-C4', ' GLOT-IT-C4 ', '4501'] })
    expect(r).toEqual({ ok: true, value: { issueIds: ['GLOT-IT-C4', '4501'], query: undefined, limit: 5 } })
  })

  it('rejects more than 10 ids, junk ids, bad limits, and ids plus query', () => {
    expect(imp.parseSentryImportRequest({ issueIds: Array.from({ length: 11 }, (_, i) => `A-${i}`) }).ok).toBe(false)
    expect(imp.parseSentryImportRequest({ issueIds: ['../etc'] }).ok).toBe(false)
    expect(imp.parseSentryImportRequest({ limit: 11 }).ok).toBe(false)
    expect(imp.parseSentryImportRequest({ limit: 0 }).ok).toBe(false)
    expect(imp.parseSentryImportRequest({ issueIds: ['A-1'], query: 'is:unresolved' }).ok).toBe(false)
  })

  it('accepts an empty body (newest unresolved)', () => {
    expect(imp.parseSentryImportRequest({})).toEqual({ ok: true, value: { issueIds: undefined, query: undefined, limit: 5 } })
  })
})

describe('restEventToWebhookEvent', () => {
  it('maps REST field names onto the webhook event shape', () => {
    const e = api.restEventToWebhookEvent(ISSUE, EVENT)
    expect(e.issue_id).toBe('4501')
    expect(e.web_url).toBe(ISSUE.permalink)
    expect(e.event_id).toBe('evt-9')
    expect(e.release).toBe('2.3.1')
    expect(e.environment).toBe('production')
    expect(e.request?.url).toBe('https://glot.it/review')
    expect(e.tags).toContainEqual(['environment', 'production'])
    expect(e.extra).toEqual({ logMessage: 'fetch_patterns_failed' })
    const frame = e.exception!.values![0].stacktrace!.frames![1]
    expect(frame).toMatchObject({ filename: 'app:///stores/mistake-patterns.ts', lineno: 58, colno: 11, in_app: true })
  })

  it('survives an issue with no event', () => {
    const e = api.restEventToWebhookEvent(ISSUE, null)
    expect(e.title).toBe(ISSUE.title)
    expect(e.exception).toBeUndefined()
  })
})

describe('importSentryIssues', () => {
  let state: { links: Row[]; inserted: { table: string; row: Row }[] }
  let classified: string[]
  const sentry = { token: 't', orgSlug: 'sakuramoto', projectSlugs: ['glot-it'] }

  beforeEach(() => {
    state = { links: [], inserted: [], }
    classified = []
  })

  it('imports by short id through ingestSentryError, with frames and short id', async () => {
    const { fetchImpl, calls } = fakeSentry({
      '/organizations/sakuramoto/shortids/GLOT-IT-C4/': () => json({ group: ISSUE, groupId: '4501' }),
      '/organizations/sakuramoto/issues/4501/events/latest/': () => json(EVENT),
    })
    const result = await imp.importSentryIssues(makeDb(state), {
      projectId: 'p1',
      request: { issueIds: ['GLOT-IT-C4'], limit: 5 },
      sentry,
      triggerClassification: (rid) => classified.push(rid),
      fetchImpl,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ issueId: '4501', shortId: 'GLOT-IT-C4', outcome: 'created' })
    expect(result.framePaths).toEqual(['stores/mistake-patterns.ts'])
    const report = state.inserted.find((i) => i.table === 'reports')!.row
    expect((report.custom_metadata as Row).sentryShortId).toBe('GLOT-IT-C4')
    expect((report.custom_metadata as Row).intake).toBe('import')
    expect(report.description).toContain('fetch_patterns_failed')
    expect(state.inserted.find((i) => i.table === 'report_external_issues')!.row.external_id).toBe('4501')
    expect(classified).toHaveLength(1)
    expect(calls).toContain('/organizations/sakuramoto/issues/4501/events/latest/')
  })

  it('imports one issue once when given its id and its short id', async () => {
    const { fetchImpl } = fakeSentry({
      '/organizations/sakuramoto/shortids/GLOT-IT-C4/': () => json({ group: ISSUE }),
      '/organizations/sakuramoto/issues/4501/events/latest/': () => json(EVENT),
      '/organizations/sakuramoto/issues/4501/': () => json(ISSUE),
    })
    const result = await imp.importSentryIssues(makeDb(state), {
      projectId: 'p1',
      request: { issueIds: ['4501', 'GLOT-IT-C4'], limit: 5 },
      sentry,
      triggerClassification: () => {},
      fetchImpl,
    })
    expect(result.items).toHaveLength(1)
    expect(state.inserted.filter((i) => i.table === 'reports')).toHaveLength(1)
  })

  it('refuses an issue from another Sentry project in the same org', async () => {
    const { fetchImpl } = fakeSentry({
      '/organizations/sakuramoto/issues/777/': () => json({ ...ISSUE, id: '777', project: { slug: 'the-wanting-mind' } }),
    })
    const result = await imp.importSentryIssues(makeDb(state), {
      projectId: 'p1',
      request: { issueIds: ['777'], limit: 5 },
      sentry,
      triggerClassification: () => {},
      fetchImpl,
    })
    expect(result.items[0].outcome).toBe('error')
    expect(result.items[0].error).toContain('the-wanting-mind')
    expect(state.inserted).toHaveLength(0)
  })

  it('reports a missing issue per item without failing the batch', async () => {
    const { fetchImpl } = fakeSentry({
      '/organizations/sakuramoto/issues/4501/events/latest/': () => json(EVENT),
      '/organizations/sakuramoto/issues/4501/': () => json(ISSUE),
    })
    const result = await imp.importSentryIssues(makeDb(state), {
      projectId: 'p1',
      request: { issueIds: ['NOPE-1', '4501'], limit: 5 },
      sentry,
      triggerClassification: () => {},
      fetchImpl,
    })
    expect(result.items.map((i) => i.outcome)).toEqual(['error', 'created'])
  })

  it('searches only the configured Sentry project in query mode', async () => {
    const { fetchImpl, calls } = fakeSentry({
      '/projects/sakuramoto/glot-it/issues/': () => json([ISSUE]),
      '/organizations/sakuramoto/issues/4501/events/latest/': () => json({}, 404),
    })
    const result = await imp.importSentryIssues(makeDb(state), {
      projectId: 'p1',
      request: { limit: 3 },
      sentry,
      triggerClassification: () => {},
      fetchImpl,
    })
    expect(calls[0]).toBe('/projects/sakuramoto/glot-it/issues/?query=is%3Aunresolved&limit=3')
    // No retained event: still imports from the issue summary.
    expect(result.items[0].outcome).toBe('created')
    expect(result).toMatchObject({ sentryProject: 'glot-it', nextCursor: null })
  })

  it('pages a backlog: sinceDays narrows the search, cursor walks it, nextCursor says what is left', async () => {
    const next = '<https://sentry.io/api/0/projects/sakuramoto/glot-it/issues/?cursor=1727000000000:0:0>; rel="next"; results="true"; cursor="1727000000000:0:0"'
    const { fetchImpl, calls } = fakeSentry({
      '/projects/sakuramoto/glot-it/issues/': () =>
        new Response(JSON.stringify([ISSUE]), { status: 200, headers: { Link: next } }),
      '/organizations/sakuramoto/issues/4501/events/latest/': () => json(EVENT),
    })
    const result = await imp.importSentryIssues(makeDb(state), {
      projectId: 'p1',
      request: { limit: 10, sinceDays: 30, cursor: '1726000000000:0:0' },
      sentry,
      triggerClassification: () => {},
      fetchImpl,
    })
    expect(calls[0]).toBe(
      '/projects/sakuramoto/glot-it/issues/?query=is%3Aunresolved+lastSeen%3A-30d&limit=10&cursor=1726000000000%3A0%3A0',
    )
    expect(result.nextCursor).toBe('1727000000000:0:0')
  })

  it('searches and accepts an extra Sentry project, still refusing one outside the list', async () => {
    const sbc = { token: 't', orgSlug: 'sakuramoto', projectSlugs: ['sbc-front', 'sbc-be'] }
    const beIssue = { ...ISSUE, id: '900', shortId: 'SBC-BE-1', project: { slug: 'sbc-be' } }
    const { fetchImpl, calls } = fakeSentry({
      '/projects/sakuramoto/sbc-be/issues/': () => json([beIssue]),
      '/organizations/sakuramoto/issues/900/events/latest/': () => json(EVENT),
      '/organizations/sakuramoto/issues/777/': () => json({ ...ISSUE, id: '777', project: { slug: 'glot-it' } }),
    })
    const searched = await imp.importSentryIssues(makeDb(state), {
      projectId: 'p1',
      request: { limit: 10, sentryProject: 'sbc-be' },
      sentry: sbc,
      triggerClassification: () => {},
      fetchImpl,
    })
    expect(calls[0]).toBe('/projects/sakuramoto/sbc-be/issues/?query=is%3Aunresolved&limit=10')
    expect(searched.items[0]).toMatchObject({ shortId: 'SBC-BE-1', outcome: 'created' })
    expect(searched.sentryProject).toBe('sbc-be')

    const foreign = await imp.importSentryIssues(makeDb(state), {
      projectId: 'p1',
      request: { issueIds: ['777'], limit: 5 },
      sentry: sbc,
      triggerClassification: () => {},
      fetchImpl,
    })
    expect(foreign.items[0].outcome).toBe('error')
    expect(foreign.items[0].error).toBe('Issue belongs to Sentry project "glot-it", not "sbc-front" or "sbc-be".')
  })

  it('never searches a Sentry project the Mushi project is not wired to', async () => {
    const { fetchImpl, calls } = fakeSentry({})
    await expect(
      imp.importSentryIssues(makeDb(state), {
        projectId: 'p1',
        request: { limit: 10, sentryProject: 'the-wanting-mind' },
        sentry,
        triggerClassification: () => {},
        fetchImpl,
      }),
    ).rejects.toThrow(/glot-it/)
    expect(calls).toHaveLength(0)
  })
})

describe('backlog paging helpers', () => {
  it('reads the next cursor only when Sentry says results="true"', () => {
    const more = '<u>; rel="previous"; results="false"; cursor="0:0:1", <u>; rel="next"; results="true"; cursor="0:100:0"'
    const done = '<u>; rel="previous"; results="true"; cursor="0:0:1", <u>; rel="next"; results="false"; cursor="0:200:0"'
    expect(api.parseSentryNextCursor(more)).toBe('0:100:0')
    expect(api.parseSentryNextCursor(done)).toBeNull()
    expect(api.parseSentryNextCursor(null)).toBeNull()
  })

  it('lists the primary slug first, then valid extras, deduped', () => {
    expect(imp.allowedSentryProjectSlugs('sbc-front', ['sbc-be', ' sbc-front ', 'Bad Slug', 7])).toEqual(['sbc-front', 'sbc-be'])
    expect(imp.allowedSentryProjectSlugs(null, ['sbc-be'])).toEqual(['sbc-be'])
    expect(imp.allowedSentryProjectSlugs(null, null)).toEqual([])
  })

  it('resolves which project and query a search runs', () => {
    expect(imp.resolveSentrySearch({}, ['glot-it'])).toEqual({ ok: true, projectSlug: 'glot-it', query: 'is:unresolved' })
    expect(imp.resolveSentrySearch({ query: 'is:unresolved level:error', sinceDays: 7, sentryProject: 'b' }, ['a', 'b'])).toEqual({
      ok: true,
      projectSlug: 'b',
      query: 'is:unresolved level:error lastSeen:-7d',
    })
    expect(imp.resolveSentrySearch({ sentryProject: 'c' }, ['a', 'b']).ok).toBe(false)
    expect(imp.resolveSentrySearch({}, []).ok).toBe(false)
  })

  it('validates the backlog fields and keeps them off an issueIds import', () => {
    expect(imp.parseSentryImportRequest({ sinceDays: 30, cursor: '1727000000000:0:0', sentryProject: 'sbc-be', limit: 10 })).toEqual({
      ok: true,
      value: { issueIds: undefined, query: undefined, limit: 10, sinceDays: 30, cursor: '1727000000000:0:0', sentryProject: 'sbc-be' },
    })
    expect(imp.parseSentryImportRequest({ sinceDays: 0 }).ok).toBe(false)
    expect(imp.parseSentryImportRequest({ sinceDays: 91 }).ok).toBe(false)
    expect(imp.parseSentryImportRequest({ cursor: '"><script>' }).ok).toBe(false)
    expect(imp.parseSentryImportRequest({ sentryProject: '../org' }).ok).toBe(false)
    expect(imp.parseSentryImportRequest({ issueIds: ['A-1'], sinceDays: 7 }).ok).toBe(false)
    expect(imp.parseSentryImportRequest({ issueIds: ['A-1'], cursor: '0:10:0' }).ok).toBe(false)
  })
})
