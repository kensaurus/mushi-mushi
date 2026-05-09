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

  // Inventory change notifications (P1.7):
  // Poll the inventory endpoint every 60 seconds and send
  // notifications/resources/updated when the `updated_at` timestamp changes.
  // This gives orchestrators (LangGraph, Claude, etc.) a push signal so they
  // can re-fetch inventory://current without constant polling.
  //
  // Only active when MUSHI_PROJECT_ID is set (single-project mode) and the
  // transport supports server-to-client notifications (all transports do).
  if (PROJECT_ID && API_ENDPOINT) {
    let lastInventoryAt: string | null = null
    const POLL_INTERVAL_MS = 60_000

    const pollInventory = async () => {
      try {
        const res = await fetch(`${API_ENDPOINT}/v1/admin/inventory/${PROJECT_ID}`, {
          headers: {
            'X-Mushi-Api-Key': API_KEY,
            'X-Mushi-Project': PROJECT_ID,
          },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) return
        const data = await res.json() as { data?: { updatedAt?: string } }
        const updatedAt = data?.data?.updatedAt ?? null
        if (updatedAt && updatedAt !== lastInventoryAt) {
          if (lastInventoryAt !== null) {
            // Only notify after the first successful fetch (not on startup).
            await server.server.sendResourceUpdated({ uri: 'inventory://current' })
            log.info('inventory://current updated — notified subscribers', { updatedAt })
          }
          lastInventoryAt = updatedAt
        }
      } catch {
        // Polling errors are silent — we never want the notification loop to crash the server.
      }
    }

    // Start immediately, then repeat.
    void pollInventory()
    setInterval(() => { void pollInventory() }, POLL_INTERVAL_MS)
  }
}

main().catch((err) => {
  log.fatal('MCP server crashed', { err: String(err) })
  process.exit(1)
})
