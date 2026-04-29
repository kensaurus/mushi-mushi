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
 * Sentry MUSHI-MUSHI-SERVER-H story so far:
 *   - 2026-04-23: First seen. RangeError "status (0) is not equal to 101 and
 *     outside [200, 599]" thrown by Deno's `new Response()` when Hono's
 *     `Context.set res` tried to clone a Response whose `status === 0`.
 *     16 events across 6 days, all on long-running admin GETs
 *     (/v1/admin/dashboard, /v1/admin/reports) and fire-and-forget POSTs
 *     (/v1/admin/fixes/dispatch).
 *   - 2026-04-24 (commit e218bbf): Added diagnostic tagging
 *     (`range_error_status_0=true`) so we could see which routes were
 *     affected, but kept reporting as a Sentry error.
 *   - 2026-04-29 (this fix): With the diagnostic data in hand, we can confirm
 *     there is NO app-code Response with status 0 anywhere in the codebase
 *     (grep'd `c.json(.*,\s*0)`, `status:\s*0`, `Response.error()`). The
 *     recurring path is the documented Deno/Supabase Edge Runtime quirk where
 *     a client disconnect mid-response surfaces inside Hono as a status-0
 *     Response on `c.res`. References:
 *       - https://stackoverflow.com/questions/77097886 (Deno aborts)
 *       - github.com/denoland/deno/issues/28632
 *       - github.com/supabase/supabase/issues/39287
 *     So this is a CLIENT-side disconnection event, not a server bug. Treat
 *     it accordingly: tag it, count it via `reportMessage(... 'warning')` so
 *     we still see the volume in Sentry's Issues list, but DON'T capture as
 *     an exception (which spawns a recurring P-issue, pages on-call, and
 *     skews error budgets). The user-facing response is still 499 Client
 *     Closed Request — semantically accurate per Nginx convention; the
 *     browser already disconnected so no one will see it anyway.
 *
 * Anything else (real RangeErrors, TypeErrors, network failures from the
 * server-side, etc.) is still reported as a normal Sentry exception.
 */
export function sentryHonoErrorHandler(err: Error, c: Context): Response {
  const isRangeStatusZero =
    err instanceof RangeError && /status.*\(0\)|status.+not equal to 101/i.test(err.message)

  if (isRangeStatusZero) {
    // Client disconnect — log as warning (visible in Sentry's "Issues" tab as
    // a low-priority warning, not a P-issue) and return 499. Keep the route
    // tag so we can still spot a real upstream regression if the count
    // suddenly spikes on a new path.
    reportMessage('client_aborted_response', 'warning', {
      tags: {
        path: c.req.path,
        method: c.req.method,
        client_abort: 'true',
        range_error_status_0: 'true',
      },
      extra: {
        cause:
          err.cause !== undefined
            ? String((err.cause as { message?: string }).message ?? err.cause).slice(0, 500)
            : null,
        message: err.message,
      },
    })
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
