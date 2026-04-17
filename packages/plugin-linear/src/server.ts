import { createServer } from 'node:http'
import { createLinearPlugin } from './index.js'

const port = Number(process.env.PORT ?? 3000)
const handler = createLinearPlugin({
  linearApiKey: required('LINEAR_API_KEY'),
  teamId: required('LINEAR_TEAM_ID'),
  mushiSecret: required('MUSHI_PLUGIN_SECRET'),
  mushiApiKey: process.env.MUSHI_API_KEY ?? '',
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
  console.log(`mushi-plugin-linear listening on :${port}`)
})

function required(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`Missing required env var: ${name}`); process.exit(1) }
  return v
}
