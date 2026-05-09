/**
 * FILE: packages/server/supabase/functions/_shared/trace.ts
 * PURPOSE: W3C Trace Context (RFC 9546) utilities for cross-service trace propagation.
 *
 * Mushi is middleware: we receive traces from customer APMs (Sentry, Datadog,
 * Honeycomb) and must propagate the same trace-id forward so the customer's
 * APM shows one unbroken trace from "user clicks report widget" through
 * "Mushi classifies" → "agent drafts fix" → "PR opens" → "CI runs" →
 * "synthetic probe verifies".
 *
 * This file does NOT depend on @opentelemetry/sdk-node (which can't run in
 * Deno/Edge). It implements the ~80-line subset of the W3C spec needed to:
 *   1. Parse an inbound `traceparent` header into its parts.
 *   2. Mint a child `traceparent` (same trace-id, new span-id) for outbound calls.
 *   3. Generate a new root `traceparent` when no parent is present.
 *
 * Usage (server-side):
 *   import { childTraceparent, parseTraceparent, attachTraceparent } from './_shared/trace.ts'
 *
 *   // In an ingest route: store the traceparent from the report payload
 *   const tp = report.metadata?.traceparent as string | undefined
 *   const childTp = childTraceparent(tp) // same trace-id, new span-id
 *
 *   // In an outbound adapter call: attach to the fetch() headers
 *   const res = await fetch(url, { headers: attachTraceparent(baseHeaders, childTp) })
 *
 *   // In an SSE/AG-UI stream: emit on the first event
 *   await stream.write(`data: ${JSON.stringify({ traceparent: childTp })}\n\n`)
 */

/** Parsed representation of a W3C traceparent header value. */
export interface TraceparentParts {
  version: string    // always '00'
  traceId: string    // 32 hex chars
  spanId: string     // 16 hex chars
  flags: string      // 2 hex chars, usually '01' (sampled) or '00'
}

const TP_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i

/**
 * Parse a `traceparent` header value. Returns `null` if the value is absent
 * or doesn't match the W3C format.
 */
export function parseTraceparent(value: string | null | undefined): TraceparentParts | null {
  if (!value) return null
  const m = TP_RE.exec(value.trim())
  if (!m) return null
  return { version: m[1], traceId: m[2].toLowerCase(), spanId: m[3].toLowerCase(), flags: m[4] }
}

/**
 * Generate a fresh W3C traceparent header value as a root span (new trace-id).
 * All spans generated in this request will share this trace-id.
 */
export function newTraceparent(): string {
  const traceId = randomHex(32)
  const spanId = randomHex(16)
  return `00-${traceId}-${spanId}-01`
}

/**
 * Create a child traceparent from a parent. The child inherits the parent's
 * `trace-id` (cross-service correlation) but gets a new `span-id` (this
 * call's identity). Sampling flag is preserved from parent.
 *
 * If `parent` is absent or invalid, generates a new root traceparent.
 */
export function childTraceparent(parent: string | null | undefined): string {
  const parts = parseTraceparent(parent)
  if (!parts) return newTraceparent()
  const childSpanId = randomHex(16)
  return `00-${parts.traceId}-${childSpanId}-${parts.flags}`
}

/**
 * Merge a traceparent into an existing headers object (plain Record or
 * Headers instance). Returns a new merged Record<string, string> — safe to
 * pass directly to fetch().
 *
 * If `traceparent` is null/undefined, returns the original headers unchanged.
 */
export function attachTraceparent(
  headers: Record<string, string> | Headers,
  traceparent: string | null | undefined,
): Record<string, string> {
  const flat: Record<string, string> =
    headers instanceof Headers
      ? Object.fromEntries(headers.entries())
      : { ...headers }
  if (traceparent) flat['traceparent'] = traceparent
  return flat
}

/**
 * Extract the `traceparent` string from a Hono request or a raw Request, if
 * one was set by the inbound SDK payload (`report.metadata.traceparent`) or
 * directly as a request header.
 *
 * Priority:
 *   1. `traceparent` header (set by SDK middleware on same-process requests)
 *   2. `metadata.traceparent` field in a JSON body (async, use sparingly)
 */
export function extractInboundTraceparent(headerValue?: string | null): string | null {
  if (!headerValue) return null
  return parseTraceparent(headerValue) ? headerValue : null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function randomHex(chars: number): string {
  const bytes = new Uint8Array(chars / 2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
