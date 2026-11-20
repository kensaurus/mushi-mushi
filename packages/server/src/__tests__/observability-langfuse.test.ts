/**
 * Mushi report dbd9f3c0: Langfuse retired `/api/public/ingestion` (HTTP 410).
 * Traces now go to the OTLP endpoint and scores to `/api/public/scores`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  LANGFUSE_BASE_URL: 'https://lf.example',
}
;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } }

const { createTrace, scoreExistingTrace, checkOtlpPartialSuccess } = await import(
  '../../supabase/functions/_shared/observability.ts'
)

type OtlpValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
interface OtlpAttribute { key: string; value: OtlpValue }
interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpAttribute[]
}
interface OtlpBody { resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[] }

type Call = { url: string; body: unknown }
let calls: Call[]
let respond: () => Response | Promise<Response>

beforeEach(() => {
  calls = []
  reportError.mockReset()
  respond = () => new Response('{}', { status: 200 })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as unknown })
    return respond()
  }))
})
afterEach(() => vi.unstubAllGlobals())

const flush = () => new Promise((r) => setTimeout(r, 0))
function spansOf(c: Call): OtlpSpan[] {
  const body = c.body as Partial<OtlpBody> | null
  const spans = body?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans
  if (!Array.isArray(spans)) throw new Error(`not an OTLP traces body: ${c.url}`)
  return spans
}
const attr = (span: OtlpSpan, key: string): OtlpValue | undefined =>
  span.attributes.find((a) => a.key === key)?.value

describe('Langfuse transport', () => {
  it('never calls the retired ingestion endpoint', async () => {
    const trace = createTrace('classify', { projectId: 'p1' })
    trace.span('llm').end({ model: 'm', inputTokens: 3, outputTokens: 4 })
    await trace.score('quality', 1)
    await trace.end()
    await scoreExistingTrace(trace.id, 'helpful', 1)
    await flush()
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.url).not.toContain('/ingestion')
  })

  it('publishes the trace as soon as it starts', async () => {
    const trace = createTrace('classify', { projectId: 'p1' })
    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://lf.example/api/public/otel/v1/traces')
    const [root] = spansOf(calls[0])
    expect(root.traceId).toBe(trace.id)
    expect(trace.id).toMatch(/^[0-9a-f]{32}$/)
    expect(attr(root, 'langfuse.trace.name')).toEqual({ stringValue: 'classify' })
    expect(attr(root, 'langfuse.trace.metadata.projectId')).toEqual({ stringValue: 'p1' })
  })

  it('keeps spans under the trace and the generation under its span', async () => {
    const trace = createTrace('classify')
    trace.span('llm').end({ model: 'claude', inputTokens: 3, outputTokens: 4 })
    await flush()
    const [span, gen] = spansOf(calls[1])
    expect(span.parentSpanId).toBeUndefined()
    expect(attr(span, 'langfuse.observation.type')).toEqual({ stringValue: 'span' })
    expect(gen.parentSpanId).toBe(span.spanId)
    expect(attr(gen, 'langfuse.observation.type')).toEqual({ stringValue: 'generation' })
    expect(attr(gen, 'langfuse.observation.model.name')).toEqual({ stringValue: 'claude' })
    expect(attr(gen, 'gen_ai.usage.input_tokens')).toEqual({ intValue: '3' })
  })

  it('end() re-sends the root span with its end time', async () => {
    const trace = createTrace('classify')
    await flush()
    const startRoot = spansOf(calls[0])[0]
    await trace.end()
    const endRoot = spansOf(calls[1])[0]
    expect(endRoot.spanId).toBe(startRoot.spanId)
    expect(attr(endRoot, 'langfuse.observation.metadata.state')).toEqual({ stringValue: 'completed' })
    const completedAt = attr(endRoot, 'langfuse.trace.metadata.completedAt')
    expect(completedAt).toEqual({ stringValue: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
    expect(attr(endRoot, 'langfuse.observation.metadata.completedAt')).toEqual(completedAt)
  })

  it('end() exports completion only after a slow start export settles', async () => {
    let releaseStart: (r: Response) => void = () => {}
    respond = () => new Promise<Response>((resolve) => { releaseStart = resolve })
    const trace = createTrace('classify')
    await flush()
    expect(calls).toHaveLength(1)

    respond = () => new Response('{}', { status: 200 })
    const ended = trace.end()
    await flush()
    await flush()
    // The start export is still in flight: completion must not be sent yet.
    expect(calls).toHaveLength(1)

    releaseStart(new Response('{}', { status: 200 }))
    await ended
    expect(calls).toHaveLength(2)
    expect(attr(spansOf(calls[0])[0], 'langfuse.observation.metadata.state')).toEqual({ stringValue: 'started' })
    expect(attr(spansOf(calls[1])[0], 'langfuse.observation.metadata.state')).toEqual({ stringValue: 'completed' })
  })

  it('sends scores to the scores API', async () => {
    await scoreExistingTrace('abc', 'helpful', 1, 'nice')
    expect(calls[0].url).toBe('https://lf.example/api/public/scores')
    expect(calls[0].body).toEqual({ traceId: 'abc', name: 'helpful', value: 1, comment: 'nice' })
  })

  it('reports OTLP partial rejections', async () => {
    respond = () =>
      new Response(JSON.stringify({ partialSuccess: { rejectedSpans: 2, errorMessage: 'bad span' } }), {
        status: 200,
      })
    createTrace('classify')
    await flush()
    await flush()
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(String((reportError.mock.calls[0][0] as Error).message)).toContain('2 span(s) rejected')
  })

  it('reports HTTP failures such as 410', async () => {
    respond = () => new Response('gone', { status: 410 })
    await scoreExistingTrace('abc', 'helpful', 1)
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(String((reportError.mock.calls[0][0] as Error).message)).toContain('Langfuse HTTP 410')
  })

  it('accepts a full or empty OTLP success body', () => {
    expect(() => checkOtlpPartialSuccess({})).not.toThrow()
    expect(() => checkOtlpPartialSuccess(null)).not.toThrow()
    expect(() => checkOtlpPartialSuccess({ partialSuccess: { rejectedSpans: '0', errorMessage: 'warn' } })).not.toThrow()
  })
})
