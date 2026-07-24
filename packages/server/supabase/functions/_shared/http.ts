/**
 * FILE: packages/server/supabase/functions/_shared/http.ts
 * PURPOSE: Outbound fetch with a mandatory timeout. Third-party calls
 *          (Slack, GitHub, Linear, Stripe, PagerDuty, Resend, …) must never
 *          hang an edge invocation until the platform kills it — every
 *          vendor module goes through this helper instead of bare fetch.
 *          Per-call tuning (retry/backoff/breaker) stays in the caller;
 *          this only guarantees a bounded wait.
 */

/** Default upper bound for a single outbound HTTP call. */
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 15_000

/**
 * Drop-in replacement for `fetch` that enforces a timeout via
 * `AbortSignal.timeout`. An explicit `init.signal` wins, so callers that
 * already manage cancellation are untouched.
 */
export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_OUTBOUND_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  })
}
