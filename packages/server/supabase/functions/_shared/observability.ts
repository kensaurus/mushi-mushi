/**
 * FILE: packages/server/supabase/functions/_shared/observability.ts
 * PURPOSE: Langfuse traces for every model call, plus scores.
 *
 * Langfuse Cloud shut the legacy `POST /api/public/ingestion` endpoint for
 * traces and observations on 2026-11-16: it answers HTTP 410 to everything
 * but score events (Sentry MUSHI-MUSHI-SERVER-3X, 3Y, 3Z, 45). Traces and
 * observations now go to its OpenTelemetry endpoint as OTLP/HTTP JSON
 * (`/api/public/otel/v1/traces`, Basic auth, `x-langfuse-ingestion-version: 4`),
 * and scores to the scores API (`/api/public/scores`).
 *
 * The v4 rules this follows (Langfuse "Migrate custom ingestion to v4",
 * read 2026-11-21):
 *   - each operation is ONE complete span, exported once. Re-exporting a span
 *     id to update it can leave the earlier, incomplete copy in place, so the
 *     trace's root span is exported only in `end()`, never at start as well;
 *   - trace name and trace metadata (`langfuse.trace.*`) are copied onto every
 *     span, so each observation can be filtered by them and a span still
 *     carries its trace's name when `end()` never runs;
 *   - structured values (usage) are JSON strings.
 * The trace id is 32 lowercase hex characters, the OTel form; Langfuse uses
 * it verbatim as its trace id, so stored `langfuse_trace_id` values (text
 * columns) and later scores still find the trace.
 */
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

/**
 * POST to the Langfuse public API. HTTP failures (401 bad keys, 410, 429, 5xx)
 * are never silent: a non-2xx throws with the status and a slice of the body,
 * after one jittered retry on 429/5xx. `checkBody` inspects a 2xx answer.
 */
async function langfusePost(
  path: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
  checkBody?: (parsed: unknown) => void,
): Promise<void> {
  const { secretKey, publicKey, baseUrl } = getLangfuseConfig()
  if (!secretKey || !publicKey) return

  const auth = btoa(`${publicKey}:${secretKey}`)
  const doPost = () =>
    fetch(`${baseUrl.replace(/\/+$/, '')}/api/public${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        ...extraHeaders,
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
  if (checkBody) checkBody(await res.json().catch(() => null))
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

/** `bytes` random bytes as lowercase hex (16 → an OTel trace id, 8 → a span id). */
function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** OTLP/HTTP answers 200 with `partialSuccess.rejectedSpans` when it drops some spans. */
function checkOtlpPartialSuccess(parsed: unknown): void {
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

function exportSpans(spans: OtlpSpan[]): Promise<void> {
  return langfusePost(
    '/otel/v1/traces',
    {
      resourceSpans: [{
        resource: { attributes: attrs({ 'service.name': 'mushi-mushi-edge' }) },
        scopeSpans: [{ scope: { name: 'mushi-mushi' }, spans }],
      }],
    },
    { 'x-langfuse-ingestion-version': '4' },
    checkOtlpPartialSuccess,
  )
}

function postScore(traceId: string, name: string, value: number, comment?: string): Promise<void> {
  return langfusePost('/scores', { traceId, name, value, ...(comment ? { comment } : {}) })
}

const SPAN_KIND_INTERNAL = 1
const STATUS_UNSET = 0
const STATUS_ERROR = 2

export function createTrace(name: string, metadata?: TraceMetadata): Trace {
  const traceId = randomHex(16)
  const rootSpanId = randomHex(8)
  const startMs = Date.now()
  const safeMetadata = sanitizeTraceMetadata(metadata)
  // Copied onto every span (v4 filters observations, not traces).
  const traceAttrs = {
    'langfuse.trace.name': name,
    ...prefixed('langfuse.trace.metadata', safeMetadata),
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
          // Spans sit directly under the trace, as they did with the ingestion
          // API (so they still show when `end()` never sends the root); the
          // model call is a generation under its span.
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

          exportSpans(spans).catch((err) => onLangfuseIngestFailure(`span:${spanName}`, err))
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

  let ended = false
  /** Sends the trace's root span, once: the whole run, with the trace's name and metadata. */
  async function end(): Promise<void> {
    if (ended || !isConfigured()) return
    ended = true
    const endMs = Date.now()
    const completedAt = new Date(endMs).toISOString()
    await exportSpans([{
      traceId,
      spanId: rootSpanId,
      name,
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: toNanos(startMs),
      endTimeUnixNano: toNanos(endMs),
      attributes: attrs({
        ...traceAttrs,
        'langfuse.trace.metadata.completedAt': completedAt,
        'langfuse.observation.type': 'span',
        ...prefixed('langfuse.observation.metadata', { ...safeMetadata, completedAt }),
      }),
      status: { code: STATUS_UNSET },
    }]).catch((err) => onLangfuseIngestFailure('trace-end', err))
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
