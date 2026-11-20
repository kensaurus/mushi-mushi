/**
 * Langfuse retired `/api/public/ingestion` (HTTP 410, Mushi report
 * dbd9f3c0-18c6-48d3-86b6-ae907257a023). Traces must go to the OTel
 * endpoint and scores to `/api/public/scores`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError }))

const env: Record<string, string> = {
  LANGFUSE_SECRET_KEY: 'sk-test',
  LANGFUSE_PUBLIC_KEY: 'pk-test',
  LANGFUSE_BASE_URL: 'https://lf.example/',
}

import {
  buildOtlpSpanPayload,
  createTrace,
  scoreExistingTrace,
} from '../../supabase/functions/_shared/observability.ts'

describe('Langfuse transport', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))

  beforeEach(() => {
    vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } })
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
    reportError.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('never calls the retired ingestion endpoint', async () => {
    const trace = createTrace('classify', { reportId: 'r1' })
    expect(trace.id).toMatch(/^[0-9a-f]{32}$/)
    trace.span('llm').end({ model: 'claude', inputTokens: 3, outputTokens: 4 })
    await trace.score('quality', 1, 'ok')
    await trace.end()
    await scoreExistingTrace(trace.id, 'feedback', 0)
    await new Promise((r) => setTimeout(r, 0))

    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls.some((u) => u.includes('/ingestion'))).toBe(false)
    expect(urls.filter((u) => u === 'https://lf.example/api/public/otel/v1/traces')).toHaveLength(2)
    expect(urls.filter((u) => u === 'https://lf.example/api/public/scores')).toHaveLength(2)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('maps a model span to a Langfuse generation', () => {
    const payload = buildOtlpSpanPayload({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      parentSpanId: 'c'.repeat(16),
      name: 'llm',
      startMs: 1000,
      endMs: 1500,
      traceName: 'classify',
      traceMetadata: { reportId: 'r1' },
      data: { model: 'claude', inputTokens: 3, outputTokens: 4, error: 'boom' },
    }) as { resourceSpans: { scopeSpans: { spans: Record<string, unknown>[] }[] }[] }
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0]
    expect(span.startTimeUnixNano).toBe('1000000000')
    expect(span.parentSpanId).toBe('c'.repeat(16))
    const attrs = Object.fromEntries(
      (span.attributes as { key: string; value: Record<string, unknown> }[])
        .map((a) => [a.key, Object.values(a.value)[0]]),
    )
    expect(attrs['langfuse.trace.name']).toBe('classify')
    expect(attrs['langfuse.trace.metadata.reportId']).toBe('r1')
    expect(attrs['langfuse.observation.type']).toBe('generation')
    expect(attrs['gen_ai.request.model']).toBe('claude')
    expect(attrs['gen_ai.usage.input_tokens']).toBe('3')
    expect(attrs['langfuse.observation.level']).toBe('ERROR')
    expect(span.status).toEqual({ code: 2, message: 'boom' })
  })
})
