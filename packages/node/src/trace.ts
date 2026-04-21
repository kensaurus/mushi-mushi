/**
 * Wave G1 — W3C Trace Context + Sentry trace propagation.
 *
 * We parse `traceparent`, `tracestate`, and Sentry's `sentry-trace` headers
 * so a Mushi report originating from a Node service can be stitched back to
 * the originating browser click or upstream service.
 *
 * Why not use `@opentelemetry/api` directly? Because pulling OTel in as a
 * hard dep balloons cold-start time and many Mushi users already have it —
 * we want zero-dep baseline instrumentation and an opt-in OTel bridge.
 * `@opentelemetry/api` is a peer dep; the bridge lives in `./otel.ts`.
 */

export interface TraceContext {
  traceId?: string
  spanId?: string
  parentSpanId?: string
  sentryTraceId?: string
}

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const SENTRY_TRACE_RE = /^([0-9a-f]{32})-([0-9a-f]{16})(?:-([01]))?$/

export function parseTraceContext(headers: Record<string, string | string[] | undefined>): TraceContext {
  const get = (key: string): string | undefined => {
    const v = headers[key] ?? headers[key.toLowerCase()]
    if (Array.isArray(v)) return v[0]
    return v
  }

  const ctx: TraceContext = {}
  const traceparent = get('traceparent')
  if (traceparent) {
    const m = TRACEPARENT_RE.exec(traceparent.trim())
    if (m) {
      ctx.traceId = m[2]
      ctx.parentSpanId = m[3]
    }
  }
  const sentryTrace = get('sentry-trace')
  if (sentryTrace) {
    const m = SENTRY_TRACE_RE.exec(sentryTrace.trim())
    if (m) {
      ctx.sentryTraceId = m[1]
      ctx.parentSpanId = ctx.parentSpanId ?? m[2]
    }
  }
  return ctx
}
