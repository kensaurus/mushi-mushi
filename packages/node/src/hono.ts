// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
import type { MushiNodeClient } from './client'
import { parseTraceContext } from './trace'

/**
 * The part of Hono's `Context` this handler and its fallback use. `text()`
 * and `json()` let the fallback answer the way Hono's docs show,
 * `(err, c) => c.text('Server error', 500)`; without them that example did
 * not type-check (Mushi report 8aa2c40a).
 */
type HonoContext = {
  req: { raw: { headers: Headers; method: string; url: string } }
  res: Response
  text(text: string, status?: number, headers?: Record<string, string>): Response
  json(object: unknown, status?: number, headers?: Record<string, string>): Response
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
      const rawTraceparent = headers['traceparent'] ?? undefined
      void opts.client.captureReport({
        description: `[${c.req.raw.method} ${c.req.raw.url}] ${err.message}`,
        userCategory: 'bug',
        severity: 'high',
        component: opts.component ?? 'node:hono',
        url: c.req.raw.url,
        traceContext,
        error: { name: err.name, message: err.message, stack: err.stack },
        ...(rawTraceparent ? { metadata: { traceparent: rawTraceparent } } : {}),
      })
    } catch {
      // silent
    }
    return next(err, c)
  }
}
