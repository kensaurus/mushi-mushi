import type { MushiNodeClient } from './client'
import { parseTraceContext } from './trace'

type HonoContext = {
  req: { raw: { headers: Headers; method: string; url: string } }
  res: Response
}
type HonoHandler = (err: Error, c: HonoContext) => Response | Promise<Response>

export interface HonoMiddlewareOptions {
  client: MushiNodeClient
  component?: string
}

/**
 * Wave G1 — Hono `onError` handler.
 *
 *   import { Hono } from 'hono'
 *   import { mushiHonoErrorHandler } from '@mushi-mushi/node/hono'
 *
 *   const app = new Hono()
 *   app.onError(mushiHonoErrorHandler({ client }, (err, c) => c.text('Server error', 500)))
 *
 * Takes a wrapped `next` handler because Hono REQUIRES onError to return
 * a Response. We run our capture, then call the user's handler verbatim.
 */
export function mushiHonoErrorHandler(
  opts: HonoMiddlewareOptions,
  next: HonoHandler,
): HonoHandler {
  return async (err, c) => {
    try {
      const headers: Record<string, string> = {}
      c.req.raw.headers.forEach((v, k) => { headers[k] = v })
      const traceContext = parseTraceContext(headers)
      void opts.client.captureReport({
        description: `[${c.req.raw.method} ${c.req.raw.url}] ${err.message}`,
        userCategory: 'bug',
        severity: 'high',
        component: opts.component ?? 'node:hono',
        url: c.req.raw.url,
        traceContext,
        error: { name: err.name, message: err.message, stack: err.stack },
      })
    } catch {
      // silent
    }
    return next(err, c)
  }
}
