/**
 * FILE: sentry-reconcile.test.ts
 * PURPOSE: Pin the Sentry catch-up that keeps Sentry in step with Mushi when
 *          the moment a report closed did not reach Sentry (2026-11-03: 36
 *          Sentry links stayed open on reports already fixed or closed as not
 *          a bug, and the transition side effects were never kept alive).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const rc = await import('../../supabase/functions/_shared/sentry-reconcile.ts')
const rb = await import('../../supabase/functions/_shared/sentry-resolve-back.ts')
const api = await import('../../supabase/functions/_shared/sentry-api.ts')

type Row = Record<string, unknown>

const here = dirname(fileURLToPath(import.meta.url))
const fnDir = resolve(here, '../../supabase/functions')

function linkRow(reportId: string, status: string, closedReason: string | null = null, externalId = '4501'): Row {
  return { report_id: reportId, project_id: 'p1', external_id: externalId, reports: { status, closed_reason: closedReason } }
}

function makeDb(rows: Row[], calls: Array<[string, unknown]> = []) {
  const q = {
    select: (cols: string) => (calls.push(['select', cols]), q),
    eq: (col: string, v: unknown) => (calls.push([`eq:${col}`, v]), q),
    is: (col: string, v: unknown) => (calls.push([`is:${col}`, v]), q),
    in: (col: string, v: unknown) => (calls.push([`in:${col}`, v]), q),
    order: () => q,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return { from: (name: string) => (calls.push(['from', name]), q) } as never
}

describe('reconcileAction', () => {
  it('resolves fixed, resolved and verified reports, archives only not-a-bug closes, leaves the rest open', () => {
    for (const s of ['fixed', 'resolved', 'verified']) expect(rc.reconcileAction(s, null)).toBe('resolve')
    expect(rc.reconcileAction('dismissed', 'working_as_intended')).toBe('archive')
    expect(rc.reconcileAction('dismissed', 'wont_fix')).toBe('archive')
    // "Couldn't reproduce" may still be firing; Sentry keeps showing it.
    expect(rc.reconcileAction('dismissed', 'not_reproducible')).toBeNull()
    expect(rc.reconcileAction('dismissed', null)).toBeNull()
    for (const s of ['new', 'classified', 'fixing', 'reopened', 'triaged']) expect(rc.reconcileAction(s, null)).toBeNull()
  })
})

describe('reconcileSentryLinks', () => {
  it('reads only open Sentry links of closed reports, and acts once per report', async () => {
    const calls: Array<[string, unknown]> = []
    const done: string[] = []
    const rows = [
      linkRow('r1', 'fixed', null, '4501'),
      linkRow('r1', 'fixed', null, '4502'),
      linkRow('r2', 'dismissed', 'working_as_intended'),
      linkRow('r3', 'dismissed', 'not_reproducible'),
      linkRow('r4', 'fixed', null, 'MUSHI-1'),
    ]
    const summary = await rc.reconcileSentryLinks(makeDb(rows, calls), {
      resolve: async (_db, i) => (done.push(`resolve:${i.reportId}`), { resolved: ['x'], failed: [] }),
      archive: async (_db, i) => (done.push(`archive:${i.reportId}:${i.closedReason}`), { archived: ['y'], failed: [] }),
      credentials: async () => ({ token: 't', orgSlug: 'o' }),
      now: () => 0,
    })
    expect(done).toEqual(['resolve:r1', 'archive:r2:working_as_intended'])
    expect(summary).toMatchObject({ reports: 2, resolved: 1, archived: 1, failed: 0 })
    expect(calls).toContainEqual(['eq:system', 'sentry'])
    expect(calls).toContainEqual(['is:resolved_at', null])
    expect(calls).toContainEqual(['is:archived_at', null])
  })

  it('caps the batch and rotates through the backlog, so a link Sentry keeps refusing cannot starve the rest', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => linkRow(`r${i}`, 'fixed'))
    const seen = (now: number) => {
      const ids: string[] = []
      return rc
        .reconcileSentryLinks(makeDb(rows), {
          batch: 10,
          now: () => now,
          resolve: async (_db, i) => (ids.push(i.reportId), { resolved: [], failed: [] }),
          archive: async () => ({ archived: [], failed: [] }),
          credentials: async () => ({ token: 't', orgSlug: 'o' }),
        })
        .then(() => ids)
    }
    const first = await seen(0)
    const next = await seen(rc.RECONCILE_INTERVAL_MS)
    expect(first).toHaveLength(10)
    expect(next).toHaveLength(10)
    expect(next[0]).not.toBe(first[0])
  })

  it('counts failures and keeps going', async () => {
    const rows = [linkRow('r1', 'fixed'), linkRow('r2', 'fixed')]
    const summary = await rc.reconcileSentryLinks(makeDb(rows), {
      resolve: async (_db, i) => {
        if (i.reportId === 'r1') throw new Error('boom')
        return { resolved: [], failed: [{ issueId: '1', error: 'no' }] }
      },
      archive: async () => ({ archived: [], failed: [] }),
      credentials: async () => ({ token: 't', orgSlug: 'o' }),
      now: () => 0,
    })
    expect(summary.failed).toBe(2)
  })

  it('passes quiet to resolve and archive, so a catch-up failure is a warning, not a Sentry issue every 15 minutes', async () => {
    const quiet: boolean[] = []
    await rc.reconcileSentryLinks(makeDb([linkRow('r1', 'fixed'), linkRow('r2', 'dismissed', 'wont_fix')]), {
      resolve: async (_db, _i, deps) => (quiet.push(!!deps?.quiet), { resolved: [], failed: [] }),
      archive: async (_db, _i, deps) => (quiet.push(!!deps?.quiet), { archived: [], failed: [] }),
      credentials: async () => ({ token: 't', orgSlug: 'o' }),
      now: () => 0,
    })
    expect(quiet).toEqual([true, true])
  })
})

describe('an issue Sentry no longer has', () => {
  const state = () => ({ links: [{ id: 'l1', external_id: '4501' }] as Row[], stamped: [] as string[], updates: [] as Row[] })
  function db(s: ReturnType<typeof state>) {
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      maybeSingle: () => Promise.resolve({ data: null }),
      then: (r: (v: unknown) => void) => r({ data: s.links, error: null }),
      insert: () => Promise.resolve({ error: null }),
      update: (row: Row) => ({ eq: (_c: string, id: string) => (s.stamped.push(id), s.updates.push(row), Promise.resolve({ error: null })) }),
    }
    return { from: () => q } as never
  }
  const creds = async () => ({ token: 't', orgSlug: 'o' })
  const gone = async () => new Response('{"detail":"not found"}', { status: 404 })

  it('a resolve that gets 404 stamps the link, so it is not retried forever', async () => {
    const s = state()
    const r = await rb.resolveLinkedSentryIssues(db(s), { projectId: 'p1', reportId: 'r1', fixAttemptId: null, prUrl: null }, { credentials: creds, fetchImpl: gone })
    expect(r.failed).toEqual([])
    expect(r.gone).toEqual(['4501'])
    expect(s.stamped).toEqual(['l1'])
    expect(s.updates[0].resolved_at).toEqual(expect.any(String))
  })

  it('an archive that gets 404 stamps the link too', async () => {
    const s = state()
    const r = await rb.archiveLinkedSentryIssues(db(s), { projectId: 'p1', reportId: 'r1', closedReason: 'wont_fix' }, { credentials: creds, fetchImpl: gone })
    expect(r.failed).toEqual([])
    expect(r.gone).toEqual(['4501'])
    expect(s.updates[0].archived_at).toEqual(expect.any(String))
  })

  it('a refusal other than 404 is still a failure', async () => {
    const s = state()
    const r = await rb.resolveLinkedSentryIssues(db(s), { projectId: 'p1', reportId: 'r1', fixAttemptId: null, prUrl: null }, {
      credentials: creds,
      fetchImpl: async () => new Response('{}', { status: 403 }),
    })
    expect(r.failed).toHaveLength(1)
    expect(s.stamped).toEqual([])
    expect(api.SENTRY_API_BASE).toContain('sentry.io')
  })
})

const byPerson = (dateCreated = '2026-11-03T09:00:00Z') => ({
  status: 'resolved',
  activity: [{ type: 'note', user: { id: '1' } }, { type: 'set_resolved', user: { id: '1' }, dateCreated }],
})

describe('followsSentryResolve', () => {
  it('follows a resolve by a person, a commit, a pull request or a release', () => {
    expect(rc.followsSentryResolve(byPerson(), null)).toBe(true)
    for (const type of ['set_resolved_in_commit', 'set_resolved_in_pull_request', 'set_resolved_in_release']) {
      expect(rc.followsSentryResolve({ status: 'resolved', activity: [{ type, user: null }] }, null), type).toBe(true)
    }
  })

  it('ignores Sentry resolving on its own: a metric alert that cleared (SBC-BE-7E) and auto-resolve by age', () => {
    expect(rc.followsSentryResolve({ status: 'resolved', activity: [{ type: 'set_resolved', user: null }] }, null)).toBe(false)
    expect(rc.followsSentryResolve({ status: 'resolved', activity: [{ type: 'set_resolved_by_age', user: null }] }, null)).toBe(false)
  })

  it('ignores a resolve from before the report was reopened, an open issue, and an issue with no activity', () => {
    expect(rc.followsSentryResolve(byPerson('2026-11-01T00:00:00Z'), '2026-11-02T00:00:00Z')).toBe(false)
    expect(rc.followsSentryResolve(byPerson('2026-11-03T00:00:00Z'), '2026-11-02T00:00:00Z')).toBe(true)
    expect(rc.followsSentryResolve({ status: 'unresolved', activity: byPerson().activity }, null)).toBe(false)
    expect(rc.followsSentryResolve({ status: 'resolved' }, null)).toBe(false)
  })
})

describe('pullSentryResolves (Sentry → Mushi for orgs that poll)', () => {
  const creds = async () => ({ token: 't', orgSlug: 'o' })

  it('closes an open report only when a person resolved its Sentry issue, never a reopened one', async () => {
    const calls: Array<[string, unknown]> = []
    const closed: string[] = []
    const rows = [
      linkRow('r1', 'classified', null, '11'),
      linkRow('r2', 'fixing', null, '12'),
      linkRow('r3', 'classified', null, '13'),
      linkRow('r4', 'classified', null, 'MUSHI-9'),
      linkRow('r5', 'classified', null, '15'),
    ]
    const issues: Record<string, ReturnType<typeof byPerson> | { status: string; activity?: unknown[] }> = {
      '11': byPerson(),
      '12': { status: 'unresolved' },
      '13': { status: 'ignored' },
      '15': { status: 'resolved', activity: [{ type: 'set_resolved', user: null }] },
    }
    const summary = await rc.pullSentryResolves(makeDb(rows, calls), {
      credentials: creds,
      getIssue: async (_t, _o, id) => issues[id] as never,
      resolveReport: async (_db, _p, id) => (closed.push(id), { outcome: 'resolved' }),
      now: () => 0,
    })
    expect(closed).toEqual(['11'])
    expect(summary).toMatchObject({ pending: 4, checked: 4, resolved: 1, failed: 0 })
    expect(calls).toContainEqual(['select', 'report_id, project_id, external_id, reports!inner(status, reopened_at, regressed_at)'])
    const statuses = calls.find(([k]) => k === 'in:reports.status')?.[1] as string[]
    expect(statuses).toContain('fixing')
    // A report someone reopened in Mushi stays open; closed ones are the other job's.
    for (const s of ['reopened', 'fixed', 'resolved', 'dismissed']) expect(statuses).not.toContain(s)
  })

  it('caps the reads per run, rotates, and counts a failing issue without stopping', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => linkRow(`r${i}`, 'classified', null, String(100 + i)))
    const read: string[] = []
    const summary = await rc.pullSentryResolves(makeDb(rows), {
      batch: 5,
      credentials: creds,
      getIssue: async (_t, _o, id) => {
        read.push(id)
        if (id === '101') throw new Error('Sentry GET → 503')
        // A deleted issue is not a failure: nothing to follow.
        if (id === '102') throw new api.SentryApiError(404, 'Sentry GET → 404')
        return { status: 'unresolved' }
      },
      resolveReport: async () => ({ outcome: 'resolved' }),
      now: () => 0,
    })
    expect(read).toEqual(['100', '101', '102', '103', '104'])
    expect(summary).toMatchObject({ checked: 5, resolved: 0, failed: 1 })
    const next: string[] = []
    await rc.pullSentryResolves(makeDb(rows), {
      batch: 5,
      credentials: creds,
      getIssue: async (_t, _o, id) => (next.push(id), { status: 'unresolved' }),
      resolveReport: async () => ({ outcome: 'resolved' }),
      now: () => rc.RECONCILE_INTERVAL_MS,
    })
    expect(next[0]).toBe('105')
  })

  it('skips a project with no Sentry credentials without calling Sentry', async () => {
    let calls = 0
    const summary = await rc.pullSentryResolves(makeDb([linkRow('r1', 'classified', null, '11')]), {
      credentials: async () => null,
      getIssue: async () => (calls++, byPerson()),
    })
    expect(calls).toBe(0)
    expect(summary).toMatchObject({ pending: 1, checked: 0, resolved: 0 })
  })

  it('ignores a resolve older than the report reopen', async () => {
    const row = { report_id: 'r1', project_id: 'p1', external_id: '11', reports: { status: 'fixing', reopened_at: '2026-11-02T00:00:00Z', regressed_at: null } }
    const closed: string[] = []
    await rc.pullSentryResolves(makeDb([row]), {
      credentials: creds,
      getIssue: async () => byPerson('2026-11-01T00:00:00Z'),
      resolveReport: async (_db, _p, id) => (closed.push(id), { outcome: 'resolved' }),
    })
    expect(closed).toEqual([])
  })
})

describe('reopenSentryLinks', () => {
  function db(closed: Row[]) {
    const cleared: Row[] = []
    const chain = (result: unknown) => {
      const q = { eq: () => q, or: () => Promise.resolve(result) }
      return q
    }
    const from = () => ({
      select: () => chain({ data: closed, error: null }),
      update: (row: Row) => (cleared.push(row), chain({ error: null })),
    })
    return { db: { from } as never, cleared }
  }

  it('reopens the issue in Sentry too, so the pull cannot close the report again', async () => {
    const { db: d, cleared } = db([{ external_id: '4501' }, { external_id: 'WEB-1' }])
    const puts: string[] = []
    await rb.reopenSentryLinks(d, 'p1', 'r1', {
      credentials: async () => ({ token: 't', orgSlug: 'o' }),
      fetchImpl: async (url, init) => (puts.push(`${init?.method} ${String(url).split('/issues/')[1]} ${init?.body}`), new Response('{}', { status: 200 })),
    })
    expect(cleared).toEqual([{ resolved_at: null, archived_at: null }])
    expect(puts).toEqual(['PUT 4501/ {"status":"unresolved"}'])
  })

  it('leaves Sentry alone when Sentry itself reported the regression', async () => {
    const { db: d } = db([{ external_id: '4501' }])
    let calls = 0
    await rb.reopenSentryLinks(d, 'p1', 'r1', {
      inSentry: false,
      credentials: async () => ({ token: 't', orgSlug: 'o' }),
      fetchImpl: async () => (calls++, new Response('{}')),
    })
    expect(calls).toBe(0)
  })
})

describe('wiring (source shape)', () => {
  it('every detached side effect of a status change is kept alive with EdgeRuntime.waitUntil', () => {
    const src = readFileSync(resolve(fnDir, '_shared/report-transition.ts'), 'utf8')
    const body = src.slice(src.indexOf('export function runStatusTransitionSideEffects'), src.indexOf('export type TransitionResult'))
    for (const call of ['reopenSentryLinks(', 'resolveExternalIssue(', 'resolveLinkedSentryIssues(', 'archiveLinkedSentryIssues(', 'closeReportPipelines(', 'notifyReportStatusTransition(']) {
      const at = body.indexOf(call)
      expect(at, call).toBeGreaterThan(-1)
      // The call is the argument of a keepAlive(...) wrapper.
      expect(body.slice(Math.max(0, at - 40), at), call).toMatch(/keepAlive\(\s*$/)
    }
    expect(src).toContain('waitUntil')
  })

  it('the Sentry poll runs the catch-up after its import, in the same invocation', () => {
    const src = readFileSync(resolve(fnDir, 'sentry-seer-poll/index.ts'), 'utf8')
    expect(src).toContain('reconcileSentryLinks(')
    expect(src.indexOf('reconcileSentryLinks(')).toBeGreaterThan(src.indexOf('autoImportProject(db, r)'))
    // Then the other direction, so an import that reopened a report is seen first.
    expect(src.indexOf('pullSentryResolves(')).toBeGreaterThan(src.indexOf('reconcileSentryLinks(db)'))
  })
})
