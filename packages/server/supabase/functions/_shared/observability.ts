import { log } from './logger.ts'
import { reportError } from './sentry.ts'
import { scrubPii } from './pii-scrubber.ts'

const traceLog = log.child('trace')

function sanitizeTraceMetadata(metadata?: TraceMetadata): TraceMetadata | undefined {
  if (!metadata) return metadata
  const out: TraceMetadata = {}
  for (const [key, value] of Object.entries(metadata)) {
    out[key] = typeof value === 'string' ? scrubPii(value) : value
  }
  return out
}

function onLangfuseIngestFailure(context: string, err: unknown): void {
  traceLog.warn('Langfuse ingestion failed', { context, err: String(err) })
  if (isConfigured()) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      tags: { langfuse: 'ingestion', context },
    })
  }
}

interface TraceMetadata {
  reportId?: string
  projectId?: string
  [key: string]: unknown
}

interface SpanData {
  model?: string
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  statusCode?: number
  error?: string
  [key: string]: unknown
}

interface Span {
  end(data?: SpanData): void
}

interface Trace {
  id: string
  span(name: string): Span
  score(name: string, value: number, comment?: string): Promise<void>
  end(): Promise<void>
}

function getLangfuseConfig() {
  return {
    secretKey: Deno.env.get('LANGFUSE_SECRET_KEY'),
    publicKey: Deno.env.get('LANGFUSE_PUBLIC_KEY'),
    baseUrl:
      Deno.env.get('LANGFUSE_BASE_URL') ??
      Deno.env.get('LANGFUSE_HOST') ??
      'https://cloud.langfuse.com',
  }
}

function isConfigured(): boolean {
  const { secretKey, publicKey } = getLangfuseConfig()
  return !!(secretKey && publicKey)
}

async function langfuseApi(path: string, body: Record<string, unknown>): Promise<void> {
  const { secretKey, publicKey, baseUrl } = getLangfuseConfig()
  if (!secretKey || !publicKey) return

  // HTTP-level failures (401 bad keys, 429, 5xx) used to be fully silent:
  // only network throws were logged, so misconfigured keys dropped every
  // event with zero signal. Check res.ok, parse 207 partial-success bodies,
  // and retry once (jittered) on retryable statuses before giving up loudly.
  const auth = btoa(`${publicKey}:${secretKey}`)
  const doPost = () =>
    fetch(`${baseUrl}/api/public${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    })

  let res: Response
  try {
    res = await doPost()
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000))
      res = await doPost()
    }
  } catch (err) {
    traceLog.warn('Langfuse API error', { path, err: String(err) })
    throw err
  }

  if (res.status === 207) {
    // Langfuse ingestion returns 207 with per-event outcomes; surface the
    // failed subset instead of treating the batch as fully delivered.
    const parsed = await res.json().catch(() => null) as { errors?: unknown[] } | null
    if (parsed?.errors && parsed.errors.length > 0) {
      throw new Error(`Langfuse partial ingestion failure: ${JSON.stringify(parsed.errors).slice(0, 300)}`)
    }
    return
  }
  if (!res.ok) {
    const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '')
    throw new Error(`Langfuse HTTP ${res.status}: ${detail}`)
  }
}

type OtlpValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }

interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: { key: string; value: OtlpValue }[]
  status?: { code: number; message?: string }
}

function hexId(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

function otlpValue(value: unknown): OtlpValue {
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  return { stringValue: JSON.stringify(value) ?? '' }
}

function otlpAttributes(
  attrs: Record<string, unknown>,
  metadataPrefix?: string,
  metadata?: Record<string, unknown>,
): { key: string; value: OtlpValue }[] {
  const out: { key: string; value: OtlpValue }[] = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) out.push({ key, value: otlpValue(value) })
  }
  if (metadataPrefix && metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== undefined && value !== null) out.push({ key: `${metadataPrefix}.${key}`, value: otlpValue(value) })
    }
  }
  return out
}

const nanos = (ms: number) => `${BigInt(Math.round(ms)) * 1_000_000n}`

/**
 * Langfuse removed the legacy `/api/public/ingestion` endpoint for traces and
 * observations on 2026-11-16 (HTTP 410; only score events are still taken).
 * Traces and spans now go to its OpenTelemetry endpoint as OTLP/HTTP JSON.
 */
function exportSpans(spans: OtlpSpan[]): Promise<void> {
  return langfuseApi('/otel/v1/traces', {
    resourceSpans: [{
      resource: { attributes: otlpAttributes({ 'service.name': 'mushi-mushi' }) },
      scopeSpans: [{ scope: { name: 'mushi-mushi' }, spans }],
    }],
  })
}

export function createTrace(name: string, metadata?: TraceMetadata): Trace {
  // OTel trace id: 32 lowercase hex chars. Langfuse uses it verbatim as the
  // trace id, so scores and stored `langfuse_trace_id` values still link.
  const traceId = hexId(16)
  const rootSpanId = hexId(8)
  const traceStart = Date.now()
  const safeMetadata = sanitizeTraceMetadata(metadata)

  function rootSpan(endMs: number, extra?: Record<string, unknown>): OtlpSpan {
    return {
      traceId,
      spanId: rootSpanId,
      name,
      kind: 1,
      startTimeUnixNano: nanos(traceStart),
      endTimeUnixNano: nanos(endMs),
      attributes: otlpAttributes(
        { 'langfuse.trace.name': name },
        'langfuse.trace.metadata',
        { ...safeMetadata, ...extra },
      ),
    }
  }

  if (isConfigured()) {
    exportSpans([rootSpan(traceStart)])
      .catch((err) => onLangfuseIngestFailure('trace-create', err))
  }

  function span(spanName: string): Span {
    const spanId = hexId(8)
    const spanStart = Date.now()

    return {
      end(data?: SpanData) {
        const spanEnd = Date.now()
        const duration = spanEnd - spanStart

        if (isConfigured()) {
          const level = data?.error ? 'ERROR' : 'DEFAULT'
          const status = data?.error ? { code: 2, message: data.error } : undefined
          const spans: OtlpSpan[] = [{
            traceId,
            spanId,
            parentSpanId: rootSpanId,
            name: spanName,
            kind: 1,
            startTimeUnixNano: nanos(spanStart),
            endTimeUnixNano: nanos(spanEnd),
            attributes: otlpAttributes(
              {
                'langfuse.observation.type': 'span',
                'langfuse.observation.level': level,
                'langfuse.observation.status_message': data?.error,
              },
              'langfuse.observation.metadata',
              { ...data, durationMs: duration },
            ),
            ...(status ? { status } : {}),
          }]

          if (data?.model) {
            spans.push({
              traceId,
              spanId: hexId(8),
              parentSpanId: spanId,
              name: spanName,
              kind: 1,
              startTimeUnixNano: nanos(spanStart),
              endTimeUnixNano: nanos(spanEnd),
              attributes: otlpAttributes(
                {
                  'langfuse.observation.type': 'generation',
                  'langfuse.observation.level': level,
                  'gen_ai.request.model': data.model,
                  'gen_ai.usage.input_tokens': data.inputTokens,
                  'gen_ai.usage.output_tokens': data.outputTokens,
                },
                'langfuse.observation.metadata',
                { latencyMs: data.latencyMs ?? duration },
              ),
              ...(status ? { status } : {}),
            })
          }

          exportSpans(spans).catch((err) =>
            onLangfuseIngestFailure(`span:${spanName}`, err),
          )
        }

        traceLog.info('Span completed', {
          trace: name,
          span: spanName,
          durationMs: duration,
          ...(data?.model ? { model: data.model } : {}),
          ...(data?.error ? { error: data.error } : {}),
        })
      },
    }
  }

  async function score(scoreName: string, value: number, comment?: string): Promise<void> {
    if (isConfigured()) {
      await langfuseApi('/ingestion', {
        batch: [{
          id: crypto.randomUUID(),
          type: 'score-create',
          timestamp: new Date().toISOString(),
          body: {
            traceId,
            name: scoreName,
            value,
            comment,
          },
        }],
      }).catch((err) => onLangfuseIngestFailure(`score:${scoreName}`, err))
    }
  }

  async function end(): Promise<void> {
    if (isConfigured()) {
      const now = Date.now()
      await exportSpans([rootSpan(now, { completedAt: new Date(now).toISOString() })])
        .catch((err) => onLangfuseIngestFailure('trace-end', err))
    }
  }

  return { id: traceId, span, score, end }
}

/** Attach a score to an existing Langfuse trace (e.g. user feedback on a prior turn). */
export async function scoreExistingTrace(
  traceId: string,
  scoreName: string,
  value: number,
  comment?: string,
): Promise<void> {
  if (!isConfigured()) return
  await langfuseApi('/ingestion', {
    batch: [{
      id: crypto.randomUUID(),
      type: 'score-create',
      timestamp: new Date().toISOString(),
      body: {
        traceId,
        name: scoreName,
        value,
        comment,
      },
    }],
  }).catch((err) => onLangfuseIngestFailure(`score-existing:${scoreName}`, err))
}
