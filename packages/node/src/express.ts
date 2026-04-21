import type { MushiNodeClient } from './client'
import { parseTraceContext } from './trace'

type NextFn = (err?: unknown) => void
type ReqLike = { headers: Record<string, string | string[] | undefined>; method?: string; originalUrl?: string; url?: string }
type ResLike = { statusCode?: number }

export interface ExpressMiddlewareOptions {
  client: MushiNodeClient
  /**
   * Decide whether an error deserves a report. Default: 5xx responses
   * and thrown errors. 4xx by default are client bugs, not server bugs.
   */
  shouldReport?: (err: unknown, req: ReqLike, res: ResLike) => boolean
  /** Override the component stamp. Defaults to `node:express`. */
  component?: string
}

/**
 * Wave G1 — Express error-handler middleware. Mount LAST, after all routes.
 *
 *   import express from 'express'
 *   import { mushiExpressErrorHandler } from '@mushi-mushi/node/express'
 *   app.use(mushiExpressErrorHandler({ client }))
 *
 * The middleware NEVER swallows the error — it calls `next(err)` so your
 * own error handler still runs. Instrumentation that hides crashes is worse
 * than no instrumentation.
 */
export function mushiExpressErrorHandler(opts: ExpressMiddlewareOptions) {
  const shouldReport = opts.shouldReport ?? defaultShouldReport
  return (err: unknown, req: ReqLike, res: ResLike, next: NextFn) => {
    try {
      if (shouldReport(err, req, res)) {
        const e = err instanceof Error ? err : new Error(String(err))
        const traceContext = parseTraceContext(req.headers)
        void opts.client.captureReport({
          description: `[${req.method ?? 'REQ'} ${req.originalUrl ?? req.url ?? ''}] ${e.message}`,
          userCategory: 'bug',
          severity: (res.statusCode ?? 500) >= 500 ? 'high' : 'medium',
          component: opts.component ?? 'node:express',
          url: req.originalUrl ?? req.url,
          traceContext,
          error: { name: e.name, message: e.message, stack: e.stack },
        })
      }
    } catch {
      // Never let instrumentation take down the error handler.
    }
    next(err)
  }
}

function defaultShouldReport(err: unknown, _req: ReqLike, res: ResLike): boolean {
  if (err) return true
  const code = res.statusCode ?? 0
  return code >= 500
}
