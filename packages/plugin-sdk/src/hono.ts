/**
 * Hono adapter for `createPluginHandler`.
 *
 * Usage:
 *
 *   import { Hono } from 'hono'
 *   import { createPluginHandler, honoHandler } from '@mushi-mushi/plugin-sdk'
 *
 *   const app = new Hono()
 *   const handler = createPluginHandler({ secret: Deno.env.get('MUSHI_SECRET')!, on: { ... } })
 *   app.post('/mushi/webhook', honoHandler(handler))
 */

import type { Context } from 'hono'
import type { createPluginHandler } from './handler.js'

type Handler = ReturnType<typeof createPluginHandler>

export function honoHandler(handler: Handler) {
  return async (c: Context) => {
    const rawBody = await c.req.text()
    const headers: Record<string, string | undefined> = {}
    c.req.raw.headers.forEach((value: string, key: string) => {
      headers[key] = value
    })
    const result = await handler({ rawBody, headers })
    return c.json(result.body, result.status as 200 | 400 | 401 | 500)
  }
}
