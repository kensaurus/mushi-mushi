/**
 * FILE: packages/server/supabase/functions/_shared/otlp-exporter.ts
 * PURPOSE: Lightweight OTLP/HTTP+JSON span exporter for Deno Edge Functions.
 *
 * BACKGROUND:
 *   Mushi is a middleware aggregator. When `OTEL_EXPORTER_OTLP_ENDPOINT` is
 *   set, Mushi should forward a span record for each significant operation
 *   (report ingest, classification, fix dispatch) to the user's own OTEL
 *   collector (Jaeger, Zipkin, Grafana Tempo, Honeycomb, Datadog Agent, etc.)
 *   using the BYOK model — we never hard-code a destination.
 *
 *   We do NOT use `@opentelemetry/sdk-node` here because:
 *     1. It cannot run in Deno / Edge Workers.
 *     2. Its gzipped bundle adds ~800 KB to cold-start time.
 *     3. We only need the minimal OTLP/HTTP+JSON shape documented in
 *        https://opentelemetry.io/docs/specs/otlp/#otlphttp-request
 *
 * ACTIVATION:
 *   Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your collector's base URL, e.g.:
 *     OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.us0.signalfx.com
 *   Spans are POSTed to `{endpoint}/v1/traces` (OTLP/HTTP+JSON format).
 *
 *   Optional headers (for auth):
 *     OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>,x-sf-token=<tok>
 *
 * USAGE:
 *   import { otlpSpan } from '../_shared/otlp-exporter.ts'
 *
 *   const span = otlpSpan('classify-report', traceparent, {
 *     'report.id': reportId,
 *     'project.id': projectId,
 *   })
 *   try {
 *     // ... do work ...
 *     span.setStatus('ok')
 *   } catch (e) {
 *     span.setStatus('error', String(e))
 *     throw e
 *   } finally {
 *     await span.end()
 *   }
 */

import { parseTraceparent, childTraceparent, newTraceparent } from './trace.ts'

// ---------------------------------------------------------------------------
// Types — minimal OTLP/HTTP+JSON proto-JSON shapes
// (https://opentelemetry.io/docs/specs/otlp/#request-response)
// ---------------------------------------------------------------------------

interface OtlpKeyValue {
  key: string
  value: { stringValue?: string; intValue?: string; boolValue?: boolean; doubleValue?: number }
}

interface OtlpSpanRecord {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number          // SpanKind: 1=INTERNAL, 2=SERVER, 3=CLIENT
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpKeyValue[]
  status: { code: number; message?: string }  // 0=UNSET 1=OK 2=ERROR
}

interface OtlpExportRequest {
  resourceSpans: Array<{
    resource: { attributes: OtlpKeyValue[] }
    scopeSpans: Array<{
      scope: { name: string; version: string }
      spans: OtlpSpanRecord[]
    }>
  }>
}

// ---------------------------------------------------------------------------
// Builder — SpanBuilder returned from otlpSpan()
// ---------------------------------------------------------------------------

export interface SpanBuilder {
  /** Override the span name (e.g. if computed lazily). */
  setName(name: string): void
  /** Add or overwrite an attribute. */
  setAttribute(key: string, value: string | number | boolean): void
  /** Mark as OK or ERROR. Call before end(). */
  setStatus(code: 'ok' | 'error' | 'unset', message?: string): void
  /** Finish the span. Fire-and-forget flush; never throws. */
  end(): Promise<void>
  /** The child traceparent to propagate to downstream calls. */
  readonly traceparent: string
}

function toNano(ms: number): string {
  return String(BigInt(Math.round(ms)) * BigInt(1_000_000))
}

function toKv(key: string, value: string | number | boolean): OtlpKeyValue {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } }
  }
  return { key, value: { stringValue: String(value) } }
}

function parseOtlpHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=')
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  }
  return out
}

/**
 * Create an OTLP span builder for a named operation.
 *
 * @param name        Span name, e.g. `"classify-report"`.
 * @param parent      Inbound W3C traceparent (or null/undefined for a root span).
 * @param attributes  Initial key/value attributes to attach.
 */
export function otlpSpan(
  name: string,
  parent: string | null | undefined,
  attributes: Record<string, string | number | boolean> = {},
): SpanBuilder {
  const endpoint = Deno.env.get('OTEL_EXPORTER_OTLP_ENDPOINT')
  const startMs = Date.now()

  // The child traceparent for this span to propagate downstream.
  const spanTraceparent = childTraceparent(parent)
  const parts = parseTraceparent(spanTraceparent)!

  let spanName = name
  let statusCode: 0 | 1 | 2 = 0 // UNSET
  let statusMessage: string | undefined
  const attrs: Record<string, string | number | boolean> = { ...attributes }

  const builder: SpanBuilder = {
    get traceparent() { return spanTraceparent },

    setName(n: string) { spanName = n },

    setAttribute(key: string, value: string | number | boolean) {
      attrs[key] = value
    },

    setStatus(code: 'ok' | 'error' | 'unset', message?: string) {
      statusCode = code === 'ok' ? 1 : code === 'error' ? 2 : 0
      statusMessage = message
    },

    async end(): Promise<void> {
      if (!endpoint) return  // OTLP not configured — no-op

      const endMs = Date.now()
      const inboundParts = parent ? parseTraceparent(parent) : null
      const spanRecord: OtlpSpanRecord = {
        traceId: parts.traceId,
        spanId: parts.spanId,
        ...(inboundParts ? { parentSpanId: inboundParts.spanId } : {}),
        name: spanName,
        kind: 1,  // INTERNAL
        startTimeUnixNano: toNano(startMs),
        endTimeUnixNano: toNano(endMs),
        attributes: [
          toKv('service.name', 'mushi-mushi-server'),
          ...Object.entries(attrs).map(([k, v]) => toKv(k, v)),
        ],
        status: {
          code: statusCode,
          ...(statusMessage ? { message: statusMessage } : {}),
        },
      }

      const payload: OtlpExportRequest = {
        resourceSpans: [{
          resource: {
            attributes: [
              toKv('service.name', 'mushi-mushi-server'),
              toKv('telemetry.sdk.name', 'mushi-otlp-exporter'),
              toKv('telemetry.sdk.version', '1.0.0'),
            ],
          },
          scopeSpans: [{
            scope: { name: 'mushi-mushi', version: '1.0.0' },
            spans: [spanRecord],
          }],
        }],
      }

      try {
        const rawHeaders = Deno.env.get('OTEL_EXPORTER_OTLP_HEADERS') ?? ''
        const extraHeaders = rawHeaders ? parseOtlpHeaders(rawHeaders) : {}
        await fetch(`${endpoint.replace(/\/$/, '')}/v1/traces`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...extraHeaders,
          },
          body: JSON.stringify(payload),
          // 5-second budget; tracing should never slow the critical path
          signal: AbortSignal.timeout(5_000),
        })
      } catch {
        // Exporter errors are silently swallowed — tracing infra must never
        // crash or slow the host operation.
      }
    },
  }

  return builder
}

/**
 * Convenience: wrap an async operation in an OTLP span, auto-setting status.
 *
 * Returns the value of `fn()` unchanged. Always flushes the span (even on
 * throw) via `finally`.
 */
export async function withOtlpSpan<T>(
  name: string,
  parent: string | null | undefined,
  attributes: Record<string, string | number | boolean>,
  fn: (span: SpanBuilder) => Promise<T>,
): Promise<T> {
  const span = otlpSpan(name, parent, attributes)
  try {
    const result = await fn(span)
    if (span.traceparent) span.setStatus('ok')
    return result
  } catch (err) {
    span.setStatus('error', err instanceof Error ? err.message : String(err))
    throw err
  } finally {
    await span.end()
  }
}
