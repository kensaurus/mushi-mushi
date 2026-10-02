/**
 * FILE: sentry-resolve-back.test.ts
 * PURPOSE: Pin the Sentry half of the fix loop for Sentry-sourced reports:
 *          the `Fixes <SHORT-ID>` commit trailer, the API resolve on merge,
 *          and that every failure is recorded instead of swallowed.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const rb = await import('../../supabase/functions/_shared/sentry-resolve-back.ts')
const api = await import('../../supabase/functions/_shared/sentry-api.ts')
const gh = await import('../../supabase/functions/_shared/github-pr.ts')

interface Row {
  [k: string]: unknown
}

interface State {
  links: Row[]
  report: Row | null
  fixEvents: Row[]
  stamped: string[]
  fixEventError?: { code: string; message: string } | null
}

function makeDb(state: State) {
  function table(name: string) {
    const filters: Record<string, unknown> = {}
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        filters[col] = v
        return q
      },
      is: () => q,
      maybeSingle: () => Promise.resolve({ data: name === 'reports' ? state.report : null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: name === 'report_external_issues' ? state.links : [], error: null }),
      insert: (row: Row) => {
        if (name === 'fix_events') state.fixEvents.push(row)
        return Promise.resolve({ error: name === 'fix_events' ? (state.fixEventError ?? null) : null })
      },
      update: () => ({
        eq: (_c: string, id: string) => {
          state.stamped.push(id)
          return Promise.resolve({ error: null })
        },
      }),
    }
    return q
  }
  return { from: (name: string) => table(name) } as never
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const creds = async () => ({ token: 't', orgSlug: 'sakuramoto' })
const noCreds = async () => null
const input = { projectId: 'p1', reportId: 'r1', fixAttemptId: 'f1', prUrl: 'https://github.com/o/r/pull/9' }

describe('sentryFixesTrailers', () => {
  it('emits one Fixes line per valid short id', () => {
    expect(rb.sentryFixesTrailers(['HELP-HER-TAKE-PHOTO-2', 'HELP-HER-TAKE-PHOTO-2', 'bad id', '4501'])).toEqual([
      'Fixes HELP-HER-TAKE-PHOTO-2',
    ])
  })
})

describe('formatFixCommitMessage trailers', () => {
  it('appends trailers as a message body', () => {
    const msg = gh.formatFixCommitMessage('serialize non-Error objects', 'abc', 'bug', ['Fixes WEB-12'])
    expect(msg.split('\n')).toEqual([expect.stringMatching(/^\w+\(MUSHI-abc\): serialize non-Error objects$/), '', 'Fixes WEB-12'])
    expect(gh.formatFixCommitMessage('x', 'abc', 'bug')).not.toContain('\n')
  })
})

describe('sentryShortIdsForReport', () => {
  let state: State
  beforeEach(() => {
    state = { links: [], report: null, fixEvents: [], stamped: [] }
  })

  it('uses the stored short id when it belongs to the link', async () => {
    state.links = [{ id: 'l1', external_id: '4501' }]
    state.report = { custom_metadata: { sentryIssueId: '4501', sentryShortId: 'GLOT-IT-C4' } }
    expect(await rb.sentryShortIdsForReport(makeDb(state), 'p1', 'r1', { credentials: noCreds })).toEqual(['GLOT-IT-C4'])
  })

  it('asks Sentry for links ingested without a short id', async () => {
    state.links = [{ id: 'l1', external_id: '4501' }]
    state.report = { custom_metadata: { sentryIssueId: '4501', sentryShortId: null } }
    const fetchImpl = async () => json({ id: '4501', shortId: 'THE-WANTING-MIND-2P' })
    expect(await rb.sentryShortIdsForReport(makeDb(state), 'p1', 'r1', { credentials: creds, fetchImpl })).toEqual([
      'THE-WANTING-MIND-2P',
    ])
  })

  it('gives up on a slow Sentry lookup instead of holding the PR', async () => {
    state.links = [{ id: 'l1', external_id: '4501' }]
    state.report = { custom_metadata: {} }
    const fetchImpl = () => new Promise<Response>(() => {})
    const started = Date.now()
    expect(await rb.sentryShortIdsForReport(makeDb(state), 'p1', 'r1', { credentials: creds, fetchImpl, timeoutMs: 30 })).toEqual([])
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('returns nothing for a report with no Sentry link', async () => {
    expect(await rb.sentryShortIdsForReport(makeDb(state), 'p1', 'r1', { credentials: creds })).toEqual([])
  })
})

describe('resolveLinkedSentryIssues', () => {
  let state: State
  beforeEach(() => {
    state = { links: [{ id: 'l1', external_id: '4501' }], report: null, fixEvents: [], stamped: [] }
  })

  it('resolves in next release, stamps resolved_at, comments, and records an ok event', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url: url.replace(api.SENTRY_API_BASE, ''), body: String(init?.body ?? '') })
      return json({})
    }
    const result = await rb.resolveLinkedSentryIssues(makeDb(state), input, { credentials: creds, fetchImpl })
    expect(result.resolved).toEqual(['4501'])
    expect(calls[0]).toEqual({ url: '/organizations/sakuramoto/issues/4501/', body: '{"status":"resolvedInNextRelease"}' })
    expect(calls[1].url).toBe('/organizations/sakuramoto/issues/4501/comments/')
    expect(calls[1].body).toContain(input.prUrl)
    expect(state.stamped).toEqual(['l1'])
    expect(state.fixEvents[0]).toMatchObject({ kind: 'pr_state_changed', status: 'ok', dedupe_key: 'sentry_resolve:4501' })
  })

  it('falls back to plain resolved when the project has no releases', async () => {
    const bodies: string[] = []
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      return bodies.length === 1 ? json({ detail: 'No release data present in the system.' }, 400) : json({})
    }
    const result = await rb.resolveLinkedSentryIssues(makeDb(state), input, { credentials: creds, fetchImpl })
    expect(result.resolved).toEqual(['4501'])
    expect(bodies[1]).toBe('{"status":"resolved"}')
  })

  it('keeps the issue resolved when only the comment fails', async () => {
    const fetchImpl = async (url: string) => (url.endsWith('/comments/') ? json({}, 404) : json({}))
    const result = await rb.resolveLinkedSentryIssues(makeDb(state), input, { credentials: creds, fetchImpl })
    expect(result.resolved).toEqual(['4501'])
    expect(state.stamped).toEqual(['l1'])
  })

  it('records a visible failure and does not stamp resolved_at when Sentry refuses', async () => {
    const fetchImpl = async () => json({ detail: 'You do not have permission' }, 403)
    const result = await rb.resolveLinkedSentryIssues(makeDb(state), input, { credentials: creds, fetchImpl })
    expect(result.resolved).toEqual([])
    expect(result.failed[0].issueId).toBe('4501')
    expect(state.stamped).toEqual([])
    expect(state.fixEvents[0]).toMatchObject({ status: 'fail', dedupe_key: 'sentry_resolve_fail:4501' })
    expect(String(state.fixEvents[0].detail)).toContain('event:write')
  })

  it('a redelivered failure hits the dedupe key instead of throwing or stacking', async () => {
    state.fixEventError = { code: '23505', message: 'duplicate key value violates unique constraint' }
    const fetchImpl = async () => json({ detail: 'nope' }, 403)
    const result = await rb.resolveLinkedSentryIssues(makeDb(state), input, { credentials: creds, fetchImpl })
    expect(result.failed).toHaveLength(1)
    expect(state.fixEvents[0].dedupe_key).toBe('sentry_resolve_fail:4501')
  })

  it('records a visible failure when the project has no Sentry credentials', async () => {
    const result = await rb.resolveLinkedSentryIssues(makeDb(state), input, { credentials: noCreds })
    expect(result.skipped).toBe('no_credentials')
    expect(state.fixEvents[0]).toMatchObject({ status: 'fail', dedupe_key: 'sentry_resolve_fail:4501' })
    expect(state.stamped).toEqual([])
  })

  it('leaves non-numeric sentry links alone', async () => {
    state.links = [{ id: 'l9', external_id: 'evt-abc123' }]
    const result = await rb.resolveLinkedSentryIssues(makeDb(state), input, { credentials: creds, fetchImpl: async () => json({}) })
    expect(result.skipped).toBe('no_links')
    expect(state.stamped).toEqual([])
  })

  it('is a no-op without open Sentry links', async () => {
    state.links = []
    const result = await rb.resolveLinkedSentryIssues(makeDb(state), input, { credentials: creds })
    expect(result.skipped).toBe('no_links')
    expect(state.fixEvents).toEqual([])
  })
})

describe('wiring (source shape)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const fn = (p: string) => readFileSync(resolve(here, '../../supabase/functions', p), 'utf8')

  it('finalizeFixMerge resolves in the background, Sentry first, then resolveExternalIssue', () => {
    const src = fn('_shared/fix-merge.ts')
    const keepAliveAt = src.indexOf('void keepAlive(')
    const sentryAt = src.indexOf('await resolveLinkedSentryIssues(')
    const externalAt = src.indexOf('await resolveExternalIssue(attempt.report_id')
    expect(keepAliveAt).toBeGreaterThan(-1)
    expect(sentryAt).toBeGreaterThan(keepAliveAt)
    expect(externalAt).toBeGreaterThan(sentryAt)
    // Nothing else may call resolveExternalIssue outside that chain.
    expect(src.match(/resolveExternalIssue\(/g)).toHaveLength(1)
  })

  it('fix-worker passes the Fixes trailers into the PR commit', () => {
    const src = fn('fix-worker/index.ts')
    expect(src).toMatch(/commitTrailers: sentryFixesTrailers\(\s*await sentryShortIdsForReport\(/)
  })
})
