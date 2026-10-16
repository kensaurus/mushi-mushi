/**
 * FILE: sentry-poll-transient.test.ts
 * PURPOSE: Pin MUSHI-MUSHI-SERVER-2P. The 15-minute Sentry poll logged
 *          "sentry auto-import failed" as an error when Sentry itself
 *          answered 503 "upstream connect error ... Connection refused".
 *          Sentry 5xx / 429 / timeouts / refused connections are retried by
 *          the next poll and must log as warnings; config errors (401, 403,
 *          404) must keep reaching Sentry, with the reason in the title.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const api = await import('../../supabase/functions/_shared/sentry-api.ts')
const imp = await import('../../supabase/functions/_shared/sentry-import.ts')

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')

// The body Sentry's edge returned on 2026-10-11.
const UPSTREAM_503 =
  'upstream connect error or disconnect/reset before headers. retried and the latest reset reason: remote connection failure, transport failure reason: delayed connect error: Connection refused'

describe('isTransientSentryFailure', () => {
  it('the real incident: importSentryIssues throws on a 503 search and it classifies as transient', async () => {
    const fetchImpl = async () => new Response(UPSTREAM_503, { status: 503 })
    const db = {} as Parameters<typeof imp.importSentryIssues>[0]
    let thrown: unknown
    try {
      await imp.importSentryIssues(db, {
        projectId: 'p1',
        request: { query: 'is:unresolved', limit: 10, sentryProject: 'mushi-mushi-admin', intake: 'poll' },
        sentry: { token: 't', orgSlug: 'sakuramoto', projectSlugs: ['mushi-mushi-admin'] },
        triggerClassification: () => {},
        fetchImpl,
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(api.SentryApiError)
    expect(api.thrownMessage(thrown)).toContain('Sentry GET /projects/sakuramoto/mushi-mushi-admin/issues/ → 503')
    expect(api.isTransientSentryFailure(thrown)).toBe(true)
  })

  it('Sentry 5xx and 429 are transient', () => {
    for (const status of [500, 502, 503, 504, 429]) {
      expect(api.isTransientSentryFailure(new api.SentryApiError(status, `Sentry GET → ${status}`))).toBe(true)
    }
  })

  it('auth, not-found and bad-request answers stay real errors', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(api.isTransientSentryFailure(new api.SentryApiError(status, `Sentry GET → ${status}`))).toBe(false)
    }
  })

  it('timeouts and refused or reset connections are transient', () => {
    expect(api.isTransientSentryFailure(new DOMException('Signal timed out.', 'TimeoutError'))).toBe(true)
    expect(api.isTransientSentryFailure(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(
      api.isTransientSentryFailure(
        new TypeError('error sending request for url (https://sentry.io/api/0/): client error (Connect): tcp connect error: Connection refused (os error 111)'),
      ),
    ).toBe(true)
    expect(api.isTransientSentryFailure(new Error('connection reset by peer'))).toBe(true)
    expect(api.isTransientSentryFailure(new Error('dns error: failed to lookup address information'))).toBe(true)
  })

  it('a bug in our own code is not transient', () => {
    expect(api.isTransientSentryFailure(new TypeError("Cannot read properties of undefined (reading 'slug')"))).toBe(false)
    expect(api.isTransientSentryFailure(new Error('No connection configured for this project'))).toBe(false)
  })

  it('PostgREST error objects go through the DB classifier: a pooler reset is transient, a coded SQL error is not', () => {
    expect(api.isTransientSentryFailure({ message: 'upstream connect error or disconnect/reset before headers', code: '' })).toBe(true)
    expect(api.isTransientSentryFailure({ message: 'connection failure', code: '08006' })).toBe(true)
    expect(api.isTransientSentryFailure({ message: 'column project_settings.foo does not exist', code: '42703' })).toBe(false)
    // A coded error is never silenced by its wording.
    expect(api.isTransientSentryFailure({ message: 'upstream connect error', code: 'P0001' })).toBe(false)
  })
})

describe('thrownMessage', () => {
  it('reads Error.message, a plain object message, a string, and serializes the rest', () => {
    expect(api.thrownMessage(new Error('boom'))).toBe('boom')
    expect(api.thrownMessage({ message: 'relation "x" does not exist', code: '42P01' })).toBe('relation "x" does not exist')
    expect(api.thrownMessage('plain')).toBe('plain')
    expect(api.thrownMessage({ status: 500 })).toBe('{"status":500}')
    expect(api.thrownMessage(undefined)).toBe('undefined')
  })

  it('never returns "[object Object]"', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(api.thrownMessage(circular)).not.toBe('')
    expect(api.thrownMessage({ message: 'x' })).not.toContain('[object Object]')
    expect(api.thrownMessage({ code: 'E1' })).not.toContain('[object Object]')
  })
})

describe('sentry-seer-poll routes both per-project catches through logPollFailure', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'sentry-seer-poll/index.ts'), 'utf-8')

  it('the project poll and the auto-import use the transient-aware logger', () => {
    expect(src).toContain("logPollFailure('project poll failed', r.project_id, err)")
    expect(src).toContain("logPollFailure('sentry auto-import failed', r.project_id, err)")
  })

  it('a transient failure is a warning; a real one is an error with the reason in its title', () => {
    const fn = src.slice(src.indexOf('function logPollFailure'))
    expect(fn).toMatch(/if \(isTransientSentryFailure\(err\)\) \{\s*log\.warn\(/)
    expect(fn).toContain('log.error(`${what}: ${msg.slice(0, 200)}`')
    expect(src).not.toMatch(/err instanceof Error \? err\.message : String\(err\)/)
  })
})

describe('Sentry 429 retry (2026-10-16: 91 rate-limit warnings a day)', () => {
  const RATE_LIMITED = '{"detail":"You are attempting to use this endpoint too frequently. Limit is 5 requests in 1 seconds"}'

  it('waits as Retry-After asks and returns the retried answer', async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string) => {
      calls.push(url)
      return calls.length === 1
        ? new Response(RATE_LIMITED, { status: 429, headers: { 'Retry-After': '0' } })
        : new Response('[{"id":"1"}]', { status: 200 })
    }
    const page = await api.searchSentryIssues('t', 'sakuramoto', 'glot-it', { query: 'is:unresolved', limit: 10 }, fetchImpl)
    expect(page.issues.map((i) => i.id)).toEqual(['1'])
    expect(calls).toHaveLength(2)
  })

  it('gives up after two retries and still classifies the 429 as transient', async () => {
    let n = 0
    const fetchImpl = async () => {
      n++
      return new Response(RATE_LIMITED, { status: 429, headers: { 'Retry-After': '0' } })
    }
    const err = await api
      .searchSentryIssues('t', 'sakuramoto', 'glot-it', { query: 'is:unresolved', limit: 10 }, fetchImpl)
      .catch((e: unknown) => e)
    expect(n).toBe(3)
    expect(api.isTransientSentryFailure(err)).toBe(true)
  })

  it('leaves a long Retry-After to the next poll instead of waiting inside the request', async () => {
    let n = 0
    const fetchImpl = async () => {
      n++
      return new Response(RATE_LIMITED, { status: 429, headers: { 'Retry-After': '60' } })
    }
    await api.searchSentryIssues('t', 'o', 'p', { query: 'q', limit: 1 }, fetchImpl).catch(() => {})
    expect(n).toBe(1)
  })

  it('reads Retry-After as seconds or an HTTP date, and defaults to 1 s', () => {
    const now = Date.parse('2026-10-16T11:00:00Z')
    const at = (v?: string) => new Response(null, { status: 429, headers: v ? { 'Retry-After': v } : {} })
    expect(api.sentryRetryAfterMs(at('2'), now)).toBe(2_000)
    expect(api.sentryRetryAfterMs(at('Fri, 16 Oct 2026 11:00:03 GMT'), now)).toBe(3_000)
    expect(api.sentryRetryAfterMs(at(), now)).toBe(1_000)
    expect(api.sentryRetryAfterMs(at('soon'), now)).toBe(1_000)
  })
})
