/**
 * FILE: packages/server/src/__tests__/sentry-hono-status-zero.test.ts
 * PURPOSE: Source-level regression guard for Sentry MUSHI-MUSHI-SERVER-H.
 *
 *          The Hono `app.onError` handler used to wrap every error in
 *          `reportError(...)` (Sentry.captureException) and return 502
 *          UPSTREAM_FETCH_FAILED. That meant the well-documented Deno /
 *          Supabase Edge Runtime client-abort case — where a long-running
 *          admin GET disconnects mid-stream and Hono surfaces it as
 *          `RangeError: status (0) is not equal to 101 and outside [200, 599]`
 *          — kept regenerating the same Sentry P-issue with no actionable
 *          fix. 16 events across 6 days on /v1/admin/reports,
 *          /v1/admin/dashboard, /v1/admin/fixes/dispatch.
 *
 *          The fix downgrades that one specific shape to a `reportMessage(
 *          'client_aborted_response', 'warning')` (still visible in Issues
 *          but won't page on-call) and returns 499 Client Closed Request
 *          (Nginx convention). Every other error continues to flow through
 *          `reportError` + 500 Internal.
 *
 *          We pin the discrimination at the response level (status code +
 *          body shape) because the handler exports nothing else we can
 *          assert on. The Sentry side-effect is short-circuited at runtime
 *          here because no SENTRY_DSN_SERVER env var is set under vitest.
 */

import { describe, expect, it } from 'vitest'

import { sentryHonoErrorHandler } from '../../supabase/functions/_shared/sentry.ts'

interface MinimalContext {
  req: { path: string; method: string }
  json: (body: unknown, status?: number) => Response
}

function fakeContext(path = '/v1/admin/reports', method = 'GET'): MinimalContext {
  return {
    req: { path, method },
    json(body: unknown, status?: number) {
      return new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  }
}

describe('sentryHonoErrorHandler — status-0 RangeError contract (Sentry MUSHI-MUSHI-SERVER-H)', () => {
  it('returns 499 client_closed_request for the canonical Deno status-0 RangeError', async () => {
    const err = new RangeError(
      'The status provided (0) is not equal to 101 and outside the range [200, 599]',
    )
    const res = sentryHonoErrorHandler(err, fakeContext() as never)
    expect(res.status).toBe(499)
    const body = (await res.json()) as { error: string; detail: string }
    expect(body.error).toBe('client_closed_request')
    expect(body.detail).toMatch(/client disconnected/i)
  })

  it('returns 499 for the alternate "status (0)" message Deno emits in some builds', async () => {
    const err = new RangeError('init failed: status (0) is not allowed')
    const res = sentryHonoErrorHandler(err, fakeContext('/v1/admin/dashboard') as never)
    expect(res.status).toBe(499)
  })

  it('still returns 500 internal for genuine TypeErrors so real bugs keep paging', async () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'foo')")
    const res = sentryHonoErrorHandler(err, fakeContext() as never)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('internal')
  })

  it('still returns 500 internal for non-status-0 RangeErrors', async () => {
    const err = new RangeError('Maximum call stack size exceeded')
    const res = sentryHonoErrorHandler(err, fakeContext() as never)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('internal')
  })

  it('still returns 500 internal for plain Errors thrown by route handlers', async () => {
    const err = new Error('downstream HTTP 503')
    const res = sentryHonoErrorHandler(err, fakeContext('/v1/admin/fixes/dispatch', 'POST') as never)
    expect(res.status).toBe(500)
  })
})
