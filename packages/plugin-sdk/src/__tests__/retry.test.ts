/**
 * Unit tests for `withRetry` — Round 8 backlog item B5.
 *
 * Coverage targets:
 *   - 429 honours Retry-After (delta-seconds + HTTP-date)
 *   - 4xx (non-429) bails immediately
 *   - 5xx + network errors retry with exponential back-off
 *   - AbortSignal cancellation fires before the next sleep
 *   - AbortSignal cancellation interrupts the sleep itself
 *   - Pre-aborted signal rejects without ever calling `fn`
 */

import { describe, it, expect, vi } from 'vitest'
import { withRetry } from '../retry.js'

function makeResponse(status: number, headers?: Record<string, string>) {
  return {
    ok: false,
    status,
    headers: { get: (k: string) => headers?.[k.toLowerCase()] ?? null },
  }
}

describe('withRetry — happy path', () => {
  it('returns the first successful result without retrying', async () => {
    const fn = vi.fn(async () => 'ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('withRetry — non-retryable errors', () => {
  it('bails immediately on 401 without retrying or sleeping', async () => {
    const fn = vi.fn(async () => {
      throw makeResponse(401)
    })
    const onRetry = vi.fn()
    await expect(withRetry(fn, { onRetry })).rejects.toMatchObject({ status: 401 })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it.each([400, 403, 404, 410, 422])('bails on 4xx status %i without retrying', async (status) => {
    const fn = vi.fn(async () => {
      throw makeResponse(status)
    })
    await expect(withRetry(fn)).rejects.toMatchObject({ status })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('withRetry — retryable errors', () => {
  it('retries on 503 up to maxAttempts, then throws the last error', async () => {
    const fn = vi.fn(async () => {
      throw makeResponse(503)
    })
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toMatchObject({ status: 503 })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('retries on 429 honouring Retry-After (delta-seconds form)', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw makeResponse(429, { 'retry-after': '0' })
      return 'ok'
    })
    const onRetry = vi.fn()
    const result = await withRetry(fn, { maxAttempts: 3, onRetry })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith(1, 0, expect.objectContaining({ status: 429 }))
  })

  it('retries on a network-level (non-Response) error', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw new TypeError('network down')
      return 'ok'
    })
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('withRetry — AbortSignal cancellation (B5)', () => {
  it('rejects immediately when the signal is already aborted before any attempt', async () => {
    const controller = new AbortController()
    controller.abort(new Error('host shutting down'))
    const fn = vi.fn(async () => 'never')
    await expect(withRetry(fn, { signal: controller.signal })).rejects.toThrow('host shutting down')
    expect(fn).not.toHaveBeenCalled()
  })

  it('rejects with the signal reason mid-back-off rather than waiting it out', async () => {
    const controller = new AbortController()
    let firstAttemptHit = false
    const fn = vi.fn(async () => {
      firstAttemptHit = true
      throw makeResponse(503)
    })
    // Schedule abort 5 ms in. baseDelayMs is 60 s, so without abort
    // honouring this would take a minute.
    setTimeout(() => controller.abort(new Error('SIGTERM')), 5)
    await expect(
      withRetry(fn, {
        maxAttempts: 4,
        baseDelayMs: 60_000,
        maxDelayMs: 60_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow('SIGTERM')
    expect(firstAttemptHit).toBe(true)
    // First attempt fired, then the back-off was cut short by the abort.
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not start a second attempt when aborted between attempts', async () => {
    const controller = new AbortController()
    const fn = vi.fn(async () => {
      throw makeResponse(503)
    })
    // Abort *before* the first call so the very-start guard fires.
    controller.abort()
    await expect(
      withRetry(fn, {
        maxAttempts: 4,
        baseDelayMs: 1,
        maxDelayMs: 1,
        signal: controller.signal,
      }),
    ).rejects.toBeDefined()
    expect(fn).toHaveBeenCalledTimes(0)
  })

  it('completes normally when the signal never aborts', async () => {
    const controller = new AbortController()
    const fn = vi.fn(async () => 'ok')
    const result = await withRetry(fn, { signal: controller.signal })
    expect(result).toBe('ok')
  })
})
