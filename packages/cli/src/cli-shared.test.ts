import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiCall, normalizeApiError } from './cli-shared.js'

const config = { apiKey: 'k', endpoint: 'https://api.test', projectId: 'p' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('normalizeApiError', () => {
  it('keeps a well-formed error and its details', () => {
    const e = { code: 'ORG_REQUIRED', message: 'pick one', organizations: [{ id: 'o1' }] }
    expect(normalizeApiError(e, 400)).toEqual(e)
  })

  it('turns a bare string into a code and message', () => {
    expect(normalizeApiError('release-builder failed', 500)).toEqual({ code: 'HTTP_500', message: 'release-builder failed' })
  })

  it('flattens a zod flatten() object', () => {
    expect(normalizeApiError({ formErrors: [], fieldErrors: { version: ['Required'] } }, 400))
      .toEqual({ code: 'VALIDATION_ERROR', message: 'version: Required' })
  })

  it('never yields undefined fields', () => {
    const e = normalizeApiError(undefined, 502)
    expect(e.code).toBe('HTTP_502')
    expect(e.message).toContain('502')
  })
})

describe('apiCall', () => {
  it('normalizes { ok: false, error: "text" } and records the status', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(500, { ok: false, error: 'boom' }))
    const r = await apiCall('/x', config)
    expect(r).toEqual({ ok: false, httpStatus: 500, error: { code: 'HTTP_500', message: 'boom' } })
  })

  it('passes a successful envelope through untouched', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(200, { ok: true, data: { a: 1 }, delivery: { n: 2 } }))
    expect(await apiCall('/x', config)).toEqual({ ok: true, data: { a: 1 }, delivery: { n: 2 } })
  })

  it('honours a per-call timeout longer than the default', async () => {
    vi.useFakeTimers()
    let aborted = false
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
        setTimeout(() => resolve(jsonResponse(200, { ok: true, data: 'slow' })), 30_000)
      }))
    const pending = apiCall('/slow', config, {}, { timeoutMs: 60_000 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await pending).toEqual({ ok: true, data: 'slow' })
    expect(aborted).toBe(false)
  })

  it('times out at the per-call limit and says how long it waited', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }))
    const pending = apiCall('/slow', config, {}, { timeoutMs: 5_000 })
    await vi.advanceTimersByTimeAsync(5_000)
    const r = await pending
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('TIMEOUT')
      expect(r.error.message).toContain('5s')
    }
  })
})
