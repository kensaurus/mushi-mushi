/**
 * Express adapter for `createPluginHandler`.
 *
 * Usage:
 *
 *   import express from 'express'
 *   import { createPluginHandler, expressMiddleware } from '@mushi-mushi/plugin-sdk'
 *
 *   const app = express()
 *   const handler = createPluginHandler({ secret: process.env.MUSHI_SECRET!, on: { ... } })
 *   app.post('/mushi/webhook', expressMiddleware(handler))
 *
 * IMPORTANT: register the middleware BEFORE `express.json()` so the raw body
 * stays intact for HMAC verification. The middleware reads the raw stream
 * itself.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { createPluginHandler } from './handler.js'

type Handler = ReturnType<typeof createPluginHandler>

export function expressMiddleware(handler: Handler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void readRawBody(req)
      .then(async (rawBody) => {
        const result = await handler({ rawBody, headers: req.headers as Record<string, string | undefined> })
        res.status(result.status).json(result.body)
      })
      .catch(next)
  }
}

function readRawBody(req: Request): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}
