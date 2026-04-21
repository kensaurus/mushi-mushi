import type { MushiNodeClient } from './client'
import { parseTraceContext } from './trace'

type FastifyRequest = {
  headers: Record<string, string | string[] | undefined>
  method?: string
  url?: string
  raw?: { url?: string }
}
type FastifyReply = { statusCode?: number }
type FastifyInstance = {
  setErrorHandler: (fn: (err: Error, req: FastifyRequest, reply: FastifyReply) => void) => void
  addHook: (name: 'onError', fn: (req: FastifyRequest, reply: FastifyReply, err: Error) => Promise<void> | void) => void
}

export interface FastifyPluginOptions {
  client: MushiNodeClient
  component?: string
}

/**
 * Wave G1 — Fastify onError hook. Register once at bootstrap:
 *
 *   import Fastify from 'fastify'
 *   import { mushiFastifyPlugin } from '@mushi-mushi/node/fastify'
 *   const app = Fastify()
 *   mushiFastifyPlugin(app, { client })
 *
 * We register an `onError` hook rather than a `setErrorHandler` so we
 * coexist with the app's own handler — Fastify allows only one of those.
 */
export function mushiFastifyPlugin(app: FastifyInstance, opts: FastifyPluginOptions): void {
  app.addHook('onError', (req, reply, err) => {
    try {
      const traceContext = parseTraceContext(req.headers)
      void opts.client.captureReport({
        description: `[${req.method ?? 'REQ'} ${req.url ?? req.raw?.url ?? ''}] ${err.message}`,
        userCategory: 'bug',
        severity: (reply.statusCode ?? 500) >= 500 ? 'high' : 'medium',
        component: opts.component ?? 'node:fastify',
        url: req.url ?? req.raw?.url,
        traceContext,
        error: { name: err.name, message: err.message, stack: err.stack },
      })
    } catch {
      // silent — instrumentation never fails the handler chain
    }
  })
}
