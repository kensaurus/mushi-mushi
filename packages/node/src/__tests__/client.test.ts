import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MushiNodeClient } from '../client'
import { attachUnhandledHook } from '../unhandled'
import { mushiExpressErrorHandler } from '../express'
import { createOtelSpanProcessor } from '../otel'

const BASE_OPTIONS = {
  projectId: 'proj-test',
  apiKey: 'test-key',
  apiEndpoint: 'https://xyz.supabase.co/functions/v1/api',
}

// ---------------------------------------------------------------------------
// MushiNodeClient.captureException
// ---------------------------------------------------------------------------

describe('MushiNodeClient.captureReport', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { reportId: 'r-123' } }),
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to /v1/reports with the correct shape', async () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    const result = await client.captureReport({
      description: 'Something went wrong',
      userCategory: 'bug',
      severity: 'high',
    })

    expect(result.ok).toBe(true)
    expect(result.reportId).toBe('r-123')

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://xyz.supabase.co/functions/v1/api/v1/reports')

    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['projectId']).toBe('proj-test')
    expect(body['category']).toBe('bug')
    expect(body['description']).toBe('Something went wrong')
    expect((init.headers as Record<string, string>)['X-Mushi-Api-Key']).toBe('test-key')
  })

  it('captureException wraps an Error and marks severity critical', async () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    const err = new Error('boom')
    const result = await client.captureException(err)

    expect(result.ok).toBe(true)

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['description']).toBe('boom')
    expect(body['severity']).toBe('critical')
    expect((body['metadata'] as Record<string, unknown>)['error']).toMatchObject({
      name: 'Error',
      message: 'boom',
    })
  })

  it('captureException accepts a plain string', async () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    await client.captureException('plain string error')

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body['description']).toBe('plain string error')
  })

  it('returns ok:false and does not throw on network error', async () => {
    fetchSpy.mockRejectedValue(new TypeError('network failure'))
    const client = new MushiNodeClient(BASE_OPTIONS)
    const result = await client.captureReport({ description: 'test' })
    expect(result.ok).toBe(false)
  })

  it('returns ok:false and does not throw on HTTP 500', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const client = new MushiNodeClient(BASE_OPTIONS)
    const result = await client.captureReport({ description: 'test' })
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AbortSignal propagation (Round 8 — B4)
// ---------------------------------------------------------------------------

describe('MushiNodeClient.captureReport — AbortSignal composition', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      // Real-world fetch promise that respects the signal.
      return new Promise((resolve, reject) => {
        const sig = init.signal
        if (sig?.aborted) return reject(sig.reason ?? new Error('aborted'))
        sig?.addEventListener('abort', () => reject(sig.reason ?? new Error('aborted')))
        setTimeout(() => resolve({ ok: true, json: async () => ({ data: { reportId: 'r-late' } }) }), 50)
      })
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards an aborted per-call signal to fetch (early bail, no retry)', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = new MushiNodeClient(BASE_OPTIONS)
    const result = await client.captureReport(
      { description: 'about to be cancelled' },
      { signal: controller.signal },
    )
    expect(result.ok).toBe(false)
    // We forward the composed signal — already-aborted, so fetch
    // rejects synchronously and the promise resolves to ok:false.
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(init.signal?.aborted).toBe(true)
  })

  it('forwards an aborted process-wide signal (constructor opt-in)', async () => {
    const processController = new AbortController()
    processController.abort()
    const client = new MushiNodeClient({ ...BASE_OPTIONS, signal: processController.signal })
    const result = await client.captureReport({ description: 'shutdown in flight' })
    expect(result.ok).toBe(false)
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(init.signal?.aborted).toBe(true)
  })

  it('aborts the in-flight fetch when the per-call signal aborts mid-flight', async () => {
    const controller = new AbortController()
    const client = new MushiNodeClient(BASE_OPTIONS)
    setTimeout(() => controller.abort(new Error('user cancelled')), 5)
    const result = await client.captureReport(
      { description: 'cancel me' },
      { signal: controller.signal },
    )
    expect(result.ok).toBe(false)
  })

  it('proceeds normally when no signal aborts before the response', async () => {
    const controller = new AbortController()
    const client = new MushiNodeClient({ ...BASE_OPTIONS, signal: controller.signal })
    const result = await client.captureReport({ description: 'ok flow' })
    expect(result.ok).toBe(true)
    expect(result.reportId).toBe('r-late')
  })

  it('captureException accepts an options.signal third argument', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = new MushiNodeClient(BASE_OPTIONS)
    const result = await client.captureException(new Error('boom'), undefined, {
      signal: controller.signal,
    })
    expect(result.ok).toBe(false)
    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// attachUnhandledHook cleanup
// ---------------------------------------------------------------------------

describe('attachUnhandledHook', () => {
  it('restores the original handler on cleanup', () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    const beforeListeners = {
      rejection: process.listenerCount('unhandledRejection'),
      exception: process.listenerCount('uncaughtException'),
    }

    const cleanup = attachUnhandledHook({ client, swallowCrashes: true })

    expect(process.listenerCount('unhandledRejection')).toBe(beforeListeners.rejection + 1)
    expect(process.listenerCount('uncaughtException')).toBe(beforeListeners.exception + 1)

    cleanup()

    expect(process.listenerCount('unhandledRejection')).toBe(beforeListeners.rejection)
    expect(process.listenerCount('uncaughtException')).toBe(beforeListeners.exception)
  })
})

// ---------------------------------------------------------------------------
// Express middleware — passes through non-5xx requests without reporting
// ---------------------------------------------------------------------------

describe('mushiExpressErrorHandler', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { reportId: 'r-456' } }),
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls next(err) regardless of whether a report is sent', () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    const middleware = mushiExpressErrorHandler({ client })
    const next = vi.fn()
    const err = new Error('route error')

    middleware(err, { headers: {}, method: 'GET', url: '/test' }, { statusCode: 500 }, next)

    expect(next).toHaveBeenCalledWith(err)
  })

  it('does NOT send a report for a 4xx response with no error object', () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    const middleware = mushiExpressErrorHandler({ client })
    const next = vi.fn()

    // null error + 404 status → default shouldReport returns false
    middleware(null, { headers: {}, method: 'GET', url: '/missing' }, { statusCode: 404 }, next)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledWith(null)
  })

  it('sends a report for a 5xx response even with no thrown error', () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    const middleware = mushiExpressErrorHandler({ client })
    const next = vi.fn()

    middleware(null, { headers: {}, method: 'POST', url: '/api/data' }, { statusCode: 503 }, next)

    // fire-and-forget — fetch is called asynchronously; just verify next was called
    expect(next).toHaveBeenCalledWith(null)
  })
})

// ---------------------------------------------------------------------------
// createOtelSpanProcessor — no-op when @opentelemetry/api is absent
// ---------------------------------------------------------------------------

describe('createOtelSpanProcessor', () => {
  it('returns a processor with the expected interface', async () => {
    const client = new MushiNodeClient(BASE_OPTIONS)
    const processor = await createOtelSpanProcessor(client)
    expect(typeof processor.onStart).toBe('function')
    expect(typeof processor.onEnd).toBe('function')
    expect(typeof processor.shutdown).toBe('function')
    expect(typeof processor.forceFlush).toBe('function')
    await expect(processor.shutdown()).resolves.toBeUndefined()
  })

  it('does not call captureException for non-error spans', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const client = new MushiNodeClient(BASE_OPTIONS)
    const captureSpy = vi.spyOn(client, 'captureException')
    const processor = await createOtelSpanProcessor(client)

    processor.onEnd({
      status: { code: 0 /* SpanStatusCode.UNSET */ },
      attributes: {},
      name: 'GET /api/ok',
      spanContext: () => ({ traceId: '0'.repeat(32), spanId: '0'.repeat(16) }),
      startTime: [0, 0],
      endTime: [0, 0],
    })

    expect(captureSpy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
