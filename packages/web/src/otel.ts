// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/web/src/otel.ts
 * PURPOSE: Optional OpenTelemetry SpanProcessor bridge for the browser SDK.
 *
 * Forwards error spans from the browser OTel pipeline to Mushi as reports.
 * Bundled in its own subpath (`@mushi-mushi/web/otel`) so applications that
 * don't use OTel pay **zero bytes** — this entry is never included in the main
 * `@mushi-mushi/web` bundle.
 *
 * `@opentelemetry/api` is an OPTIONAL peer dependency. The caller imports it
 * and passes the `context` module handle (or any truthy sentinel) to signal
 * OTel is present. This avoids a dynamic-import probe that breaks Vite's
 * static analysis and means bundlers tree-shake the entire module when OTel
 * is absent.
 *
 * Usage (TypeScript):
 *
 * ```ts
 * import { createBrowserOtelSpanProcessor } from '@mushi-mushi/web/otel'
 * import { context } from '@opentelemetry/api'  // your own dep
 * import { Mushi } from '@mushi-mushi/web'
 *
 * const mushi = new Mushi({ projectId: '…', apiKey: '…' })
 * const processor = createBrowserOtelSpanProcessor(mushi, { otelPresent: context })
 * provider.addSpanProcessor(processor)
 * ```
 *
 * Without `otelPresent` (or with `otelPresent: null`) the factory returns a
 * no-op processor and emits a one-time `console.warn`.
 */

import type { MushiSDKInstance } from '@mushi-mushi/core'

// ── Minimal OTel type surface ─────────────────────────────────────────────────
// We only use the structural types — the real @opentelemetry/api package is
// never imported here. Callers bring their own import.

export interface BrowserOtelSpan {
  /** SpanStatusCode: UNSET=0, OK=1, ERROR=2 */
  status: { code: number }
  attributes: Record<string, unknown>
  name: string
  spanContext(): { traceId: string; spanId: string }
  startTime: [number, number]  // HrTime: [seconds, nanoseconds]
  endTime: [number, number]
}

export interface BrowserOtelSpanProcessor {
  onStart(span: BrowserOtelSpan, parentContext: unknown): void
  onEnd(span: BrowserOtelSpan): void
  shutdown(): Promise<void>
  forceFlush(): Promise<void>
}

export interface BrowserOtelSpanProcessorOptions {
  /**
   * Pass any truthy value from your `@opentelemetry/api` import to signal the
   * package is present. Typically `import { context } from '@opentelemetry/api'`.
   *
   * When absent or `null/undefined`, a no-op processor is returned.
   *
   * @example
   *   import { context } from '@opentelemetry/api'
   *   createBrowserOtelSpanProcessor(mushi, { otelPresent: context })
   */
  otelPresent?: unknown
  /**
   * When `true` (default), only ERROR spans (status.code === 2) trigger a
   * Mushi report. Set to `false` to call `report()` for every finished span.
   */
  errorsOnly?: boolean
}

// SpanStatusCode.ERROR is 2 — inlined so we never import the real package.
const SPAN_STATUS_ERROR = 2

let warnedMissing = false

/**
 * Create a SpanProcessor that forwards browser OTel error spans to Mushi.
 *
 * The processor is synchronous. `mushi.report()` is called fire-and-forget
 * (`void`) so it never blocks the OTel pipeline's `onEnd` call path.
 */
export function createBrowserOtelSpanProcessor(
  mushi: MushiSDKInstance,
  options: BrowserOtelSpanProcessorOptions = {},
): BrowserOtelSpanProcessor {
  const errorsOnly = options.errorsOnly ?? true

  const noOp: BrowserOtelSpanProcessor = {
    // mushi-mushi-allowlist: OTel SpanProcessor requires onStart/onEnd; this no-op processor intentionally does nothing
    onStart: () => {},
    // mushi-mushi-allowlist: no-op processor — nothing to forward
    onEnd: () => {},
    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  }

  if (!options.otelPresent) {
    if (!warnedMissing) {
      warnedMissing = true
      console.warn(
        '[mushi-mushi/web] createBrowserOtelSpanProcessor: `otelPresent` was not provided. ' +
          'Pass a value from your @opentelemetry/api import (e.g. `{ otelPresent: context }`) ' +
          'to enable OTel span → Mushi error forwarding. ' +
          'A no-op SpanProcessor has been returned.',
      )
    }
    return noOp
  }

  return {
    // mushi-mushi-allowlist: OTel SpanProcessor requires onStart; this processor only acts on onEnd
    onStart: () => {},

    onEnd(span: BrowserOtelSpan): void {
      try {
        const isError = span.status.code === SPAN_STATUS_ERROR

        if (!isError && errorsOnly) return

        if (isError) {
          const message =
            (span.attributes['exception.message'] as string | undefined) ??
            (span.attributes['error.message'] as string | undefined) ??
            `OTel error span: ${span.name}`

          // Build W3C traceparent from span context so the Mushi report is
          // correlated to the same distributed trace.
          const ctx = span.spanContext()
          const traceparent = `00-${ctx.traceId}-${ctx.spanId}-01`

          // Fire-and-forget — never block the OTel pipeline on a network call.
          void mushi.captureEvent({
            description: message,
            category: 'bug',
            component: `otel:${span.name}`,
            metadata: {
              otelSpanName: span.name,
              otelAttributes: span.attributes,
              traceparent,
            },
          })
        }
      } catch {
        // Never let the span processor crash the host page.
      }
    },

    shutdown: () => Promise.resolve(),
    forceFlush: () => Promise.resolve(),
  }
}
