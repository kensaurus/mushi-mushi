// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
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

// MCP stdio transport owns stdout for JSON-RPC 2.0 exclusively.
// Any non-JSON-RPC bytes on stdout — including structured log lines from
// createLogger — cause the client (Cursor, Claude Desktop, etc.) to emit
// validation errors and drop the transport connection.
// Redirect console.log and console.warn to stderr before any logger is
// instantiated so all log output goes to the safe side of the pipe.
/* eslint-disable no-console */
const _writeStderr = (...args: unknown[]) =>
  process.stderr.write(
    args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n',
  )
console.log = _writeStderr
console.warn = _writeStderr
/* eslint-enable no-console */
import { ALL_SCOPES, type McpScope } from './catalog.js'
import { DEFAULT_FEATURE_GROUPS, parseFeaturesCsv } from './feature-groups.js'
import { createMushiServer } from './server.js'
import * as Sentry from '@sentry/node'

const require = createRequire(import.meta.url)
const VERSION = (require('../package.json') as { version: string }).version

const log = createLogger({ scope: 'mushi:mcp', level: 'info', destination: 'stderr' })

const API_ENDPOINT = process.env.MUSHI_API_ENDPOINT ?? ''
const API_KEY = process.env.MUSHI_API_KEY ?? ''
const PROJECT_ID = process.env.MUSHI_PROJECT_ID ?? ''
/**
 * Optional CSV list of granted scopes. When set, the server only registers
 * tools whose catalog scope is in the list — `tools/list` will hide write
 * tools entirely for read-only keys, instead of letting the LLM call them
 * and burn round-trips on `INSUFFICIENT_SCOPE` errors.
 *
 * Optional env for observability correlation with host Sentry:
 *   MUSHI_MCP_SENTRY_DSN — when your IDE host runs Sentry, correlate MCP
 *   api.failed log lines (they include requestId) with host-side events.
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

/**
 * Tool surface to expose. When `MUSHI_FEATURES` is unset we default to the
 * lean `DEFAULT_FEATURE_GROUPS` (triage + fixes + inventory + setup + docs)
 * rather than the full catalog, so a fresh install presents a focused,
 * easy-to-reason-about toolset. Set `MUSHI_FEATURES=all` (or a CSV of groups,
 * e.g. `triage,qa,skills`) to widen the surface.
 */
const FEATURES = process.env.MUSHI_FEATURES?.trim()
  ? parseFeaturesCsv(process.env.MUSHI_FEATURES)
  : DEFAULT_FEATURE_GROUPS

const MCP_SENTRY_DSN = process.env.MUSHI_MCP_SENTRY_DSN?.trim()
if (MCP_SENTRY_DSN) {
  Sentry.init({
    dsn: MCP_SENTRY_DSN,
    environment: process.env.MUSHI_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
  })
}

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
  const mode = PROJECT_ID ? 'single-project' : 'account'
  if (!PROJECT_ID) {
    // Account mode: no fixed project — the key resolves projects dynamically.
    // This is intentional when a key can access multiple projects.
    // Tools that need a projectId will resolve it via list_projects or require
    // it to be passed explicitly on each call.
    log.info(
      '[mushi-mcp] Running in account mode (no MUSHI_PROJECT_ID set). ' +
        'Project-scoped tools accept an explicit projectId argument. ' +
        'Run `get_account_overview` to see accessible projects.',
    )
  }
  log.info('Starting Mushi MCP server', {
    version: VERSION,
    mode,
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

  // Graceful shutdown: real MCP clients (Cursor, Claude Desktop, …) manage
  // the child process lifecycle by killing it directly, so this path was
  // never exercised by hand-testing. External test harnesses that pipe
  // requests over stdio then close the pipe and wait for a natural exit
  // (Docker introspection checks, e.g. Glama's build test) do rely on it —
  // without an explicit stdin-EOF/signal handler the process leaks forever
  // once `pollTimer` below is scheduled, since a bare `setInterval` keeps
  // the event loop alive indefinitely.
  let shuttingDown = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  const shutdown = (exitCode: number) => {
    if (shuttingDown) return
    shuttingDown = true
    if (pollTimer) clearInterval(pollTimer)
    void transport.close().finally(() => process.exit(exitCode))
  }
  process.stdin.on('end', () => shutdown(0))
  process.stdin.on('close', () => shutdown(0))
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

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
      if (shuttingDown) return
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
      } catch (pollErr) {
        log.debug('inventory poll failed', { err: String(pollErr) })
      }
    }

    // Start immediately, then repeat. `.unref()` so this background poll
    // never blocks the process from exiting on its own (belt-and-suspenders
    // alongside the explicit shutdown() handlers above) — a real MCP client
    // session keeps stdin open for hours, so unref has no effect on normal
    // operation, it only matters once nothing else is keeping the loop alive.
    void pollInventory()
    pollTimer = setInterval(() => { void pollInventory() }, POLL_INTERVAL_MS)
    pollTimer.unref()
  }
}

main().catch((err) => {
  log.fatal('MCP server crashed', { err: String(err) })
  process.exit(1)
})
