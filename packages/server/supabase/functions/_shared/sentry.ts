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
  const dsn = Deno.env.get('SENTRY_DSN_SERVER')
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

/** Drop-in handler for `app.onError(sentryHonoErrorHandler)` on a Hono app. */
export function sentryHonoErrorHandler(err: Error, c: Context): Response {
  reportError(err, {
    tags: { path: c.req.path, method: c.req.method },
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
