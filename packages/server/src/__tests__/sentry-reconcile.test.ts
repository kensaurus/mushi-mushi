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
  })
})
