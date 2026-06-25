/**
 * Stand-alone Node HTTPS entry point for the GitHub Issues plugin. Usage:
 *
 *   MUSHI_PLUGIN_SECRET=... GITHUB_TOKEN=... \
 *   GITHUB_OWNER=acme GITHUB_REPO=my-app \
 *   ADMIN_BASE_URL=https://kensaur.us/mushi-mushi/admin PORT=3000 \
 *     npx mushi-plugin-github-issues
 */

import { createServer } from 'node:http'
import { createGithubIssuesPlugin } from './index.js'

const port = Number(process.env.PORT ?? 3000)
const handler = createGithubIssuesPlugin({
  mushiSecret: required('MUSHI_PLUGIN_SECRET'),
  token: required('GITHUB_TOKEN'),
  owner: required('GITHUB_OWNER'),
  repo: required('GITHUB_REPO'),
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
  console.warn(`mushi-plugin-github-issues listening on :${port}`)
})

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return v
}
