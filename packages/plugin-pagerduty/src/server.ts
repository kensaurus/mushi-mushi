/**
 * Stand-alone Node HTTPS entry point. Usage:
 *
 *   MUSHI_PLUGIN_SECRET=... PAGERDUTY_ROUTING_KEY=... PORT=3000 \
 *     npx mushi-plugin-pagerduty
 */

import { createServer } from 'node:http'
import { createPagerDutyPlugin } from './index.js'

const port = Number(process.env.PORT ?? 3000)
const handler = createPagerDutyPlugin({
  routingKey: required('PAGERDUTY_ROUTING_KEY'),
  mushiSecret: required('MUSHI_PLUGIN_SECRET'),
  severityThreshold: (process.env.SEVERITY_THRESHOLD as 'critical' | 'high' | 'medium' | 'low' | undefined) ?? 'critical',
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
  console.log(`mushi-plugin-pagerduty listening on :${port}`)
})

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return v
}
