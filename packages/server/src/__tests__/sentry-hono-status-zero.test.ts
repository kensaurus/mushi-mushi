/**
 * FILE: packages/server/src/__tests__/sentry-hono-status-zero.test.ts
 * PURPOSE: Source-level regression guard for Sentry MUSHI-MUSHI-SERVER-H/-P.
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
 *          First fix (2026-04-29) downgraded that one specific shape to a
 *          `reportMessage('client_aborted_response', 'warning')` on the
 *          mistaken assumption that warning-level messages don't surface as
 *          Issues. They do — see Sentry MUSHI-MUSHI-SERVER-P, which kept
 *          regressing with 9 events on the same path.
 *
 *          Second fix (2026-05-24, this revision) stops calling
 *          `captureMessage` for client-aborts entirely. Volume tracking
 *          moves to a structured `console.warn` (Supabase Logs aggregates
 *          and lets us query `event="client_aborted_response"` ad-hoc).
 *          The 499 response and discriminator semantics are unchanged so
 *          any proxy/CDN telemetry that pivots on status code keeps
 *          working. Every other error continues to flow through
 *          `reportError` + 500 Internal.
 *
 *          We pin the discrimination at the response level (status code +
 *          body shape) AND on the structured-warn side-effect (so a future
 *          refactor that "helpfully" re-introduces a `captureMessage` call
 *          will trip a test). The Sentry side-effect is short-circuited at
 *          runtime here because no SENTRY_DSN_SERVER env var is set under
 *          vitest.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sentryHonoErrorHandler } from '../../supabase/functions/_shared/sentry.ts'

interface MinimalContext {
  req: { path: string; method: string }
  // Hono context accessor — the handler reads `c.get('requestId')` to attach
  // the correlation id to its structured warning. Mirror it so the mock
  // exercises the real code path instead of throwing "c.get is not a function".
  get: (key: string) => unknown
  json: (body: unknown, status?: number) => Response
}

function fakeContext(
  path = '/v1/admin/reports',
  method = 'GET',
  vars: Record<string, unknown> = {},
): MinimalContext {
  return {
    req: { path, method },
    get: (key: string) => vars[key],
    json(body: unknown, status?: number) {
      return new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  }
}

describe('sentryHonoErrorHandler — status-0 RangeError contract (Sentry MUSHI-MUSHI-SERVER-H/-P)', () => {
  // Resolve `console` through `globalThis` because the package's tsconfig
  // lib is "ES2022" only (no DOM, no Node ambient `console`). Vitest still
  // provides it at runtime; this cast just keeps ad-hoc `npx tsc --noEmit`
  // runs from flagging the spies.
  const _console = (globalThis as unknown as { console: { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void } }).console
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(_console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(_console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('returns 499 client_closed_request for the canonical Deno status-0 RangeError', async () => {
    const err = new RangeError(
      'The status provided (0) is not equal to 101 and outside the range [200, 599]',
    )
    const res = sentryHonoErrorHandler(err, fakeContext() as never)
    expect(res.status).toBe(499)
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('CLIENT_CLOSED_REQUEST')
    expect(body.error.message).toMatch(/client disconnected/i)
  })

  it('returns 499 for the alternate "status (0)" message Deno emits in some builds', async () => {
    const err = new RangeError('init failed: status (0) is not allowed')
    const res = sentryHonoErrorHandler(err, fakeContext('/v1/admin/dashboard') as never)
    expect(res.status).toBe(499)
  })

  it('emits a structured console.warn (not a Sentry capture) on client-abort so Supabase Logs keeps volume', () => {
    const err = new RangeError(
      'The status provided (0) is not equal to 101 and outside the range [200, 599]',
    )
    sentryHonoErrorHandler(err, fakeContext('/v1/admin/reports', 'GET') as never)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(warnSpy.mock.calls[0][0])) as Record<string, unknown>
    expect(payload.event).toBe('client_aborted_response')
    expect(payload.client_abort).toBe(true)
    expect(payload.range_error_status_0).toBe(true)
    expect(payload.path).toBe('/v1/admin/reports')
    expect(payload.method).toBe('GET')
    expect(payload.level).toBe('warn')
    // Regression guard: client-aborts must not flow through console.error
    // (which would short-circuit the logger's Sentry forwarder if anyone
    // ever wires this handler into the structured logger pipeline).
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('still returns 500 internal for genuine TypeErrors so real bugs keep paging', async () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'foo')")
    const res = sentryHonoErrorHandler(err, fakeContext() as never)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INTERNAL')
  })

  it('still returns 500 internal for non-status-0 RangeErrors', async () => {
    const err = new RangeError('Maximum call stack size exceeded')
    const res = sentryHonoErrorHandler(err, fakeContext() as never)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INTERNAL')
  })

  it('still returns 500 internal for plain Errors thrown by route handlers', async () => {
    const err = new Error('downstream HTTP 503')
    const res = sentryHonoErrorHandler(err, fakeContext('/v1/admin/fixes/dispatch', 'POST') as never)
    expect(res.status).toBe(500)
  })
})
