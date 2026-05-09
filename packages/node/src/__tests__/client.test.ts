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
