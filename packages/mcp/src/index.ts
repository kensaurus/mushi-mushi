/**
 * FILE: packages/mcp/src/index.ts
 * PURPOSE: Stdio entry point for the Mushi Mushi MCP server. Reads env,
 *          builds the server via `createMushiServer`, and bridges it over
 *          `StdioServerTransport`.
 *
 *          Kept intentionally thin so `createMushiServer` can be unit- and
 *          integration-tested with `InMemoryTransport` without this file
 *          executing `main()` at import time.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createRequire } from 'node:module'
import { createLogger } from '@mushi-mushi/core'
import { createMushiServer } from './server.js'

const require = createRequire(import.meta.url)
const VERSION = (require('../package.json') as { version: string }).version

const log = createLogger({ scope: 'mushi:mcp', level: 'info' })

const API_ENDPOINT = process.env.MUSHI_API_ENDPOINT ?? ''
const API_KEY = process.env.MUSHI_API_KEY ?? ''
const PROJECT_ID = process.env.MUSHI_PROJECT_ID ?? ''

async function main() {
  if (!API_KEY) {
    log.fatal('MUSHI_API_KEY environment variable is required')
    process.exit(1)
  }
  if (!API_ENDPOINT) {
    console.error(
      '[mushi-mcp] MUSHI_API_ENDPOINT is not set. All tool calls will fail.\n' +
        'Set MUSHI_API_ENDPOINT to your Supabase edge function URL, ' +
        'e.g. https://xyz.supabase.co/functions/v1/api',
    )
  }
  log.info('Starting Mushi MCP server', { version: VERSION, endpoint: API_ENDPOINT || '(unset)', hasProjectId: !!PROJECT_ID })

  const server = createMushiServer({
    version: VERSION,
    apiEndpoint: API_ENDPOINT,
    apiKey: API_KEY,
    projectId: PROJECT_ID || undefined,
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  log.fatal('MCP server crashed', { err: String(err) })
  process.exit(1)
})
