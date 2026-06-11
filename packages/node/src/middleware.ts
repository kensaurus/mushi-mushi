/**
 * mushiTraceMiddleware — generic Node.js trace-context middleware (Phase 4).
 *
 * Extracts the W3C `traceparent` and `x-mushi-session` headers injected by
 * the mushi web SDK from an incoming HTTP request, generates a backend span,
 * and posts it to `/v1/ingest/spans` so the admin console can correlate a
 * frontend bug report with the backend execution that served it.
 *
 * Framework adapters (Express, Fastify, Hono) are thin wrappers around this
 * shared logic. The middleware is fire-and-forget: span ingestion never blocks
 * the request, and any ingest failure is swallowed silently.
 *
 * Usage (Express):
 *   import { mushiTraceMiddleware } from '@mushi-mushi/node/middleware'
 *   app.use(mushiTraceMiddleware({ apiKey: process.env.MUSHI_API_KEY!, projectId: '...' }))
 *
 * Configuration:
 *   apiKey      — the SDK API key for the mushi project.
 *   projectId   — optional; derived from the key server-side but can be supplied
 *                 to skip the lookup.
 *   apiEndpoint — override the default cloud endpoint.
 *   onlyErrors  — when true, only emit spans for requests that result in 5xx
 *                 responses (reduces volume). Default: false (emit all matched).
 */

const DEFAULT_ENDPOINT = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'

export interface TraceMiddlewareOptions {
  apiKey: string
  projectId?: string
  apiEndpoint?: string
  onlyErrors?: boolean
}

type SimpleReq = {
  method?: string
  url?: string
  originalUrl?: string
  headers: Record<string, string | string[] | undefined>
}
type SimpleRes = { statusCode?: number }
type NextFn = (err?: unknown) => void

/**
 * Extract a single header value (handles string | string[] | undefined).
 */
function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(v)) return v[0]
  return v
}

function parseTraceId(traceparent: string): string | null {
  // traceparent = "00-<32hex traceId>-<16hex spanId>-<flags>"
  const parts = traceparent.trim().split('-')
  if (parts.length < 4) return null
  const traceId = parts[1]
  if (!traceId || !/^[0-9a-f]{32}$/i.test(traceId)) return null
  return traceId.toLowerCase()
}

/**
 * Build a minimal span JSON object from request metadata.
 */
function buildSpan(opts: {
  traceId: string
  method: string
  url: string
  statusCode: number
  durationMs: number
  spanId: string
}): Record<string, unknown> {
  return {
    traceId: opts.traceId,
    spanId: opts.spanId,
    name: `${opts.method} ${opts.url}`,
    status: opts.statusCode >= 500 ? 'ERROR' : opts.statusCode >= 400 ? 'WARN' : 'OK',
    httpMethod: opts.method,
    httpUrl: opts.url,
    httpStatusCode: opts.statusCode,
    duration_ms: opts.durationMs,
    attributes: {
      'http.method': opts.method,
      'http.url': opts.url,
      'http.status_code': opts.statusCode,
    },
  }
}

function randomSpanId(): string {
  // Generate 8 random bytes → 16-char hex string.
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Fallback for older Node (pre-15).
  return Math.random().toString(16).slice(2).padStart(16, '0').slice(0, 16)
}

async function postSpan(
  opts: TraceMiddlewareOptions,
  span: Record<string, unknown>,
  sessionId: string | undefined,
): Promise<void> {
  const endpoint = (opts.apiEndpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '')
  await fetch(`${endpoint}/v1/ingest/spans`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mushi-Api-Key': opts.apiKey,
    },
    body: JSON.stringify({ spans: [{ ...span, sessionId: sessionId ?? null }] }),
    // 5-second budget; span loss is acceptable.
    signal: AbortSignal.timeout(5_000),
  })
}

// ─── Express / Connect middleware ────────────────────────────────────────────

/**
 * Returns an Express/Connect middleware that captures backend spans for
 * incoming requests tagged with a mushi `traceparent` header.
 */
export function mushiTraceMiddleware(opts: TraceMiddlewareOptions) {
  return function mushiTraceHandler(req: SimpleReq, res: SimpleRes, next: NextFn) {
    const traceparent = getHeader(req.headers, 'traceparent')
    const sessionId = getHeader(req.headers, 'x-mushi-session')
    const start = Date.now()

    // Capture response status via `finish` event.
    const url = req.originalUrl ?? req.url ?? ''
    const method = req.method ?? 'GET'

    // We use `res.on('finish', ...)` pattern for Express/Connect.
    // Wrap in try/catch because some mock request objects don't have `.on`.
    try {
      (res as unknown as { on(event: string, cb: () => void): void }).on('finish', () => {
        if (!traceparent) return
        const traceId = parseTraceId(traceparent)
        if (!traceId) return

        const statusCode = res.statusCode ?? 200
        if (opts.onlyErrors && statusCode < 500) return

        const span = buildSpan({
          traceId,
          method,
          url,
          statusCode,
          durationMs: Date.now() - start,
          spanId: randomSpanId(),
        })

        void postSpan(opts, span, sessionId).catch(() => { /* swallow */ })
      })
    } catch { /* middleware is never blocking */ }

    next()
  }
}

// ─── Standalone helper ────────────────────────────────────────────────────────

/**
 * Framework-agnostic helper: call this manually at the end of a request handler
 * to emit a span. Useful for serverless functions (Vercel, Netlify, Deno Deploy)
 * where a middleware `.on('finish')` pattern isn't available.
 *
 * @example
 * export default async function handler(req, res) {
 *   const t0 = Date.now()
 *   try { ... } finally {
 *     await emitMushiSpan({ req, statusCode: res.statusCode, durationMs: Date.now() - t0, opts })
 *   }
 * }
 */
export async function emitMushiSpan(params: {
  req: SimpleReq
  statusCode: number
  durationMs: number
  opts: TraceMiddlewareOptions
}): Promise<void> {
  const { req, statusCode, durationMs, opts } = params
  const traceparent = getHeader(req.headers, 'traceparent')
  const sessionId = getHeader(req.headers, 'x-mushi-session')
  if (!traceparent) return
  const traceId = parseTraceId(traceparent)
  if (!traceId) return
  if (opts.onlyErrors && statusCode < 500) return

  const span = buildSpan({
    traceId,
    method: req.method ?? 'GET',
    url: req.originalUrl ?? req.url ?? '',
    statusCode,
    durationMs,
    spanId: randomSpanId(),
  })

  await postSpan(opts, span, sessionId).catch(() => { /* swallow */ })
}
