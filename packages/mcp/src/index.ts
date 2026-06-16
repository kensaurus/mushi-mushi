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
import { ALL_SCOPES, type McpScope } from './catalog.js'
import { parseFeaturesCsv } from './feature-groups.js'
import { createMushiServer } from './server.js'

const require = createRequire(import.meta.url)
const VERSION = (require('../package.json') as { version: string }).version

const log = createLogger({ scope: 'mushi:mcp', level: 'info' })

const API_ENDPOINT = process.env.MUSHI_API_ENDPOINT ?? ''
const API_KEY = process.env.MUSHI_API_KEY ?? ''
const PROJECT_ID = process.env.MUSHI_PROJECT_ID ?? ''
/**
 * Optional CSV list of granted scopes. When set, the server only registers
 * tools whose catalog scope is in the list — `tools/list` will hide write
 * tools entirely for read-only keys, instead of letting the LLM call them
 * and burn round-trips on `INSUFFICIENT_SCOPE` errors.
 *
 * Examples:
 *   MUSHI_SCOPES=mcp:read              # read-only key
 *   MUSHI_SCOPES=mcp:read,mcp:write    # equivalent to leaving unset (default)
 */
const SCOPES_RAW = process.env.MUSHI_SCOPES ?? ''
const parsedScopes = SCOPES_RAW
  ? SCOPES_RAW
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is McpScope => s === 'mcp:read' || s === 'mcp:write')
  : ALL_SCOPES
const SCOPES: readonly McpScope[] =
  SCOPES_RAW && parsedScopes.length === 0 ? ALL_SCOPES : parsedScopes

const FEATURES = parseFeaturesCsv(process.env.MUSHI_FEATURES)

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
  if (!PROJECT_ID) {
    console.error(
      '[mushi-mcp] MUSHI_PROJECT_ID is not set.\n' +
        '\n' +
        'Tools that scope to a project (get_recent_reports, get_report_detail,\n' +
        'search_reports, etc.) will require you to pass projectId explicitly on\n' +
        'every call. To set it once and never pass it again:\n' +
        '\n' +
        '  1. Open the Mushi admin console → Projects\n' +
        '     https://kensaur.us/mushi-mushi/projects\n' +
        '  2. Click your project — copy the UUID below the project name.\n' +
        '  3. Add it to your MCP env config:\n' +
        '       MUSHI_PROJECT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\n' +
        '\n' +
        'Or visit Admin → MCP for a pre-filled config snippet with your actual UUID.',
    )
  }
  log.info('Starting Mushi MCP server', {
    version: VERSION,
    endpoint: API_ENDPOINT || '(unset)',
    hasProjectId: !!PROJECT_ID,
    scopes: SCOPES.join(','),
  })

  const server = createMushiServer({
    version: VERSION,
    apiEndpoint: API_ENDPOINT,
    apiKey: API_KEY,
    projectId: PROJECT_ID || undefined,
    scopes: SCOPES,
    features: FEATURES,
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
            'X-Mushi-Project-Id': PROJECT_ID,
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
