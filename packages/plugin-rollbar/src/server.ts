/**
 * Stand-alone Node HTTPS entry point for the Rollbar plugin. Usage:
 *
 *   MUSHI_PLUGIN_SECRET=... ROLLBAR_ACCESS_TOKEN=... ROLLBAR_PROJECT_ID=... \
 *   ADMIN_BASE_URL=https://kensaur.us/mushi-mushi/admin PORT=3000 \
 *     npx mushi-plugin-rollbar
 */

import { createServer } from 'node:http'
import { createRollbarPlugin } from './index.js'

const port = Number(process.env.PORT ?? 3000)
const handler = createRollbarPlugin({
  mushiSecret: required('MUSHI_PLUGIN_SECRET'),
  accessToken: required('ROLLBAR_ACCESS_TOKEN'),
  projectId: required('ROLLBAR_PROJECT_ID'),
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? '',
})

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/mushi/webhook') {
    res.statusCode = 404
    res.end()
    return
  }
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks).toString('utf8')
    const headers: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v
    const result = await handler({ rawBody, headers })
    res.statusCode = result.status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(result.body))
  })
}).listen(port, () => {
  console.warn(`mushi-plugin-rollbar listening on :${port}`)
})

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return v
}
