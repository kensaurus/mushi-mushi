/**
 * FILE: packages/node/src/otel.ts
 * PURPOSE: Lightweight OpenTelemetry SpanProcessor bridge that forwards
 *          error spans (and optionally all spans) to Mushi as server-originated
 *          reports, and forwards span data to a BYOK OTLP endpoint.
 *
 * `@opentelemetry/api` is an optional peer dependency. If it is not
 * installed this factory resolves to a no-op processor and emits a
 * one-time console.warn. All OTel API calls are wrapped in try/catch so
 * a misconfigured OTel pipeline can never crash the host service.
 *
 * Usage:
 *   import { createOtelSpanProcessor } from '@mushi-mushi/node'
 *   const provider = new NodeTracerProvider()
 *   provider.addSpanProcessor(await createOtelSpanProcessor(mushiClient, {
 *     // Forward only errors (default). Set to false to forward all spans.
 *     errorsOnly: true,
 *     // OTLP endpoint for BYOK span export (optional, overrides env var).
 *     otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
 *   }))
 */

import { createRequire } from 'node:module'
import type { MushiNodeClient } from './client'

/** Minimal subset of @opentelemetry/api types we depend on. */
interface OtelSpan {
  status: { code: number }
  attributes: Record<string, unknown>
  name: string
  spanContext(): { traceId: string; spanId: string }
  parentSpanId?: string
  startTime: [number, number]  // [seconds, nanoseconds] HrTime
  endTime: [number, number]
}

export interface OtelSpanProcessor {
  onStart(span: OtelSpan, parentContext: unknown): void
  onEnd(span: OtelSpan): void
  shutdown(): Promise<void>
  forceFlush(): Promise<void>
}

export interface OtelSpanProcessorOptions {
  /**
   * When `true` (default), only ERROR spans trigger a Mushi report.
   * Set to `false` to also capture WARNING/slow spans (higher volume).
   */
  errorsOnly?: boolean
  /**
   * OTLP/HTTP+JSON endpoint to forward spans to. When set, all sampled
   * spans (not just errors) are exported in OTLP format so your APM backend
   * sees Mushi's internal spans alongside your application spans.
   *
   * Defaults to `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable.
   */
  otlpEndpoint?: string
  /**
   * Additional HTTP headers for the OTLP exporter (e.g. auth tokens).
   * Format: `"Authorization=Bearer <token>,x-custom=val"` or an object.
   * Defaults to `OTEL_EXPORTER_OTLP_HEADERS` environment variable.
   */
  otlpHeaders?: string | Record<string, string>
}

// SpanStatusCode.ERROR from @opentelemetry/api is 2.
const SPAN_STATUS_ERROR = 2

let otelWarnedMissing = false

function hrTimeToMs(ht: [number, number]): number {
  return ht[0] * 1000 + ht[1] / 1_000_000
}

function toNano(ms: number): string {
  return String(BigInt(Math.round(ms)) * BigInt(1_000_000))
}

function buildOtlpPayload(span: OtelSpan) {
  const ctx = span.spanContext()
  const attrs = Object.entries(span.attributes).map(([key, value]) => ({
    key,
    value: typeof value === 'boolean'
      ? { boolValue: value }
      : typeof value === 'number'
        ? Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
        : { stringValue: String(value ?? '') },
  }))

  return {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: process.env.OTEL_SERVICE_NAME ?? 'node-service' } },
          { key: 'telemetry.sdk.name', value: { stringValue: 'mushi-mushi-node' } },
        ],
      },
      scopeSpans: [{
        scope: { name: '@mushi-mushi/node', version: '1.0.0' },
        spans: [{
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
          name: span.name,
          kind: 2, // SERVER
          startTimeUnixNano: toNano(hrTimeToMs(span.startTime)),
          endTimeUnixNano: toNano(hrTimeToMs(span.endTime)),
          attributes: attrs,
          status: {
            code: span.status.code === SPAN_STATUS_ERROR ? 2 : 1,
          },
        }],
      }],
    }],
  }
}

/**
 * Creates an OpenTelemetry `SpanProcessor` that:
 *   1. Sends ERROR spans to Mushi as server-originated reports (default).
 *   2. Optionally forwards all sampled spans to a BYOK OTLP collector.
 */
export async function createOtelSpanProcessor(
  mushiClient: MushiNodeClient,
  options: OtelSpanProcessorOptions = {},
): Promise<OtelSpanProcessor> {
  const { errorsOnly = true } = options

  const otlpEndpoint = (
    options.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? ''
  ).replace(/\/$/, '')

  const otlpHeaders: Record<string, string> = (() => {
    if (!options.otlpHeaders) {
      const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS ?? ''
      const out: Record<string, string> = {}
      for (const pair of raw.split(',')) {
        const idx = pair.indexOf('=')
        if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
      }
      return out
    }
    if (typeof options.otlpHeaders === 'string') {
      const out: Record<string, string> = {}
      for (const pair of options.otlpHeaders.split(',')) {
        const idx = pair.indexOf('=')
        if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
      }
      return out
    }
    return options.otlpHeaders
  })()

  const noOp: OtelSpanProcessor = {
    onStart: () => {},
    onEnd: () => {},
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  }

  // Probe whether @opentelemetry/api is resolvable without crashing. We use
  // createRequire so this works in both CJS and ESM (tsup compiles both).
  try {
    const req = createRequire(import.meta.url)
    req.resolve('@opentelemetry/api')
  } catch {
    if (!otelWarnedMissing) {
      otelWarnedMissing = true
      console.warn(
        '[mushi-mushi/node] createOtelSpanProcessor: @opentelemetry/api is not installed. ' +
          'Add it as a dependency to enable OTel span → Mushi error forwarding. ' +
          'A no-op SpanProcessor has been returned.',
      )
    }
    return noOp
  }

  return {
    onStart: () => {},
    onEnd(span: OtelSpan): void {
      try {
        const isError = span.status.code === SPAN_STATUS_ERROR

        // 1. Forward errors to Mushi as reports.
        if (isError || !errorsOnly) {
          if (isError) {
            const message =
              (span.attributes['exception.message'] as string | undefined) ??
              (span.attributes['error.message'] as string | undefined) ??
              `OTel error span: ${span.name}`

            // Build traceparent from span context so the Mushi report is
            // correlated to the same trace.
            const ctx = span.spanContext()
            const traceParent = `00-${ctx.traceId}-${ctx.spanId}-01`

            void mushiClient.captureException(message, {
              component: `otel:${span.name}`,
              metadata: {
                otelSpanName: span.name,
                otelAttributes: span.attributes,
                traceparent: traceParent,
              },
            })
          }
        }

        // 2. OTLP export: forward all spans to user's own collector.
        if (otlpEndpoint) {
          const payload = buildOtlpPayload(span)
          void fetch(`${otlpEndpoint}/v1/traces`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...otlpHeaders,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5_000),
          }).catch(() => {
            // Fire-and-forget; ignore export errors.
          })
        }
      } catch {
        // Never let the span processor crash the host service.
      }
    },
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  }
}
