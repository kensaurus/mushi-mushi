/**
 * Stand-alone Node HTTPS entry point. Usage:
 *
 *   MUSHI_PLUGIN_SECRET=... SENTRY_DSN=... PORT=3000 \
 *     npx mushi-plugin-sentry
 *
 * Optional:
 *   SEVERITY_THRESHOLD=high|critical|medium|low (default `high`)
 *   SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, SENTRY_PROJECT_SLUG to enable
 *     auto-resolve on `fix.applied`.
 *   MARK_IN_PROGRESS=true to also annotate `fix.proposed`.
 */

import { createServer } from 'node:http'
import { createSentryPlugin } from './index.js'

const port = Number(process.env.PORT ?? 3000)
const handler = createSentryPlugin({
  sentryDsn: required('SENTRY_DSN'),
  mushiSecret: required('MUSHI_PLUGIN_SECRET'),
  severityThreshold:
    (process.env.SEVERITY_THRESHOLD as 'critical' | 'high' | 'medium' | 'low' | undefined) ?? 'high',
  sentryAuthToken: process.env.SENTRY_AUTH_TOKEN,
  sentryOrgSlug: process.env.SENTRY_ORG_SLUG,
  sentryProjectSlug: process.env.SENTRY_PROJECT_SLUG,
  markInProgress: process.env.MARK_IN_PROGRESS === 'true',
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
  console.warn(`mushi-plugin-sentry listening on :${port}`)
})

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return v
}
