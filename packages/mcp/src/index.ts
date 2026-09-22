// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/mcp/src/index.ts
 * PURPOSE: Stdio entry point for the Mushi Mushi MCP server. Reads env,
 *          builds the server via `createMushiServer`, and serves it over
 *          stdio with the SDK's `serveStdio`, which owns the protocol-era
 *          decision per connection: 2025-era `initialize` clients and
 *          2026-07-28 `_meta`-envelope clients are both served from the
 *          same factory.
 *
 *          Kept intentionally thin so `createMushiServer` can be unit- and
 *          integration-tested with `InMemoryTransport` without this file
 *          executing `main()` at import time.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio'
import type { McpServer } from '@modelcontextprotocol/server'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createLogger, DEFAULT_API_ENDPOINT } from '@mushi-mushi/core'

// MCP stdio transport owns stdout for JSON-RPC 2.0 exclusively.
// Any non-JSON-RPC bytes on stdout — including structured log lines from
// createLogger — cause the client (Cursor, Claude Desktop, etc.) to emit
// validation errors and drop the transport connection.
//
// The guard lives in ./stdout-guard.js so BOTH entrypoints share it: this
// binary and the `@mushi-mushi/mcp/server` export path, which importers bind
// to their own StdioServerTransport. It covers every stdout-bound console
// method (info/debug/dir/table/group*/count*/time*/trace/assert), not just
// log+warn as the previous inline patch did.
// Idempotent — ./server.js installs it at import time as well, which is what
// actually makes it run before this module body (ESM hoists imports).
import { installStdoutGuard } from './stdout-guard.js'

installStdoutGuard()
import { ALL_SCOPES, type McpScope } from './catalog.js'
import { DEFAULT_FEATURE_GROUPS, parseFeaturesCsv } from './feature-groups.js'
import { createMushiServer, createSetupModeServer } from './server.js'
import { startInventoryPoll } from './inventory-poll.js'
import { initOptionalSentry } from './optional-sentry.js'
import {
  missingApiKeyReport,
  placeholderFixLines,
  resolveStdioCredentials,
  type CliConfigSnapshot,
} from './stdio-config.js'

const require = createRequire(import.meta.url)
const VERSION = (require('../package.json') as { version: string }).version

const log = createLogger({ scope: 'mushi:mcp', level: 'info', destination: 'stderr' })

/**
 * API base URL. Falls back to the hosted Mushi Cloud endpoint — the same
 * default the CLI (`resolveCloudEndpoint`), `@mushi-mushi/node`, and the
 * VS Code extension already apply, and what the README + registry
 * server.json have documented all along ("Override only if you self-host").
 * Before this default, a zero-config `npx @mushi-mushi/mcp` booted with an
 * empty endpoint and every tool call failed.
 */
/**
 * Path the CLI writes its config to. Mirrors packages/cli/src/config.ts
 * exactly (XDG_CONFIG_HOME on EVERY platform, then %APPDATA% on win32, then
 * ~/.config) — otherwise `mushi login` writes one path and this reads another.
 */
function resolveCliConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const appData = process.env.APPDATA
  const base =
    xdg && xdg.length > 0
      ? xdg
      : process.platform === 'win32' && appData && appData.length > 0
        ? appData
        : join(homedir(), '.config')
  return join(base, 'mushi', 'config.json')
}

/**
 * Fallback credentials from the CLI's config file (`mushi login` writes it).
 * Precedence: env var → CLI config → default. Two wins:
 *   1. `mushi setup` no longer has to embed the API key in plaintext inside
 *      .cursor/mcp.json — the env block can omit it when the CLI config
 *      already holds it.
 *   2. Self-hosters who set their endpoint once via `mushi config endpoint`
 *      stop silently falling back to Mushi Cloud in the MCP server.
 * Mirrors packages/cli/src/config.ts path resolution (XDG / %APPDATA%).
 */
function readCliConfig(): CliConfigSnapshot {
  const configPath = resolveCliConfigPath()
  try {
    // Must match the CLI's resolveXdgConfigPath() precedence exactly
    // (XDG_CONFIG_HOME first on EVERY platform, then %APPDATA% on win32,
    // then ~/.config) — otherwise `mushi login` writes to one path and this
    // fallback silently reads another.
    const raw = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : undefined,
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : undefined,
      path: configPath,
      found: true,
    }
  } catch {
    return { path: configPath, found: false }
  }
}
const CLI_CONFIG = readCliConfig()

// Env → CLI config → default. An empty value (manifest configs use
// `${MUSHI_API_KEY:-}`, which expands to '' when unset) and an unexpanded
// placeholder (`${MUSHI_API_KEY}` from a client that does not expand
// variables) both fall through — neither is ever sent to the API.
const CREDENTIALS = resolveStdioCredentials(process.env, CLI_CONFIG, DEFAULT_API_ENDPOINT)
const API_ENDPOINT = CREDENTIALS.endpoint
const API_KEY = CREDENTIALS.apiKey
const PROJECT_ID = CREDENTIALS.projectId
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

/**
 * Optional error reporting for the MCP process itself. @sentry/node is an
 * optional peer: set MUSHI_MCP_SENTRY_DSN (and install @sentry/node) to
 * correlate MCP api.failed log lines (they include requestId) with host-side
 * Sentry events. Unset, the SDK is never imported. Awaited at the top level
 * so `init` runs before any tool call, as it did when the import was static.
 */
await initOptionalSentry(process.env, {
  warn: (message, meta) => log.warn(message, meta),
})

async function main() {
  if (CREDENTIALS.placeholders.length > 0 && API_KEY) {
    // A placeholder that fell through to a usable key (CLI config) still gets
    // said out loud; with no key at all, the setup-mode report below says it.
    // Written straight to stderr for the same reason as that report.
    process.stderr.write(['', ...placeholderFixLines(CREDENTIALS.placeholders), ''].join('\n'))
    log.warn('An MCP env value is an unexpanded placeholder — treated as unset.', {
      vars: CREDENTIALS.placeholders.map((p) => p.name).join(','),
    })
  }
  if (!API_KEY) {
    // Written straight to stderr: the structured logger would collapse this
    // into a single escaped-newline JSON line, which is unreadable in the
    // exact place people read it (the client's MCP log pane).
    const report = missingApiKeyReport({ env: process.env, cli: CLI_CONFIG, resolved: CREDENTIALS })
    process.stderr.write(report)
    log.warn('No API key found — serving setup mode. Set MUSHI_API_KEY, or run `mushi login`.', {
      cliConfigPath: CLI_CONFIG.path,
      cliConfigFound: CLI_CONFIG.found,
      endpoint: API_ENDPOINT,
      placeholderKey: CREDENTIALS.placeholders.some((p) => p.name === 'MUSHI_API_KEY'),
    })
    // Exiting 1 here made registry and directory installers see a dead
    // server, and agents see no tools at all. Setup mode lists the docs tools
    // and a diagnose_setup that says how to connect.
    serveUntilClosed(serveStdio(() => createSetupModeServer({ version: VERSION, missingKeyReport: report }), {
      onerror: (err) => log.error('stdio transport error', { err: String(err) }),
    }))
    return
  }
  if (CREDENTIALS.apiKeySource === 'cli-config') {
    log.info('[mushi-mcp] Using API key from the CLI config (~/.config/mushi/config.json)')
  }
  // Always show where traffic goes — IDE logs are the first place people
  // look when tools return the wrong project's data.
  log.info(`[mushi-mcp] Endpoint: ${API_ENDPOINT}`)
  const endpointFromEnv =
    !!process.env.MUSHI_API_ENDPOINT?.trim() && !CREDENTIALS.placeholders.some((p) => p.name === 'MUSHI_API_ENDPOINT')
  if (!endpointFromEnv) {
    if (CLI_CONFIG.endpoint?.trim()) {
      log.info(`[mushi-mcp] Using endpoint from CLI config: ${API_ENDPOINT}`)
    } else {
      // WARN, not info: self-hosters who miss this line send traffic to the
      // cloud and wonder why their reports never appear.
      log.warn(
        '[mushi-mcp] MUSHI_API_ENDPOINT not set — using the hosted Mushi Cloud ' +
          `endpoint (${DEFAULT_API_ENDPOINT}). Self-hosted deployments must set ` +
          'MUSHI_API_ENDPOINT to their Supabase edge function URL, ' +
          'e.g. https://xyz.supabase.co/functions/v1/api',
      )
    }
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
        'To list accessible projects, add `admin` to MUSHI_FEATURES and run `list_projects`.',
    )
  }
  log.info('Starting Mushi MCP server', {
    version: VERSION,
    mode,
    endpoint: API_ENDPOINT,
    hasProjectId: !!PROJECT_ID,
    scopes: SCOPES.join(','),
  })

  // serveStdio calls the factory lazily, once the client's opening message
  // reveals which protocol era it speaks, and pins that ONE instance for the
  // life of the connection. (It may also build and discard one instance to
  // answer a bare `server/discover` probe.) `server` therefore stays
  // undefined until a client has actually opened the session.
  let server: McpServer | undefined
  const handle = serveStdio(
    (ctx) => {
      server = createMushiServer({
        version: VERSION,
        apiEndpoint: API_ENDPOINT,
        apiKey: API_KEY,
        projectId: PROJECT_ID || undefined,
        scopes: SCOPES,
        features: FEATURES,
      })
      log.debug('[mushi-mcp] server instance created', { era: ctx.era })
      return server
    },
    {
      onerror: (err) => log.error('stdio transport error', { err: String(err) }),
    },
  )

  const lifecycle = serveUntilClosed(handle)

  // Inventory change notifications (P1.7):
  // Poll the inventory endpoint every 60 seconds and send
  // notifications/resources/updated when the `updated_at` timestamp changes.
  // This gives orchestrators (LangGraph, Claude, etc.) a push signal so they
  // can re-fetch inventory://current without constant polling.
  //
  // Only active when MUSHI_PROJECT_ID is set (single-project mode) and the
  // transport supports server-to-client notifications (all transports do).
  if (PROJECT_ID && API_ENDPOINT) {
    // Stops on its own after a 401/403 (see inventory-poll.ts).
    const poll = startInventoryPoll({
      apiEndpoint: API_ENDPOINT,
      apiKey: API_KEY,
      projectId: PROJECT_ID,
      clientVersion: VERSION,
      isShuttingDown: () => lifecycle.isShuttingDown(),
      log,
      onUpdated: async (updatedAt) => {
        // Only once a client session exists to receive it.
        if (!server) return
        await server.server.sendResourceUpdated({ uri: 'inventory://current' })
        log.info('inventory://current updated — notified subscribers', { updatedAt })
      },
    })
    lifecycle.addCleanup(() => poll.stop())
  }
}

/**
 * Graceful shutdown: real MCP clients (Cursor, Claude Desktop, …) manage
 * the child process lifecycle by killing it directly, so this path was
 * never exercised by hand-testing. External test harnesses that pipe
 * requests over stdio then close the pipe and wait for a natural exit
 * (Docker introspection checks, e.g. Glama's build test) do rely on it —
 * without an explicit stdin-EOF/signal handler the process leaks forever
 * once the inventory poll is scheduled, since a bare `setInterval` keeps
 * the event loop alive indefinitely. Shared by the normal and setup-mode
 * servers.
 */
function serveUntilClosed(handle: ReturnType<typeof serveStdio>): {
  isShuttingDown: () => boolean
  addCleanup: (fn: () => void) => void
} {
  let shuttingDown = false
  const cleanups: Array<() => void> = []
  const shutdown = (exitCode: number) => {
    if (shuttingDown) return
    shuttingDown = true
    for (const fn of cleanups) fn()
    void handle.close().finally(() => process.exit(exitCode))
  }
  // Let the crash guards close the transport instead of a bare process.exit.
  setActiveShutdown(shutdown)
  process.stdin.on('end', () => shutdown(0))
  process.stdin.on('close', () => shutdown(0))
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    // The client closed the read end mid-write (crash / kill). The JSON-RPC
    // channel is gone; exit quietly instead of dying with an unhandled EPIPE
    // stack trace on stderr.
    if (err.code === 'EPIPE') {
      shutdown(0)
      return
    }
    log.fatal('stdout write error', { err: String(err) })
    shutdown(1)
  })
  return { isShuttingDown: () => shuttingDown, addCleanup: (fn) => cleanups.push(fn) }
}

/**
 * Crash guards.
 *
 * An MCP stdio session is long-lived and expensive to lose: the client has to
 * respawn the process, re-handshake, and the agent loses whatever it was
 * doing. Node's default for an unhandled rejection is to terminate the
 * process — so one un-awaited `fetch` in one tool body, or a background poll
 * that rejects after the transport closed, took the whole session down with a
 * stack trace the user never sees (clients discard stderr on exit).
 *
 * These handlers log to stderr and keep serving. They deliberately do NOT
 * swallow genuinely fatal states: a dead stdout pipe means there is no client
 * left to serve, and a storm of repeated exceptions means the process is
 * wedged rather than merely unlucky.
 */
let activeShutdown: ((exitCode: number) => void) | undefined
const setActiveShutdown = (fn: (exitCode: number) => void) => {
  activeShutdown = fn
}
const exitNow = (code: number) => {
  if (activeShutdown) activeShutdown(code)
  else process.exit(code)
}

/** Exception-storm circuit breaker: 20 uncaught errors inside 10s = wedged. */
const CRASH_WINDOW_MS = 10_000
const CRASH_LIMIT = 20
let crashTimes: number[] = []
function isCrashLooping(): boolean {
  const now = Date.now()
  crashTimes = crashTimes.filter((t) => now - t < CRASH_WINDOW_MS)
  crashTimes.push(now)
  return crashTimes.length >= CRASH_LIMIT
}

process.on('unhandledRejection', (reason: unknown) => {
  log.error('unhandledRejection — server kept alive', {
    err: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
    stack: reason instanceof Error ? reason.stack?.split('\n').slice(0, 5).join(' | ') : undefined,
  })
  if (isCrashLooping()) {
    log.fatal('too many unhandled rejections in 10s — exiting so the client can respawn')
    exitNow(1)
  }
})

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  // No client on the other end of the pipe → nothing left to serve.
  if (
    err?.code === 'EPIPE' ||
    err?.code === 'ERR_STREAM_DESTROYED' ||
    err?.code === 'ERR_STREAM_WRITE_AFTER_END'
  ) {
    log.info('stdio pipe closed by the client — shutting down', { code: err.code })
    exitNow(0)
    return
  }
  log.error('uncaughtException — server kept alive', {
    err: `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`,
    code: err?.code,
    stack: err?.stack?.split('\n').slice(0, 5).join(' | '),
  })
  if (isCrashLooping()) {
    log.fatal('too many uncaught exceptions in 10s — exiting so the client can respawn')
    exitNow(1)
  }
})

main().catch((err) => {
  log.fatal('MCP server crashed', { err: String(err) })
  process.exit(1)
})
