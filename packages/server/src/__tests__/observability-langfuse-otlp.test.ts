/**
 * FILE: packages/server/src/__tests__/observability-langfuse-otlp.test.ts
 * PURPOSE: Langfuse shut `/api/public/ingestion` for traces and observations
 *          on 2026-11-16 (HTTP 410; Sentry MUSHI-MUSHI-SERVER-3X/3Y/3Z/45,
 *          Mushi reports 57f0c6ba, 546cde9d, 56853d1a, dbd9f3c0). Traces now
 *          go to the OTLP endpoint with the v4 ingestion header, each span
 *          exported once; scores go to `/api/public/scores`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reportError = vi.fn()
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError }))
vi.mock('../../supabase/functions/_shared/pii-scrubber.ts', () => ({ scrubPii: (s: string) => s }))

const env: Record<string, string> = {
  LANGFUSE_SECRET_KEY: 'sk',
  LANGFUSE_PUBLIC_KEY: 'pk',
  LANGFUSE_BASE_URL: 'https://lf.example/',
}
;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } }

const { createTrace, scoreExistingTrace } = await import('../../supabase/functions/_shared/observability.ts')

interface Attr { key: string; value: Record<string, unknown> }
interface OtlpSpan { traceId: string; spanId: string; parentSpanId?: string; name: string; attributes: Attr[] }
type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> }
let calls: Call[]
let respond: () => Response

beforeEach(() => {
  calls = []
  reportError.mockReset()
  respond = () => new Response('{}', { status: 200 })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return respond()
  }))
})
afterEach(() => vi.unstubAllGlobals())

const flush = () => new Promise((r) => setTimeout(r, 0))
const spansOf = (c: Call) =>
  (c.body as { resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[] }).resourceSpans[0].scopeSpans[0].spans
const attr = (s: OtlpSpan, key: string) => {
  const v = s.attributes.find((a) => a.key === key)?.value
  return v ? Object.values(v)[0] : undefined
}

describe('Langfuse over OTLP (v4)', () => {
  it('never calls the retired ingestion endpoint, and sends the v4 header', async () => {
    const trace = createTrace('classify-report', { projectId: 'p1' })
    trace.span('stage2').end({ model: 'gpt-6.1-terra', inputTokens: 10, outputTokens: 5 })
    await flush()
    await trace.end()
    expect(calls.length).toBe(2)
    for (const c of calls) {
      expect(c.url).toBe('https://lf.example/api/public/otel/v1/traces')
      expect(c.headers['x-langfuse-ingestion-version']).toBe('4')
      expect(c.headers.Authorization).toBe(`Basic ${btoa('pk:sk')}`)
    }
  })

  it('exports the root span once, in end(), never again at start', async () => {
    const trace = createTrace('ask-mushi')
    await flush()
    expect(calls).toHaveLength(0)
    await trace.end()
    await trace.end()
    expect(calls).toHaveLength(1)
    const [root] = spansOf(calls[0])
    expect(root.traceId).toBe(trace.id)
    expect(root.name).toBe('ask-mushi')
  })

  it('uses a 32-hex OTel trace id, copies the trace name onto every span, and nests the generation', async () => {
    const trace = createTrace('fast-filter', { reportId: 'r1' })
    expect(trace.id).toMatch(/^[0-9a-f]{32}$/)
    trace.span('stage1').end({ model: 'gpt-6-luna', inputTokens: 3, outputTokens: 2 })
    await flush()
    const [span, generation] = spansOf(calls[0])
    expect(attr(span, 'langfuse.trace.name')).toBe('fast-filter')
    expect(attr(span, 'langfuse.trace.metadata.reportId')).toBe('r1')
    expect(attr(generation, 'langfuse.observation.type')).toBe('generation')
    expect(attr(generation, 'langfuse.observation.model.name')).toBe('gpt-6-luna')
    expect(JSON.parse(String(attr(generation, 'langfuse.observation.usage_details')))).toEqual({ input: 3, output: 2 })
    expect(generation.parentSpanId).toBe(span.spanId)
  })

  it('scores go to the scores API with the trace id', async () => {
    const trace = createTrace('judge-batch')
    await trace.score('judge', 0.8, 'ok')
    await scoreExistingTrace('abc', 'thumbs', 1)
    expect(calls.map((c) => c.url)).toEqual([
      'https://lf.example/api/public/scores',
      'https://lf.example/api/public/scores',
    ])
    expect(calls[0].body).toEqual({ traceId: trace.id, name: 'judge', value: 0.8, comment: 'ok' })
    expect(calls[1].body).toEqual({ traceId: 'abc', name: 'thumbs', value: 1 })
  })

  it('reports an HTTP failure and an OTLP partial rejection to Sentry', async () => {
    respond = () => new Response('{"message":"gone"}', { status: 410 })
    await createTrace('a').end()
    respond = () => new Response(JSON.stringify({ partialSuccess: { rejectedSpans: 1, errorMessage: 'bad' } }), { status: 200 })
    await createTrace('b').end()
    expect(reportError).toHaveBeenCalledTimes(2)
    expect(String(reportError.mock.calls[0][0])).toContain('Langfuse HTTP 410')
    expect(String(reportError.mock.calls[1][0])).toContain('1 span(s) rejected')
  })
})
