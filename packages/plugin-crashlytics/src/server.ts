/**
 * Stand-alone Node HTTPS entry point for the Crashlytics plugin. Usage:
 *
 *   MUSHI_PLUGIN_SECRET=... \
 *   FIREBASE_PROJECT_ID=... FIREBASE_APP_ID=... \
 *   GCP_ACCESS_TOKEN=... \   # pre-fetched OAuth2 Bearer token
 *   PORT=3000 \
 *     npx mushi-plugin-crashlytics
 *
 * Rotate GCP_ACCESS_TOKEN before expiry (typically every 55 minutes).
 * See https://cloud.google.com/docs/authentication/token-types#access for
 * service-account token issuance.
 */

import { createServer } from 'node:http'
import { createCrashlyticsPlugin } from './index.js'

const port = Number(process.env.PORT ?? 3000)
const handler = createCrashlyticsPlugin({
  mushiSecret: required('MUSHI_PLUGIN_SECRET'),
  projectId: required('FIREBASE_PROJECT_ID'),
  appId: required('FIREBASE_APP_ID'),
  serviceAccountEmail: process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL ?? '',
  adminBaseUrl: process.env.ADMIN_BASE_URL ?? '',
  accessToken: required('GCP_ACCESS_TOKEN'),
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
  console.warn(`mushi-plugin-crashlytics listening on :${port}`)
})

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return v
}
