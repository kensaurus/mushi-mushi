import { createHash } from 'node:crypto'
import type { ApiClientOptions } from '@mushi-mushi/core'
import { DEFAULT_API_ENDPOINT, scrubPii, scrubUrl } from '@mushi-mushi/core'

/**
 * Wave G1 — server-originated report shape.
 *
 * The browser SDK reports user-observed bugs; the Node SDK reports
 * server-observed ones (uncaught errors, slow requests, failed
 * integrations). Both land in the same `reports` table so the judge /
 * knowledge-graph / fix pipeline don't need to care about origin.
 */
export interface NodeReportPayload {
  description: string
  userCategory?: 'bug' | 'slow' | 'visual' | 'confusing' | 'other'
  severity?: 'critical' | 'high' | 'medium' | 'low'
  component?: string
  url?: string
  userId?: string | null
  // Distributed-trace correlation for cross-service bug aggregation. Populated
  // automatically by the middleware from the incoming request's `traceparent`
  // header (W3C Trace Context) and `sentry-trace` header when present.
  traceContext?: {
    traceId?: string
    spanId?: string
    parentSpanId?: string
    sentryTraceId?: string
  }
  metadata?: Record<string, unknown>
  error?: {
    name?: string
    message?: string
    stack?: string
  }
}

export interface NodeClientOptions extends ApiClientOptions {
  /** Default `userCategory` to stamp on server-originated reports. Defaults to `bug`. */
  defaultCategory?: NodeReportPayload['userCategory']
  /**
   * Environment name (`production`, `staging`, `preview`). Surfaces as
   * `reports.environment.env` so the admin UI can filter noisy staging reports.
   */
  environment?: string
  /** Release identifier (git sha, semver). Used by the judge to regression-scope fixes. */
  release?: string
  /**
   * Process-wide AbortSignal. When set, all in-flight `captureReport`
   * calls cancel as soon as the signal aborts. Compose with per-call
   * signals via `AbortSignal.any` (Node ≥ 20). Typical use: wire to a
   * SIGTERM handler so a long-running report never blocks graceful
   * shutdown.
   */
  signal?: AbortSignal
}

export interface CaptureReportOptions {
  /**
   * Per-call AbortSignal. Composes with `NodeClientOptions.signal` and
   * the internal timeout via `AbortSignal.any` so `captureReport` stops
   * the moment any of the three triggers fire.
   */
  signal?: AbortSignal
}

export class MushiNodeClient {
  private opts: NodeClientOptions
  private endpoint: string

  constructor(options: NodeClientOptions) {
    this.opts = options
    this.endpoint = (options.apiEndpoint ?? DEFAULT_API_ENDPOINT).replace(/\/$/, '')
  }

  /**
   * Convenience wrapper: capture an exception as a critical server report.
   * Accepts an `Error` object or a plain string message.
   * Never throws.
   */
  async captureException(
    error: Error | string,
    extra?: Omit<NodeReportPayload, 'description' | 'error'>,
    options?: CaptureReportOptions,
  ): Promise<{ ok: boolean; reportId?: string }> {
    const e = error instanceof Error ? error : new Error(String(error))
    return this.captureReport(
      {
        description: e.message,
        userCategory: 'bug',
        severity: 'critical',
        error: { name: e.name, message: e.message, stack: e.stack },
        ...extra,
      },
      options,
    )
  }

  /**
   * Send a server-side report. Never throws — failures are swallowed and
   * logged once per process at warn level so instrumentation can never take
   * down the host service.
   *
   * We POST directly rather than going through `@mushi-mushi/core`'s
   * `createApiClient` because `MushiReport` is shaped for the browser
   * (screenshots, rrweb replay, reporter tokens). Server reports have a
   * flatter shape the `/v1/reports` ingest route already accepts.
   *
   * AbortSignal composition (Round 8 — B4): the timeout signal is
   * combined with `options.signal` (per-call) and `this.opts.signal`
   * (process-wide) via `AbortSignal.any` so any of the three can
   * cancel the in-flight fetch.
   */
  async captureReport(
    payload: NodeReportPayload,
    options?: CaptureReportOptions,
  ): Promise<{ ok: boolean; reportId?: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.timeout ?? 10_000)
    const signal = composeSignals([
      controller.signal,
      options?.signal,
      this.opts.signal,
    ])
    try {
      // If the caller stashed a W3C traceparent (e.g. from a middleware), pass
      // it both as the standard HTTP header and inside `metadata` so the server
      // can mint a child span and propagate it to outbound BYOK calls.
      const inboundTraceparent =
        typeof payload.metadata?.traceparent === 'string'
          ? payload.metadata.traceparent
          : null

      const extraHeaders: Record<string, string> = {}
      if (inboundTraceparent) extraHeaders['traceparent'] = inboundTraceparent

      const res = await fetch(`${this.endpoint}/v1/reports`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Mushi-Api-Key': this.opts.apiKey,
          'X-Mushi-Project': this.opts.projectId,
          'User-Agent': '@mushi-mushi/node',
          ...extraHeaders,
        },
        body: JSON.stringify({
          projectId: this.opts.projectId,
          category: payload.userCategory ?? this.opts.defaultCategory ?? 'bug',
          // RealWorld attunement: parity with the web SDK's wire-time
          // scrubbing. Server errors routinely embed request URLs and user
          // input ("user jake@x.com not found") — scrub description, error
          // text, and URL query values before anything leaves the process.
          description: scrubPii(payload.description),
          ...(payload.severity ? { severity: payload.severity } : {}),
          environment: buildNodeEnvironment({
            url: payload.url ? scrubUrl(payload.url) : undefined,
            env: this.opts.environment,
            release: this.opts.release,
            traceContext: payload.traceContext,
          }),
          metadata: {
            ...(payload.metadata ?? {}),
            error: payload.error
              ? {
                  ...payload.error,
                  ...(payload.error.message !== undefined
                    ? { message: scrubPii(payload.error.message) }
                    : {}),
                  ...(payload.error.stack !== undefined
                    ? { stack: scrubPii(payload.error.stack) }
                    : {}),
                }
              : payload.error,
            userId: payload.userId,
            ...(payload.component ? { component: payload.component } : {}),
          },
          reporterToken: `node-${createHash('sha256').update(this.opts.projectId).digest('hex').slice(0, 32)}`,
          createdAt: new Date().toISOString(),
          sdkPackage: '@mushi-mushi/node',
        }),
      })
      if (!res.ok) {
        warnOnce(`[mushi-mushi/node] submit failed: HTTP ${res.status}`)
        return { ok: false }
      }
      const body = await res.json().catch(() => ({})) as { data?: { reportId?: string } }
      return { ok: true, reportId: body.data?.reportId }
    } catch (err) {
      warnOnce(`[mushi-mushi/node] submit threw: ${(err as Error).message}`)
      return { ok: false }
    } finally {
      clearTimeout(timer)
    }
  }
}

const warnedMessages = new Set<string>()

function warnOnce(msg: string): void {
  if (warnedMessages.has(msg)) return
  warnedMessages.add(msg)
  console.warn(msg)
}

/**
 * Compose multiple AbortSignals into one. Aborts as soon as any input
 * aborts, delegating to the platform `AbortSignal.any` which is available
 * on all runtimes this package supports (Node ≥ 20, Deno, modern browsers).
 *
 * Exported for tests; not part of the package's public API.
 */
export function composeSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const live = signals.filter((s): s is AbortSignal => s !== undefined)
  if (live.length === 0) {
    // Should be unreachable — captureReport always passes its timeout
    // signal — but return a never-aborting signal so the type stays
    // simple at the call site.
    return new AbortController().signal
  }
  if (live.length === 1) return live[0]!
  return AbortSignal.any(live)
}

/**
 * Build a MushiEnvironment-compatible object for server-side reports.
 *
 * The ingest API was designed for browser SDK payloads that include
 * viewport, user-agent, timezone, etc. Server-side reports supply
 * sensible server defaults so the schema validation passes, and the
 * admin UI can still filter / display the report correctly via the
 * `origin: 'node'` discriminator inside the env block.
 */
function buildNodeEnvironment(opts: {
  url?: string
  env?: string
  release?: string
  traceContext?: NodeReportPayload['traceContext']
}): Record<string, unknown> {
  return {
    // Required MushiEnvironment fields — supply server-appropriate defaults
    userAgent: `@mushi-mushi/node Node.js/${process.version} ${process.platform}`,
    platform: process.platform,
    language: process.env.LANG?.split('.')[0] ?? 'en',
    viewport: { width: 0, height: 0 },
    url: opts.url ?? process.env.SERVICE_URL ?? 'server',
    referrer: '',
    timestamp: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,

    // Node-specific extras (stored in metadata by the server)
    env: opts.env,
    release: opts.release,
    origin: 'node',
    nodeVersion: process.version,
    pid: process.pid,
    ...(opts.traceContext ? { traceContext: opts.traceContext } : {}),
  }
}
