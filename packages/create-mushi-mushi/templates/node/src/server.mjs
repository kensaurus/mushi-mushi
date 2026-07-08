import { createServer } from 'node:http'
import { MushiNodeClient, attachUnhandledHook } from '@mushi-mushi/node'

if (!process.env.MUSHI_PROJECT_ID || !process.env.MUSHI_API_KEY) {
  console.error(
    'Missing MUSHI_PROJECT_ID / MUSHI_API_KEY.\n' +
      'Fill in .env (see .env.example) and start with:\n' +
      '  npm start   # runs: node --env-file=.env src/server.mjs\n' +
      'Or run `npx mushi-mushi` to sign in and write the env file for you.',
  )
  process.exit(1)
}

const mushi = new MushiNodeClient({
  projectId: process.env.MUSHI_PROJECT_ID,
  apiKey: process.env.MUSHI_API_KEY,
  environment: process.env.NODE_ENV ?? 'development',
})

// Forward every uncaught exception / unhandled rejection to Mushi before exit.
attachUnhandledHook({ client: mushi })

const server = createServer((req, res) => {
  if (req.url === '/boom') {
    // Demo: an async crash — Mushi captures it via the unhandled hook.
    setImmediate(() => {
      throw new Error('Demo error — check your Mushi dashboard for the report')
    })
    res.writeHead(500).end('crashing…\n')
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Mushi Mushi Node demo. GET /boom to send a demo error.\n')
})

server.listen(3000, () => {
  console.log('Listening on http://localhost:3000 — GET /boom to test capture')
})
