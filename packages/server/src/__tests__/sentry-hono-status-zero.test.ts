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
 *          will trip a test). The Sentry SDK is mocked and initialised with a
 *          placeholder DSN, so captures land on the mock, never the network.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DB_TRANSIENT_VOLUME_THRESHOLD,
  DB_TRANSIENT_VOLUME_WINDOW_MS,
  resetDbTransientVolume,
} from '../../supabase/functions/_shared/error-codes.ts'
import { ProjectAccessReadError } from '../../supabase/functions/_shared/project-access.ts'
import { ensureSentry, sentryHonoErrorHandler } from '../../supabase/functions/_shared/sentry.ts'

const sentrySdk = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
}))
vi.mock('npm:@sentry/deno@^9', () => sentrySdk)

const globals = globalThis as { Deno?: unknown }
const previousDeno = globals.Deno
beforeAll(() => {
  globals.Deno = {
    env: { get: (k: string) => (k === 'SENTRY_DSN_SERVER' ? 'https://public@sentry.invalid/1' : undefined) },
  }
  ensureSentry('api')
  expect(sentrySdk.init).toHaveBeenCalledTimes(1)
})
afterAll(() => {
  globals.Deno = previousDeno
})

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
  const volumeSpy = sentrySdk.captureMessage

  beforeEach(() => {
    resetDbTransientVolume()
    warnSpy = vi.spyOn(_console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(_console, 'error').mockImplementation(() => {})
    volumeSpy.mockClear()
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

  it('does not report a Cloudflare HTML access failure (MUSHI-a8a03270)', async () => {
    const err = new ProjectAccessReadError('organization_members', {
      message:
        '<!DOCTYPE html>\n' +
        '<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->\n' +
        '<head><title>abc.supabase.co | 522: Connection timed out</title></head>' +
        `<body><div id="cf-wrapper">${'z'.repeat(5000)}</div></body>`,
      code: '',
    })
    expect(err.transient).toBe(true)
    const res = sentryHonoErrorHandler(
      err,
      fakeContext('/v1/admin/workspace/nav-meta', 'GET', { requestId: '7f39978d' }) as never,
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; message: string; requestId?: string } }
    expect(body.error.code).toBe('DB_ERROR')
    expect(body.error.message).not.toContain('<!DOCTYPE')
    expect(body.error.requestId).toBe('7f39978d')
    const payload = JSON.parse(String(warnSpy.mock.calls[0][0])) as Record<string, unknown>
    expect(payload.event).toBe('db_transient_error')
    expect(String(payload.err_message)).not.toContain('<!DOCTYPE')
    expect(String(payload.err_message)).toContain('522: Connection timed out')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('does not report a gateway upstream request timeout (MUSHI-cd3477a9)', async () => {
    const err = new ProjectAccessReadError('project_members', {
      message: 'upstream request timeout',
      code: '',
    })
    expect(err.transient).toBe(true)
    expect(err.message).toBe('project access read failed (project_members): upstream request timeout')
    const res = sentryHonoErrorHandler(
      err,
      fakeContext('/api/v1/admin/onboarding/stats', 'GET', { requestId: '95b19469-968' }) as never,
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; message: string; requestId?: string } }
    expect(body.error.code).toBe('DB_ERROR')
    expect(body.error.requestId).toBe('95b19469-968')
    const payload = JSON.parse(String(warnSpy.mock.calls[0][0])) as Record<string, unknown>
    expect(payload.event).toBe('db_transient_error')
    expect(payload.path).toBe('/api/v1/admin/onboarding/stats')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(volumeSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('reports a steady stream of gateway timeouts on one route once', () => {
    const err = new ProjectAccessReadError('project_members', {
      message: 'upstream request timeout',
      code: '',
    })
    const path = '/api/v1/admin/onboarding/stats'
    const ctx = fakeContext(path, 'GET', { requestId: '95b19469-968' })
    for (let i = 0; i < DB_TRANSIENT_VOLUME_THRESHOLD - 1; i++) {
      sentryHonoErrorHandler(err, ctx as never)
    }
    expect(volumeSpy).not.toHaveBeenCalled()
    const eventsBefore = warnSpy.mock.calls.map((call) => JSON.parse(String(call[0])).event as string)
    expect(eventsBefore).not.toContain('db_transient_error_volume')

    const res = sentryHonoErrorHandler(err, ctx as never)
    expect(res.status).toBe(500)
    expect(volumeSpy).toHaveBeenCalledTimes(1)
    const [msg, sent] = volumeSpy.mock.calls[0]!
    expect(String(msg)).toContain(path)
    expect(String(msg)).toContain(String(DB_TRANSIENT_VOLUME_THRESHOLD))
    expect(sent).toMatchObject({
      level: 'warning',
      tags: { path, method: 'GET', event: 'db_transient_error_volume' },
      extra: { count: DB_TRANSIENT_VOLUME_THRESHOLD, window_ms: DB_TRANSIENT_VOLUME_WINDOW_MS },
      fingerprint: ['db-transient-volume', path],
    })
    const volumeLine = warnSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((line) => line.event === 'db_transient_error_volume')
    expect(volumeLine).toMatchObject({
      path,
      method: 'GET',
      requestId: '95b19469-968',
      count: DB_TRANSIENT_VOLUME_THRESHOLD,
    })
    expect(errorSpy).not.toHaveBeenCalled()

    sentryHonoErrorHandler(err, ctx as never)
    expect(volumeSpy).toHaveBeenCalledTimes(1)
  })

  it('a real project-members query error does not count toward the volume alert', () => {
    const path = '/api/v1/admin/onboarding/stats'
    const ctx = fakeContext(path, 'GET')
    sentryHonoErrorHandler(
      new ProjectAccessReadError('project_members', { message: 'column "user_id" does not exist', code: '42703' }),
      ctx as never,
    )
    const timeout = new ProjectAccessReadError('project_members', {
      message: 'upstream request timeout',
      code: '',
    })
    for (let i = 0; i < DB_TRANSIENT_VOLUME_THRESHOLD - 1; i++) {
      sentryHonoErrorHandler(timeout, ctx as never)
    }
    expect(volumeSpy).not.toHaveBeenCalled()
  })

  it('still returns 500 internal for a project-access failure that is a real query error', async () => {
    const err = new ProjectAccessReadError('organization_members', {
      message: 'column "user_id" does not exist',
      code: '42703',
    })
    expect(err.transient).toBe(false)
    const res = sentryHonoErrorHandler(err, fakeContext() as never)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INTERNAL')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('an unrelated throw that quotes HTML is not swallowed as a DB blip', async () => {
    const err = new Error('<!DOCTYPE html><title>502 Bad Gateway</title> from api.github.com')
    const res = sentryHonoErrorHandler(err, fakeContext() as never)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INTERNAL')
  })
})
