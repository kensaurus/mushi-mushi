/**
 * packages/plugin-sdk/src/retry.ts
 *
 * Exponential back-off + bounded-additive-jitter retry wrapper for outbound
 * HTTP calls made by Mushi plugins (PagerDuty, Slack, Jira, Linear, …).
 *
 * Retry decision table:
 *   429             → retry; honour Retry-After header (seconds or HTTP-date)
 *   503 / 504       → retry with exponential back-off
 *   other 5xx       → retry with exponential back-off
 *   4xx (not 429)   → throw immediately — not retriable
 *   network error   → retry with exponential back-off
 *
 * Callers must throw the Response object (not wrap it in a new Error) so that
 * the status code and Retry-After header are visible to `withRetry`:
 *
 *   await withRetry(async () => {
 *     const res = await fetch(url, opts)
 *     if (!res.ok) throw res          // throw the Response itself
 *     return res.json()
 *   })
 *
 * Delay formula:  min(baseDelayMs × 2ⁿ + rand(0, 500 ms), maxDelayMs)
 *   where n is the 0-indexed retry attempt. The 500 ms additive jitter
 *   smooths thundering-herd effects without giving up the predictable upper
 *   bound that AWS / Azure-style "full jitter" sacrifices.
 */

import { setTimeout as sleep } from 'node:timers/promises'

export interface RetryOptions {
  /** Maximum total attempts, including the first. Default 4. */
  maxAttempts?: number
  /** Base delay in ms before the first retry. Default 1 000. */
  baseDelayMs?: number
  /** Upper cap on the computed delay. Default 10 000. */
  maxDelayMs?: number
  /**
   * When provided, callers should forward this value as `Idempotency-Key` in
   * their request headers to prevent server-side duplicate processing on
   * retried POSTs. `withRetry` does not attach the header itself — the caller
   * is responsible for passing it through each request attempt.
   */
  idempotencyKey?: string
  /**
   * Called before each retry sleep. Useful for test spies and structured
   * logging. `attempt` is 1-indexed (first retry = 1).
   */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void
}

/**
 * Minimal duck-type for a Web Fetch Response thrown as an error.
 * We check this shape on caught values to read `.status` and
 * `.headers.get('Retry-After')` before deciding whether to retry.
 */
interface ResponseLike {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
}

function isResponseLike(value: unknown): value is ResponseLike {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v['status'] !== 'number') return false
  if (typeof v['headers'] !== 'object' || v['headers'] === null) return false
  if (typeof (v['headers'] as Record<string, unknown>)['get'] !== 'function') return false
  return true
}

/**
 * Parse a `Retry-After` header value into a delay in milliseconds.
 * Handles the delta-seconds form ("120") and the HTTP-date form.
 */
function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null
  const secs = Number(value.trim())
  if (Number.isFinite(secs) && secs >= 0) return secs * 1_000
  const fromDate = Date.parse(value)
  if (!Number.isNaN(fromDate)) return Math.max(0, fromDate - Date.now())
  return null
}

function computeBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs)
}

/**
 * Wraps an async function with exponential back-off + full-jitter retry.
 *
 * The wrapped `fn` should throw the raw `Response` object when an HTTP
 * response is unsuccessful so that `withRetry` can inspect status and headers.
 * Non-Response throws are treated as transient network errors and retried.
 *
 * @example
 * const json = await withRetry(async () => {
 *   const res = await fetch(url, { method: 'POST', body })
 *   if (!res.ok) throw res          // expose status + Retry-After to withRetry
 *   return res.json()
 * }, { maxAttempts: 4, onRetry: (n, d) => console.warn('retry', n, d) })
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4
  const baseDelayMs = opts.baseDelayMs ?? 1_000
  const maxDelayMs  = opts.maxDelayMs  ?? 10_000

  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      if (attempt + 1 >= maxAttempts) break

      let delayMs: number

      if (isResponseLike(err)) {
        const { status, headers } = err
        if (status === 429) {
          delayMs =
            parseRetryAfterMs(headers.get('Retry-After')) ??
            computeBackoff(attempt, baseDelayMs, maxDelayMs)
        } else if (status === 503 || status === 504) {
          delayMs = computeBackoff(attempt, baseDelayMs, maxDelayMs)
        } else if (status >= 400 && status < 500) {
          // Non-retriable client error — fail fast without further attempts
          throw err
        } else {
          // Other 5xx
          delayMs = computeBackoff(attempt, baseDelayMs, maxDelayMs)
        }
      } else {
        // Network error or other unknown failure — always retry
        delayMs = computeBackoff(attempt, baseDelayMs, maxDelayMs)
      }

      opts.onRetry?.(attempt + 1, delayMs, err)
      await sleep(delayMs)
    }
  }

  throw lastError
}
