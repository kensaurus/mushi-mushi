/**
 * Langfuse shut down `/api/public/ingestion` for traces and observations on
 * 2026-11-16 (HTTP 410, score events excepted). Traces and spans must go to
 * the OTLP endpoint; scores stay on /ingestion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn() }))

const env: Record<string, string> = {
  LANGFUSE_SECRET_KEY: 'sk-test',
  LANGFUSE_PUBLIC_KEY: 'pk-test',
  LANGFUSE_BASE_URL: 'https://lf.example',
}
vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } })

const { createTrace } = await import('../../supabase/functions/_shared/observability.ts')

type Call = { url: string; body: any }
let calls: Call[]

beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    return new Response('{}', { status: 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } }) })

const flush = () => new Promise((r) => setTimeout(r, 0))
const attr = (span: any, key: string) => span.attributes.find((a: any) => a.key === key)?.value

describe('Langfuse export', () => {
  it('sends traces and spans as OTLP to /otel/v1/traces, never to /ingestion', async () => {
    const trace = createTrace('classify', { projectId: 'p1' })
    expect(trace.id).toMatch(/^[0-9a-f]{32}$/)
    trace.span('llm').end({ model: 'claude-x', inputTokens: 10, outputTokens: 5 })
    await trace.end()
    await flush()

    expect(calls.length).toBe(3)
    for (const c of calls) expect(c.url).toBe('https://lf.example/api/public/otel/v1/traces')
    const spans = calls.flatMap((c) => c.body.resourceSpans[0].scopeSpans[0].spans)
    for (const s of spans) expect(s.traceId).toBe(trace.id)

    const root = spans[0]
    expect(attr(root, 'langfuse.trace.name')).toEqual({ stringValue: 'classify' })
    expect(attr(root, 'langfuse.trace.metadata.projectId')).toEqual({ stringValue: 'p1' })

    const gen = spans.find((s: any) => attr(s, 'langfuse.observation.type')?.stringValue === 'generation')
    expect(attr(gen, 'gen_ai.request.model')).toEqual({ stringValue: 'claude-x' })
    expect(attr(gen, 'gen_ai.usage.input_tokens')).toEqual({ intValue: '10' })
  })

  it('keeps scores on /ingestion with the same trace id', async () => {
    const trace = createTrace('t')
    await trace.score('helpful', 1)
    await flush()
    const scoreCall = calls.find((c) => c.url.endsWith('/api/public/ingestion'))
    expect(scoreCall?.body.batch[0]).toMatchObject({ type: 'score-create', body: { traceId: trace.id } })
  })
})
