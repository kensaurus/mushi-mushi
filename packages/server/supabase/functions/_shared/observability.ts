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

// Langfuse retired the legacy batch endpoint `/api/public/ingestion` (it
// answers HTTP 410 with a deprecation message, Mushi report dbd9f3c0).
// Traces, spans and generations now go to its OpenTelemetry endpoint as
// OTLP/HTTP JSON; scores go to the public scores API.
async function langfuseApi(path: string, body: Record<string, unknown>): Promise<void> {
  const { secretKey, publicKey, baseUrl } = getLangfuseConfig()
  if (!secretKey || !publicKey) return

  // HTTP-level failures (401 bad keys, 429, 5xx) used to be fully silent:
  // only network throws were logged, so misconfigured keys dropped every
  // event with zero signal. Check res.ok and retry once (jittered) on
  // retryable statuses before giving up loudly.
  const auth = btoa(`${publicKey}:${secretKey}`)
  const doPost = () =>
    fetch(`${baseUrl.replace(/\/$/, '')}/api/public${path}`, {
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

  if (!res.ok) {
    const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '')
    throw new Error(`Langfuse HTTP ${res.status}: ${detail}`)
  }
}

export const LANGFUSE_OTEL_PATH = '/otel/v1/traces'
export const LANGFUSE_SCORES_PATH = '/scores'

type OtlpValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
interface OtlpAttribute { key: string; value: OtlpValue }

function otlpValue(value: unknown): OtlpValue {
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  if (typeof value === 'string') return { stringValue: value }
  return { stringValue: JSON.stringify(value) ?? '' }
}

function pushAttr(attrs: OtlpAttribute[], key: string, value: unknown): void {
  if (value === undefined || value === null) return
  attrs.push({ key, value: otlpValue(value) })
}

function pushMetadata(attrs: OtlpAttribute[], prefix: string, metadata?: Record<string, unknown>): void {
  if (!metadata) return
  for (const [k, v] of Object.entries(metadata)) pushAttr(attrs, `${prefix}.${k}`, v)
}

function hexId(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

function unixNano(ms: number): string {
  return `${BigInt(Math.round(ms)) * 1_000_000n}`
}

export interface OtlpSpanInput {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startMs: number
  endMs: number
  traceName: string
  traceMetadata?: TraceMetadata
  data?: SpanData
}

/** One OTLP/HTTP JSON export request that Langfuse maps to a trace + observation. */
export function buildOtlpSpanPayload(input: OtlpSpanInput): Record<string, unknown> {
  const attrs: OtlpAttribute[] = []
  pushAttr(attrs, 'langfuse.trace.name', input.traceName)
  pushMetadata(attrs, 'langfuse.trace.metadata', input.traceMetadata)
  const data = input.data
  if (data) {
    const { model, inputTokens, outputTokens, error, ...rest } = data
    pushMetadata(attrs, 'langfuse.observation.metadata', {
      ...rest,
      durationMs: input.endMs - input.startMs,
    })
    if (model) {
      pushAttr(attrs, 'langfuse.observation.type', 'generation')
      pushAttr(attrs, 'gen_ai.request.model', model)
      pushAttr(attrs, 'gen_ai.usage.input_tokens', inputTokens)
      pushAttr(attrs, 'gen_ai.usage.output_tokens', outputTokens)
    }
    if (error) {
      pushAttr(attrs, 'langfuse.observation.level', 'ERROR')
      pushAttr(attrs, 'langfuse.observation.status_message', error)
    }
  }
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'mushi-mushi-edge' } }] },
      scopeSpans: [{
        scope: { name: 'mushi-mushi/observability' },
        spans: [{
          traceId: input.traceId,
          spanId: input.spanId,
          ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
          name: input.name,
          kind: 1,
          startTimeUnixNano: unixNano(input.startMs),
          endTimeUnixNano: unixNano(input.endMs),
          attributes: attrs,
          status: data?.error ? { code: 2, message: data.error } : { code: 1 },
        }],
      }],
    }],
  }
}

function postScore(traceId: string, scoreName: string, value: number, comment?: string): Promise<void> {
  return langfuseApi(LANGFUSE_SCORES_PATH, {
    id: crypto.randomUUID(),
    traceId,
    name: scoreName,
    value,
    ...(comment !== undefined ? { comment } : {}),
  })
}

export function createTrace(name: string, metadata?: TraceMetadata): Trace {
  // OTel trace ids are 32 hex characters; Langfuse keeps that string as the
  // trace id, so scores and stored `langfuse_trace_id` links use `trace.id`.
  const traceId = hexId(16)
  const rootSpanId = hexId(8)
  const traceStart = Date.now()
  const safeMetadata = sanitizeTraceMetadata(metadata)

  function span(spanName: string): Span {
    const spanId = hexId(8)
    const spanStart = Date.now()

    return {
      end(data?: SpanData) {
        const spanEnd = Date.now()
        const duration = spanEnd - spanStart

        if (isConfigured()) {
          langfuseApi(LANGFUSE_OTEL_PATH, buildOtlpSpanPayload({
            traceId,
            spanId,
            parentSpanId: rootSpanId,
            name: spanName,
            startMs: spanStart,
            endMs: spanEnd,
            traceName: name,
            traceMetadata: safeMetadata,
            data,
          })).catch((err) => onLangfuseIngestFailure(`span:${spanName}`, err))
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
      await postScore(traceId, scoreName, value, comment)
        .catch((err) => onLangfuseIngestFailure(`score:${scoreName}`, err))
    }
  }

  async function end(): Promise<void> {
    if (isConfigured()) {
      await langfuseApi(LANGFUSE_OTEL_PATH, buildOtlpSpanPayload({
        traceId,
        spanId: rootSpanId,
        name,
        startMs: traceStart,
        endMs: Date.now(),
        traceName: name,
        traceMetadata: { ...safeMetadata, completedAt: new Date().toISOString() },
      })).catch((err) => onLangfuseIngestFailure('trace-end', err))
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
  await postScore(traceId, scoreName, value, comment)
    .catch((err) => onLangfuseIngestFailure(`score-existing:${scoreName}`, err))
}
