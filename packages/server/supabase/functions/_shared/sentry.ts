/**
 * FILE: packages/server/supabase/functions/_shared/sentry.ts
 * PURPOSE: Single chokepoint for the Deno Sentry SDK across edge functions.
 *
 *          - ensureSentry()  — idempotent init from SENTRY_DSN_SERVER env var
 *          - sentryHonoErrorHandler — drop-in for app.onError(...)
 *          - withSentry(name, handler) — wrap a Deno.serve handler
 *          - reportError(err, ctx?) — manual capture
 *
 *          No-op when SENTRY_DSN_SERVER is unset (local dev, self-hosted forks
 *          that don't want to send telemetry to our org).
 *
 * INTEGRATION NOTE: The shared logger forwards .error() and .fatal() to
 * Sentry.captureMessage automatically, so most code paths get coverage just
 * by using `log.error(...)` — no scattering of capture calls required.
 */

import * as Sentry from 'npm:@sentry/deno@^9'
import type { Context } from 'npm:hono@4'

const TOKEN_QUERY_RX = /([?&](?:api_key|apiKey|token|key|access_token|session)=)[^&]+/gi

let inited = false

export function ensureSentry(functionName?: string): void {
  if (inited) return
  // Accept both SENTRY_DSN_SERVER (preferred, server-specific) and SENTRY_DSN
  // (fallback, useful for self-hosters who only set one DSN env var).
  const dsn = Deno.env.get('SENTRY_DSN_SERVER') ?? Deno.env.get('SENTRY_DSN')
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: Deno.env.get('SUPABASE_ENV') ?? Deno.env.get('DENO_ENV') ?? 'production',
    release: Deno.env.get('SENTRY_RELEASE') ?? undefined,
    sendDefaultPii: false,
    tracesSampleRate: Number(Deno.env.get('SENTRY_TRACES_SAMPLE_RATE') ?? '0.1'),
    initialScope: functionName ? { tags: { function: functionName } } : undefined,
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = event.request.url.replace(TOKEN_QUERY_RX, '$1[redacted]')
      }
      const headers = event.request?.headers
      if (headers && typeof headers === 'object') {
        for (const k of Object.keys(headers)) {
          const lower = k.toLowerCase()
          if (lower === 'authorization' || lower === 'cookie' || lower.includes('api-key') || lower.includes('apikey')) {
            ;(headers as Record<string, string>)[k] = '[redacted]'
          }
        }
      }
      return event
    },
  })
  inited = true
}

export function reportError(
  err: unknown,
  ctx?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  if (!inited) return
  Sentry.captureException(err, ctx)
}

export function reportMessage(
  msg: string,
  level: 'info' | 'warning' | 'error' | 'fatal',
  ctx?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  if (!inited) return
  Sentry.captureMessage(msg, { level, ...ctx })
}

/**
 * Drop-in handler for `app.onError(sentryHonoErrorHandler)` on a Hono app.
 *
 * Sentry MUSHI-MUSHI-SERVER-H (regressed 2026-04-23): Hono's CORS middleware
 * crashed with `RangeError: status (0) is not equal to 101 and outside [200,
 * 599]` whenever a downstream handler returned `Response.error()` (status 0,
 * the default for failed `fetch()` outputs) or hit an `AbortError` mid-stream.
 * Hono then tried to clone that Response inside `Context.set res` and the
 * native `Response` constructor threw — which Hono's onError caught, but the
 * resulting Sentry event had ZERO app-frame stack so the operator couldn't
 * tell which route emitted the bad Response.
 *
 * The handler now tags every reported error with the underlying status code
 * (when discoverable), the route, the method, and a `range_error_status_0`
 * boolean so the next recurrence is immediately greppable in Sentry. We also
 * special-case the `RangeError` so the user-facing response is `502 upstream
 * fetch failed` instead of a plain `500 internal` — the route handler did
 * succeed at signalling a network failure; the `RangeError` was just our own
 * adapter's loss-of-fidelity bug.
 */
export function sentryHonoErrorHandler(err: Error, c: Context): Response {
  const isRangeStatusZero =
    err instanceof RangeError && /status.*\(0\)|status.+not equal to 101/i.test(err.message)
  reportError(err, {
    tags: {
      path: c.req.path,
      method: c.req.method,
      range_error_status_0: isRangeStatusZero ? 'true' : 'false',
    },
    extra: {
      // The cause chain occasionally carries the original fetch failure
      // (AbortError, "fetch failed", DNS failure) that produced the
      // status-0 Response in the first place.
      cause:
        err.cause !== undefined
          ? String((err.cause as { message?: string }).message ?? err.cause).slice(0, 500)
          : null,
      message: err.message,
    },
  })
  if (isRangeStatusZero) {
    return c.json(
      {
        error: 'upstream_fetch_failed',
        detail:
          'A downstream fetch returned no response (status 0) — usually a network/DNS failure or an aborted request. See Sentry for the underlying cause.',
      },
      502,
    )
  }
  return c.json({ error: 'internal' }, 500)
}

/**
 * Wrap a plain `Deno.serve` handler so unhandled exceptions get reported
 * to Sentry before being re-thrown (Deno surfaces them as 500s).
 */
export function withSentry(
  functionName: string,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  ensureSentry(functionName)
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req)
    } catch (err) {
      reportError(err, {
        tags: { function: functionName, method: req.method },
        extra: { url: req.url.replace(TOKEN_QUERY_RX, '$1[redacted]') },
      })
      throw err
    }
  }
}

export { Sentry }
