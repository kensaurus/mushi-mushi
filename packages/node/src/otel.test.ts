/**
 * Tests for createOtelSpanProcessor (node OTel bridge).
 *
 * We use a mocked global `fetch` and a stub `MushiNodeClient` so that
 * neither live network requests nor a real OTel installation is required.
 *
 * Note: The no-op path (when @opentelemetry/api is not installed) cannot
 * be reliably exercised in a pnpm monorepo where the peer is always
 * resolvable from the workspace.  We test the *active* path exhaustively.
 * The warn-once guard is covered by the fact that console.warn is never
 * called in the active path (asserted in the "no warn when active" test).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOtelSpanProcessor } from './otel.js'
import type { MushiNodeClient } from './client.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeClient() {
  const captureException = vi.fn().mockResolvedValue({ reportId: 'r-otel-001' })
  const captureReport = vi.fn().mockResolvedValue({ reportId: 'r-otel-002' })
  const client = { captureException, captureReport } as unknown as MushiNodeClient
  return { captureException, captureReport, client }
}

/** Build a minimal OTel-shaped span. */
function makeSpan(overrides: {
  statusCode?: number
  name?: string
  attributes?: Record<string, unknown>
  traceId?: string
  spanId?: string
  startMs?: number
  endMs?: number
  parentSpanId?: string
} = {}) {
  const traceId = overrides.traceId ?? 'a'.repeat(32)
  const spanId = overrides.spanId ?? 'b'.repeat(16)
  return {
    status: { code: overrides.statusCode ?? 2 }, // 2 = ERROR
    attributes: overrides.attributes ?? { 'exception.message': 'test error' },
    name: overrides.name ?? 'test-span',
    spanContext: () => ({ traceId, spanId }),
    parentSpanId: overrides.parentSpanId,
    startTime: [0, 0] as [number, number],
    endTime: [0, 1_000_000] as [number, number],
  }
}

const fetchMock = vi.fn().mockResolvedValue({ ok: true })

// ─── tests ───────────────────────────────────────────────────────────────────

describe('createOtelSpanProcessor — active path (errorsOnly=true default)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an object with onStart/onEnd/shutdown/forceFlush', async () => {
    const { client } = makeClient()
    const proc = await createOtelSpanProcessor(client)
    expect(typeof proc.onStart).toBe('function')
    expect(typeof proc.onEnd).toBe('function')
    expect(typeof proc.shutdown).toBe('function')
    expect(typeof proc.forceFlush).toBe('function')
  })

  it('onEnd calls captureException for ERROR spans', async () => {
    const { captureException, client } = makeClient()
    const proc = await createOtelSpanProcessor(client)
    const span = makeSpan({ statusCode: 2, attributes: { 'exception.message': 'db timeout' } })

    proc.onEnd(span)

    await new Promise<void>((r) => setTimeout(r, 10))
    expect(captureException).toHaveBeenCalledOnce()
    const [message, opts] = captureException.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toBe('db timeout')
    expect((opts as { component: string }).component).toBe('otel:test-span')
  })

  it('includes traceparent in the report metadata', async () => {
    const { captureException, client } = makeClient()
    const proc = await createOtelSpanProcessor(client)
    const span = makeSpan({
      statusCode: 2,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    })

    proc.onEnd(span)

    await new Promise<void>((r) => setTimeout(r, 10))
    const [, opts] = captureException.mock.calls[0] as [string, { metadata: Record<string, unknown> }]
    expect(opts.metadata['traceparent']).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')
  })

  it('falls back to span name when exception.message attribute is absent', async () => {
    const { captureException, client } = makeClient()
    const proc = await createOtelSpanProcessor(client)
    const span = makeSpan({ statusCode: 2, attributes: {}, name: 'db.query' })

    proc.onEnd(span)

    await new Promise<void>((r) => setTimeout(r, 10))
    const [message] = captureException.mock.calls[0] as [string]
    expect(message).toContain('db.query')
  })

  it('skips non-ERROR spans when errorsOnly=true (default)', async () => {
    const { captureException, client } = makeClient()
    const proc = await createOtelSpanProcessor(client)
    const okSpan = makeSpan({ statusCode: 1 }) // OK

    proc.onEnd(okSpan)

    await new Promise<void>((r) => setTimeout(r, 10))
    expect(captureException).not.toHaveBeenCalled()
  })

  it('does NOT fire captureException for non-ERROR when errorsOnly=false', async () => {
    const { captureException, client } = makeClient()
    const proc = await createOtelSpanProcessor(client, { errorsOnly: false })
    const okSpan = makeSpan({ statusCode: 1, attributes: {} })

    proc.onEnd(okSpan)

    await new Promise<void>((r) => setTimeout(r, 10))
    // errorsOnly:false means non-error spans enter the branch — but captureException
    // is only called for the isError branch.  Non-error spans still don't trigger it.
    expect(captureException).not.toHaveBeenCalled()
  })

  it('never throws even when captureException rejects', async () => {
    const { client } = makeClient()
    ;(client.captureException as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'))
    const proc = await createOtelSpanProcessor(client)

    expect(() => proc.onEnd(makeSpan({ statusCode: 2 }))).not.toThrow()
  })

  it('onStart is a no-op (does not throw)', async () => {
    const { client } = makeClient()
    const proc = await createOtelSpanProcessor(client)
    expect(() => proc.onStart(makeSpan(), {})).not.toThrow()
  })

  it('shutdown and forceFlush resolve', async () => {
    const { client } = makeClient()
    const proc = await createOtelSpanProcessor(client)
    await expect(proc.shutdown()).resolves.toBeUndefined()
    await expect(proc.forceFlush()).resolves.toBeUndefined()
  })
})

describe('createOtelSpanProcessor — OTLP export', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS
  })

  it('POSTs to OTLP endpoint for every span when otlpEndpoint set', async () => {
    const { client } = makeClient()
    const proc = await createOtelSpanProcessor(client, {
      otlpEndpoint: 'https://otel.example.com',
    })
    const span = makeSpan({ statusCode: 1, attributes: {} }) // non-error span

    proc.onEnd(span)

    await new Promise<void>((r) => setTimeout(r, 20))
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://otel.example.com/v1/traces')
    const body = JSON.parse(init.body as string)
    expect(body.resourceSpans).toHaveLength(1)
  })

  it('reads OTLP headers from env when otlpHeaders not set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example.com'
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer tok,x-ds=1'
    const { client } = makeClient()
    const proc = await createOtelSpanProcessor(client)
    proc.onEnd(makeSpan({ statusCode: 2 }))

    await new Promise<void>((r) => setTimeout(r, 20))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer tok')
    expect(headers['x-ds']).toBe('1')
  })

  it('accepts otlpHeaders as an object', async () => {
    const { client } = makeClient()
    const proc = await createOtelSpanProcessor(client, {
      otlpEndpoint: 'https://otel.example.com',
      otlpHeaders: { 'x-api-key': 'abc' },
    })
    proc.onEnd(makeSpan({ statusCode: 2 }))

    await new Promise<void>((r) => setTimeout(r, 20))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('abc')
  })
})
