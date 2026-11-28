/**
 * FILE: sentry-last-seen.test.ts
 * PURPOSE: Sentry's own "last seen" for a linked issue
 *          (report_external_issues.last_seen_at, 2026-11-22). A repeat alert
 *          on an open report used to be deduplicated without a write, so the
 *          report page could only say when Mushi Mushi last received an
 *          event. Now every contact with an issue already linked (alert,
 *          poll, import, reopen, the Sentry pull) stores Sentry's lastSeen,
 *          only ever moving it forward, and never fails the ingest around it.
 */

import { describe, expect, it } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const ingest = await import('../../supabase/functions/_shared/sentry-ingest.ts')
const reconcile = await import('../../supabase/functions/_shared/sentry-reconcile.ts')

const P = 'proj-1'
const EVENT = { event_id: 'evt-1', title: 'TypeError: x is undefined', level: 'error', issue_id: '4501', datetime: '2026-11-21T08:00:00Z' }

function db(link: Record<string, unknown> | null, report: Record<string, unknown> | null) {
  return makeFakeDb({
    report_external_issues: link ? [{ id: 'l1', report_id: 'r-1', project_id: P, system: 'sentry', external_id: '4501', last_seen_at: null, ...link }] : [],
    reports: report ? [{ id: 'r-1', project_id: P, regression_count: 0, created_at: '2026-11-17T00:00:00Z', ...report }] : [],
  })
}
const lastSeen = (d: ReturnType<typeof db>) => d.table('report_external_issues').find((l) => l.external_id === '4501')?.last_seen_at

describe('sentryLastSeenAt', () => {
  it("prefers the issue's lastSeen, then the event's own time; never firstSeen or now", () => {
    expect(ingest.sentryLastSeenAt(EVENT, { lastSeen: '2026-11-22T01:02:03Z' })).toBe('2026-11-22T01:02:03.000Z')
    expect(ingest.sentryLastSeenAt(EVENT, null)).toBe('2026-11-21T08:00:00.000Z')
    expect(ingest.sentryLastSeenAt({ timestamp: 1_795_000_000 }, null)).toBe(new Date(1_795_000_000_000).toISOString())
    expect(ingest.sentryLastSeenAt(null, { firstSeen: '2026-11-01T00:00:00Z' })).toBeNull()
    expect(ingest.sentryLastSeenAt(null, null)).toBeNull()
  })
})

describe('recordSentryLastSeen', () => {
  it('moves forward only, and only on that issue of that app', async () => {
    const d = db({ last_seen_at: '2026-11-20T00:00:00.000Z' }, null)
    d.table('report_external_issues').push({ id: 'l2', report_id: 'r-2', project_id: 'other', system: 'sentry', external_id: '4501', last_seen_at: null })
    await ingest.recordSentryLastSeen(d as never, P, '4501', '2026-11-19T00:00:00.000Z')
    expect(lastSeen(d)).toBe('2026-11-20T00:00:00.000Z')
    await ingest.recordSentryLastSeen(d as never, P, '4501', '2026-11-22T00:00:00.000Z')
    expect(lastSeen(d)).toBe('2026-11-22T00:00:00.000Z')
    expect(d.table('report_external_issues').find((l) => l.project_id === 'other')?.last_seen_at).toBeNull()
    await ingest.recordSentryLastSeen(d as never, P, '4501', null)
    expect(lastSeen(d)).toBe('2026-11-22T00:00:00.000Z')
  })

  it('never throws: a missing column (migration pending) or a broken client only logs', async () => {
    const missing = {
      from: () => {
        const q = { update: () => q, eq: () => q, or: () => Promise.resolve({ error: { code: '42703', message: 'column "last_seen_at" does not exist' } }) }
        return q
      },
    }
    await expect(ingest.recordSentryLastSeen(missing as never, P, '4501', '2026-11-22T00:00:00.000Z')).resolves.toBeUndefined()
    await expect(ingest.recordSentryLastSeen({ from: () => { throw new Error('down') } } as never, P, '4501', '2026-11-22T00:00:00.000Z')).resolves.toBeUndefined()
  })
})

describe('ingestSentryError stores last seen whenever it hears about a linked issue', () => {
  const run = (d: ReturnType<typeof db>, over: Record<string, unknown> = {}) =>
    ingest.ingestSentryError(d as never, { projectId: P, event: EVENT, issue: null, triggerClassification: () => {}, ...over })

  it('a repeat alert on an open report: deduped, with the alert time stored', async () => {
    const d = db({}, { status: 'classified' })
    expect(await run(d)).toEqual({ outcome: 'deduped', reportId: 'r-1' })
    expect(lastSeen(d)).toBe('2026-11-21T08:00:00.000Z')
  })

  it("the poll and an import store the issue's own lastSeen", async () => {
    const polled = db({}, { status: 'classified' })
    expect((await run(polled, { intake: 'poll', issue: { id: '4501', lastSeen: '2026-11-22T06:00:00Z' } })).outcome).toBe('linked')
    expect(lastSeen(polled)).toBe('2026-11-22T06:00:00.000Z')
    const imported = db({}, { status: 'fixed' })
    expect((await run(imported, { intake: 'import', issue: { id: '4501', lastSeen: '2026-11-22T07:00:00Z' } })).outcome).toBe('linked')
    expect(lastSeen(imported)).toBe('2026-11-22T07:00:00.000Z')
  })

  it('a regression that reopens a fixed report stores it too', async () => {
    const d = db({}, { status: 'fixed' })
    expect((await run(d)).outcome).toBe('reopened')
    expect(lastSeen(d)).toBe('2026-11-21T08:00:00.000Z')
  })

  it('a new issue gets its link first, then its last seen', async () => {
    const d = db(null, null)
    const res = await run(d)
    expect(res.outcome).toBe('created')
    const link = d.table('report_external_issues').find((l) => l.report_id === res.reportId)
    expect(link).toMatchObject({ system: 'sentry', external_id: '4501', last_seen_at: '2026-11-21T08:00:00.000Z' })
  })
})

describe('pullSentryResolves stores the lastSeen of every issue it reads', () => {
  it('records it for an issue still open in Sentry, without closing anything', async () => {
    const updates: Array<{ row: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
    const linkRows = [{ report_id: 'r-1', project_id: P, external_id: '4501', reports: { status: 'classified', reopened_at: null, regressed_at: null } }]
    const stub = {
      from: () => {
        const filters: Array<[string, unknown]> = []
        let row: Record<string, unknown> | null = null
        const q = {
          select: () => q,
          is: () => q,
          in: () => q,
          order: () => q,
          limit: () => Promise.resolve({ data: linkRows, error: null }),
          update: (r: Record<string, unknown>) => ((row = r), q),
          eq: (k: string, v: unknown) => (filters.push([k, v]), q),
          or: (f: string) => {
            filters.push(['or', f])
            updates.push({ row: row!, filters })
            return Promise.resolve({ error: null })
          },
        }
        return q
      },
    }
    const closed: string[] = []
    await reconcile.pullSentryResolves(stub as never, {
      credentials: async () => ({ token: 't', orgSlug: 'o' }) as never,
      getIssue: async () => ({ status: 'unresolved', lastSeen: '2026-11-22T09:30:00Z' }),
      resolveReport: async (_d, _p, id) => (closed.push(id), { outcome: 'resolved' }),
      now: () => 0,
    })
    expect(closed).toEqual([])
    expect(updates).toEqual([
      {
        row: { last_seen_at: '2026-11-22T09:30:00.000Z' },
        filters: [['project_id', P], ['system', 'sentry'], ['external_id', '4501'], ['or', 'last_seen_at.is.null,last_seen_at.lt.2026-11-22T09:30:00.000Z']],
      },
    ])
  })
})
