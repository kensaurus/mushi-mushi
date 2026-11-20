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

// Langfuse retired the batch `/api/public/ingestion` endpoint (HTTP 410).
// Traces and observations go through its OpenTelemetry endpoint
// (`/api/public/otel/v1/traces`, OTLP/HTTP JSON); scores go through
// `/api/public/scores`.
async function langfusePost(
  path: string,
  body: Record<string, unknown>,
  checkBody?: (parsed: unknown) => void,
): Promise<void> {
  const { secretKey, publicKey, baseUrl } = getLangfuseConfig()
  if (!secretKey || !publicKey) return

  // HTTP-level failures (401 bad keys, 410, 429, 5xx) must not be silent:
  // check res.ok, inspect partial-success bodies, and retry once (jittered)
  // on retryable statuses before giving up loudly.
  const auth = btoa(`${publicKey}:${secretKey}`)
  const doPost = () =>
    fetch(`${baseUrl.replace(/\/+$/, '')}/api/public${path}`, {
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
  if (checkBody) {
    const parsed: unknown = await res.json().catch(() => null)
    checkBody(parsed)
  }
}

type OtlpValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }

interface OtlpAttribute {
  key: string
  value: OtlpValue
}

interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpAttribute[]
  status: { code: number; message?: string }
}

function otlpValue(value: unknown): OtlpValue | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  try {
    return { stringValue: JSON.stringify(value) }
  } catch {
    return { stringValue: String(value) }
  }
}

function attrs(entries: Record<string, unknown>): OtlpAttribute[] {
  const out: OtlpAttribute[] = []
  for (const [key, raw] of Object.entries(entries)) {
    const value = otlpValue(raw)
    if (value) out.push({ key, value })
  }
  return out
}

function prefixed(prefix: string, record?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!record) return out
  for (const [key, value] of Object.entries(record)) out[`${prefix}.${key}`] = value
  return out
}

function toNanos(ms: number): string {
  return (BigInt(Math.trunc(ms)) * 1_000_000n).toString()
}

function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** OTLP/HTTP answers 200 with `partialSuccess.rejectedSpans` when it drops some spans. */
export function checkOtlpPartialSuccess(parsed: unknown): void {
  const partial = (parsed as {
    partialSuccess?: { rejectedSpans?: number | string; errorMessage?: string }
  } | null)?.partialSuccess
  const rejected = Number(partial?.rejectedSpans ?? 0)
  if (rejected > 0) {
    throw new Error(
      `Langfuse partial ingestion failure: ${rejected} span(s) rejected: ${String(partial?.errorMessage ?? '').slice(0, 300)}`,
    )
  }
}

async function exportSpans(spans: OtlpSpan[]): Promise<void> {
  await langfusePost(
    '/otel/v1/traces',
    {
      resourceSpans: [{
        resource: { attributes: attrs({ 'service.name': 'mushi-mushi-edge' }) },
        scopeSpans: [{ scope: { name: 'mushi-mushi' }, spans }],
      }],
    },
    checkOtlpPartialSuccess,
  )
}

async function postScore(traceId: string, name: string, value: number, comment?: string): Promise<void> {
  await langfusePost('/scores', { traceId, name, value, comment })
}

const SPAN_KIND_INTERNAL = 1
const STATUS_UNSET = 0
const STATUS_ERROR = 2

export function createTrace(name: string, metadata?: TraceMetadata): Trace {
  // OTLP trace ids are 32 hex chars; Langfuse uses them as its trace id.
  const traceId = randomHex(16)
  const rootSpanId = randomHex(8)
  const startMs = Date.now()
  const safeMetadata = sanitizeTraceMetadata(metadata)
  const traceAttrs = {
    'langfuse.trace.name': name,
    ...prefixed('langfuse.trace.metadata', safeMetadata),
  }

  // The root observation carries the trace's name and metadata. It is sent
  // as soon as the trace starts, so an operation that throws or exits before
  // any span ends or `end()` runs still shows up in Langfuse; `end()` sends
  // the same span id again with the real end time.
  function rootSpan(
    endMs: number,
    extra: Record<string, unknown>,
    traceExtra?: Record<string, unknown>,
  ): OtlpSpan {
    return {
      traceId,
      spanId: rootSpanId,
      name,
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: toNanos(startMs),
      endTimeUnixNano: toNanos(endMs),
      attributes: attrs({
        ...traceAttrs,
        ...prefixed('langfuse.trace.metadata', traceExtra),
        'langfuse.observation.type': 'span',
        ...prefixed('langfuse.observation.metadata', { ...safeMetadata, ...extra }),
      }),
      status: { code: STATUS_UNSET },
    }
  }

  // The completion export waits for this one to settle (including its
  // retry), so a slow start export can never land after `end()` and
  // overwrite the completed root span with its zero-length 'started' copy.
  let rootStartExport: Promise<void> = Promise.resolve()
  if (isConfigured()) {
    rootStartExport = exportSpans([rootSpan(startMs, { state: 'started' })])
      .catch((err) => onLangfuseIngestFailure('trace-create', err))
  }

  function span(spanName: string): Span {
    const spanId = randomHex(8)
    const spanStart = Date.now()

    return {
      end(data?: SpanData) {
        const spanEnd = Date.now()
        const duration = spanEnd - spanStart

        if (isConfigured()) {
          const status = data?.error
            ? { code: STATUS_ERROR, message: data.error }
            : { code: STATUS_UNSET }
          const level = data?.error ? 'ERROR' : 'DEFAULT'
          // Spans sit directly under the trace (no parent), as they did with
          // the ingestion API; the model call is a generation under its span.
          const spans: OtlpSpan[] = [{
            traceId,
            spanId,
            name: spanName,
            kind: SPAN_KIND_INTERNAL,
            startTimeUnixNano: toNanos(spanStart),
            endTimeUnixNano: toNanos(spanEnd),
            attributes: attrs({
              ...traceAttrs,
              'langfuse.observation.type': 'span',
              'langfuse.observation.level': level,
              'langfuse.observation.status_message': data?.error,
              ...prefixed('langfuse.observation.metadata', { ...data, durationMs: duration }),
            }),
            status,
          }]

          if (data?.model) {
            spans.push({
              traceId,
              spanId: randomHex(8),
              parentSpanId: spanId,
              name: spanName,
              kind: SPAN_KIND_INTERNAL,
              startTimeUnixNano: toNanos(spanStart),
              endTimeUnixNano: toNanos(spanEnd),
              attributes: attrs({
                ...traceAttrs,
                'langfuse.observation.type': 'generation',
                'langfuse.observation.model.name': data.model,
                'gen_ai.request.model': data.model,
                'gen_ai.usage.input_tokens': data.inputTokens,
                'gen_ai.usage.output_tokens': data.outputTokens,
                'langfuse.observation.usage_details': {
                  input: data.inputTokens,
                  output: data.outputTokens,
                },
                'langfuse.observation.level': level,
                'langfuse.observation.status_message': data.error,
                'langfuse.observation.metadata.latencyMs': data.latencyMs ?? duration,
              }),
              status,
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
      await postScore(traceId, scoreName, value, comment)
        .catch((err) => onLangfuseIngestFailure(`score:${scoreName}`, err))
    }
  }

  async function end(): Promise<void> {
    if (isConfigured()) {
      const endMs = Date.now()
      const completedAt = new Date(endMs).toISOString()
      await rootStartExport
      await exportSpans([rootSpan(endMs, { state: 'completed', completedAt }, { completedAt })])
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
  await postScore(traceId, scoreName, value, comment)
    .catch((err) => onLangfuseIngestFailure(`score-existing:${scoreName}`, err))
}
