/**
 * FILE: packages/node/src/otel.ts
 * PURPOSE: Lightweight OpenTelemetry SpanProcessor bridge that forwards
 *          error spans to Mushi as server-originated reports.
 *
 * `@opentelemetry/api` is an optional peer dependency. If it is not
 * installed this factory resolves to a no-op processor and emits a
 * one-time console.warn. All OTel API calls are wrapped in try/catch so
 * a misconfigured OTel pipeline can never crash the host service.
 *
 * Usage:
 *   import { createOtelSpanProcessor } from '@mushi-mushi/node'
 *   const provider = new NodeTracerProvider()
 *   provider.addSpanProcessor(await createOtelSpanProcessor(mushiClient))
 */

import { createRequire } from 'node:module'
import type { MushiNodeClient } from './client'

/** Minimal subset of @opentelemetry/api types we depend on. */
interface OtelSpan {
  status: { code: number }
  attributes: Record<string, unknown>
  name: string
}

export interface OtelSpanProcessor {
  onStart(span: OtelSpan, parentContext: unknown): void
  onEnd(span: OtelSpan): void
  shutdown(): Promise<void>
  forceFlush(): Promise<void>
}

// SpanStatusCode.ERROR from @opentelemetry/api is 2.
const SPAN_STATUS_ERROR = 2

let otelWarnedMissing = false

/**
 * Creates an OpenTelemetry `SpanProcessor` that sends error spans to Mushi.
 *
 * Only spans where `span.status.code === SpanStatusCode.ERROR` generate a
 * Mushi report. All other spans are ignored, keeping the happy-path
 * overhead near zero.
 *
 * Returns a `Promise` so the peer-dep check can be async-friendly. Call
 * this once during app startup:
 *
 *   const processor = await createOtelSpanProcessor(mushiClient)
 *   provider.addSpanProcessor(processor)
 */
export async function createOtelSpanProcessor(
  mushiClient: MushiNodeClient,
): Promise<OtelSpanProcessor> {
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
        if (span.status.code !== SPAN_STATUS_ERROR) return

        const message =
          (span.attributes['exception.message'] as string | undefined) ??
          (span.attributes['error.message'] as string | undefined) ??
          `OTel error span: ${span.name}`

        void mushiClient.captureException(message, {
          component: `otel:${span.name}`,
          metadata: {
            otelSpanName: span.name,
            otelAttributes: span.attributes,
          },
        })
      } catch {
        // Never let the span processor crash the host service.
      }
    },
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  }
}
