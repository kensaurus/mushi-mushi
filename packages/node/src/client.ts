import type { ApiClientOptions } from '@mushi-mushi/core'
import { DEFAULT_API_ENDPOINT } from '@mushi-mushi/core'

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
}

export class MushiNodeClient {
  private opts: NodeClientOptions
  private endpoint: string

  constructor(options: NodeClientOptions) {
    this.opts = options
    this.endpoint = (options.apiEndpoint ?? DEFAULT_API_ENDPOINT).replace(/\/$/, '')
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
   */
  async captureReport(payload: NodeReportPayload): Promise<{ ok: boolean; reportId?: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.timeout ?? 10_000)
    try {
      const res = await fetch(`${this.endpoint}/v1/reports`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Mushi-Api-Key': this.opts.apiKey,
          'X-Mushi-Project': this.opts.projectId,
          'User-Agent': '@mushi-mushi/node',
        },
        body: JSON.stringify({
          projectId: this.opts.projectId,
          category: payload.userCategory ?? this.opts.defaultCategory ?? 'bug',
          description: payload.description,
          severity: payload.severity,
          component: payload.component,
          environment: {
            url: payload.url,
            env: this.opts.environment,
            release: this.opts.release,
            origin: 'node',
            traceContext: payload.traceContext,
          },
          metadata: {
            ...(payload.metadata ?? {}),
            error: payload.error,
            userId: payload.userId,
          },
          reporterToken: `node-${this.opts.projectId}`,
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

let warnedOnce = false
function warnOnce(msg: string): void {
  if (warnedOnce) return
  warnedOnce = true
  console.warn(msg)
}
