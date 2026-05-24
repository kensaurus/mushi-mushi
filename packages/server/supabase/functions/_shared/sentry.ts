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
 * Sentry MUSHI-MUSHI-SERVER-H / -P story so far:
 *   - 2026-04-23: First seen. RangeError "status (0) is not equal to 101 and
 *     outside [200, 599]" thrown by Deno's `new Response()` when Hono's
 *     `Context.set res` tried to clone a Response whose `status === 0`.
 *     16 events across 6 days, all on long-running admin GETs
 *     (/v1/admin/dashboard, /v1/admin/reports) and fire-and-forget POSTs
 *     (/v1/admin/fixes/dispatch).
 *   - 2026-04-24 (commit e218bbf): Added diagnostic tagging
 *     (`range_error_status_0=true`) so we could see which routes were
 *     affected, but kept reporting as a Sentry error.
 *   - 2026-04-29: With the diagnostic data in hand, confirmed there is NO
 *     app-code Response with status 0 anywhere in the codebase
 *     (grep'd `c.json(.*,\s*0)`, `status:\s*0`, `Response.error()`). The
 *     recurring path is the documented Deno/Supabase Edge Runtime quirk where
 *     a client disconnect mid-response surfaces inside Hono as a status-0
 *     Response on `c.res`. References:
 *       - https://stackoverflow.com/questions/77097886 (Deno aborts)
 *       - github.com/denoland/deno/issues/28632
 *       - github.com/supabase/supabase/issues/39287
 *     So this is a CLIENT-side disconnection event, not a server bug. The
 *     handler was downgraded to `reportMessage(... 'warning')` on the
 *     mistaken assumption that warning-level messages would not surface as
 *     Issues. They do — per the Sentry JS SDK docs, every `captureMessage`
 *     call creates an issue regardless of severity; level only affects
 *     alert rules and priority. Sentry MUSHI-MUSHI-SERVER-P kept regressing
 *     because of this, accumulating 9 events on the same client-abort path.
 *   - 2026-05-24 (this fix): Stop calling `captureMessage` for client
 *     aborts entirely. Volume tracking moves to `console.warn` with a
 *     structured JSON payload — Supabase Logs aggregates these and the
 *     `client_abort=true` field is queryable from the Logs Explorer
 *     (`metadata.parsed.client_abort=true`). The Sentry side stays clean
 *     for actual server bugs, and the 499 response is unchanged so any
 *     proxy/CDN telemetry that pivots on status code keeps working.
 *
 * Anything else (real RangeErrors, TypeErrors, network failures from the
 * server-side, etc.) is still reported as a normal Sentry exception.
 */
export function sentryHonoErrorHandler(err: Error, c: Context): Response {
  const isRangeStatusZero =
    err instanceof RangeError && /status.*\(0\)|status.+not equal to 101/i.test(err.message)

  if (isRangeStatusZero) {
    // Structured warning to Supabase Logs only — no Sentry capture. Query
    // volume in production via:
    //   logs explorer → filter `metadata.parsed.event="client_aborted_response"`
    // If that volume ever spikes on a NEW path/method, that's the operator's
    // cue to investigate (probably means a regression elsewhere is causing
    // long-running responses that legitimate clients now abort).
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        scope: 'mushi:sentry-hono-handler',
        event: 'client_aborted_response',
        msg: 'client disconnected before response could be written',
        path: c.req.path,
        method: c.req.method,
        client_abort: true,
        range_error_status_0: true,
        cause:
          err.cause !== undefined
            ? String((err.cause as { message?: string }).message ?? err.cause).slice(0, 500)
            : null,
        message: err.message,
      }),
    )
    return c.json(
      {
        error: 'client_closed_request',
        detail:
          'The client disconnected before the response could be written. This is informational; the connection is already closed.',
      },
      // 499 (Nginx) communicates "client closed connection". Hono accepts any
      // numeric status code; only 1xx/0 are forbidden by `new Response()`.
      499,
    )
  }

  reportError(err, {
    tags: { path: c.req.path, method: c.req.method },
    extra: {
      cause:
        err.cause !== undefined
          ? String((err.cause as { message?: string }).message ?? err.cause).slice(0, 500)
          : null,
      message: err.message,
    },
  })
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
