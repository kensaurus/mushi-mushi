/**
 * FILE: packages/server/supabase/functions/_shared/safe-error.ts
 * PURPOSE: Build client-safe HTTP error bodies for edge-function 5xx responses.
 *
 * CodeQL `js/stack-trace-exposure`: never return `String(err)`, `err.message`,
 * or `err.stack` to an HTTP client — those can leak internal file paths, stack
 * frames, and dependency internals. Callers must log the full error
 * server-side (Sentry / `log.error` / `cron.fail(err)`) and return a generic,
 * stable message here instead. A machine-readable `code` is safe to expose for
 * client branching as long as it carries no error detail.
 */

export const GENERIC_ERROR_MESSAGE =
  'Internal error. The failure was logged for investigation.'

export interface SafeErrorOptions {
  /** Stable machine code for client branching (must not embed error detail). */
  code?: string
  /** Override the generic, non-leaking human message. */
  message?: string
  /** HTTP status code (default 500). */
  status?: number
}

/**
 * Returns a JSON `Response` whose body never derives from the caught error.
 * Shape mirrors the existing edge-function convention:
 *   - with `code`:    `{ ok: false, error: { code, message } }`
 *   - without `code`: `{ ok: false, error: message }`
 */
export function safeErrorResponse(opts: SafeErrorOptions = {}): Response {
  const { code, message = GENERIC_ERROR_MESSAGE, status = 500 } = opts
  const body = code
    ? { ok: false, error: { code, message } }
    : { ok: false, error: message }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
