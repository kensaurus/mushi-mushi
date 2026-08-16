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
import { createMushiServer } from './server.js'
import * as Sentry from '@sentry/node'

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
function readCliConfig(): {
  apiKey?: string
  projectId?: string
  endpoint?: string
  /** Absolute path we looked at — quoted verbatim in the no-key diagnostic. */
  path: string
  /** True when the file existed and parsed (it may still lack an apiKey). */
  found: boolean
} {
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

const API_ENDPOINT =
  process.env.MUSHI_API_ENDPOINT?.trim() || CLI_CONFIG.endpoint?.trim() || DEFAULT_API_ENDPOINT
// `||` (not `??`): manifest configs use `${MUSHI_API_KEY:-}` expansion, which
// yields an EMPTY string when the env var is unset — that must still fall
// through to the CLI config, not mask it.
const API_KEY = process.env.MUSHI_API_KEY?.trim() || CLI_CONFIG.apiKey || ''
const PROJECT_ID = process.env.MUSHI_PROJECT_ID?.trim() || CLI_CONFIG.projectId || ''
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

/**
 * Everything an operator needs to fix a missing key, printed as one block on
 * stderr. The old one-liner named MUSHI_API_KEY and `mushi login` but never
 * said WHICH file was checked or WHERE the env block lives, so the common
 * failures — config written under a different XDG root, a key set in the
 * shell instead of the MCP client's `env` block, a file present but without
 * an `apiKey` field — all looked identical from the client's log pane.
 */
function missingApiKeyReport(): string {
  const envState = process.env.MUSHI_API_KEY === undefined
    ? 'not set'
    : process.env.MUSHI_API_KEY.trim() === ''
      ? 'set but empty'
      : 'set'
  const cliState = !CLI_CONFIG.found
    ? 'no file at this path'
    : CLI_CONFIG.apiKey
      ? 'present'
      : 'file exists but has no "apiKey" field'
  return [
    '',
    '[mushi-mcp] FATAL: no API key — the MCP server cannot serve a single tool call.',
    '',
    '  Sources checked, in precedence order:',
    `    1. env MUSHI_API_KEY        → ${envState}`,
    `    2. CLI config file          → ${cliState}`,
    `       ${CLI_CONFIG.path}`,
    '',
    '  Fix either one:',
    '    • Run `mushi login` (writes the config file above), or',
    '    • Add the key to the "env" block of your MCP client config',
    '      (.cursor/mcp.json · claude_desktop_config.json · .vscode/mcp.json):',
    '',
    '        { "mcpServers": { "mushi-mushi": {',
    '            "command": "npx", "args": ["-y", "@mushi-mushi/mcp"],',
    '            "env": { "MUSHI_API_KEY": "mushi_…", "MUSHI_PROJECT_ID": "<uuid>" } } } }',
    '',
    '      A key exported in your shell does NOT reach the server: MCP clients',
    '      spawn this process with only the env block they are given.',
    '',
    '  Other env vars this server reads:',
    `    MUSHI_API_ENDPOINT  ${process.env.MUSHI_API_ENDPOINT?.trim() ? '= ' + process.env.MUSHI_API_ENDPOINT.trim() : `unset → ${API_ENDPOINT}`}`,
    `    MUSHI_PROJECT_ID    ${PROJECT_ID ? '= ' + PROJECT_ID : 'unset (account mode)'}`,
    '    MUSHI_SCOPES        optional CSV: mcp:read,mcp:write',
    '    MUSHI_FEATURES      optional CSV of tool groups, or "all"',
    '    MUSHI_MCP_TIMEOUT_MS  optional per-request timeout in ms (default 15000)',
    '',
    '  Mint a key: Console → Settings → API keys.',
    '',
  ].join('\n')
}

async function main() {
  if (!API_KEY) {
    // Written straight to stderr: the structured logger would collapse this
    // into a single escaped-newline JSON line, which is unreadable in the
    // exact place people read it (the client's MCP log pane).
    process.stderr.write(missingApiKeyReport())
    log.fatal('No API key found — set MUSHI_API_KEY, or run `mushi login`.', {
      cliConfigPath: CLI_CONFIG.path,
      cliConfigFound: CLI_CONFIG.found,
      endpoint: API_ENDPOINT,
    })
    process.exit(1)
  }
  if (!process.env.MUSHI_API_KEY && CLI_CONFIG.apiKey) {
    log.info('[mushi-mcp] Using API key from the CLI config (~/.config/mushi/config.json)')
  }
  // Always show where traffic goes — IDE logs are the first place people
  // look when tools return the wrong project's data.
  log.info(`[mushi-mcp] Endpoint: ${API_ENDPOINT}`)
  if (!process.env.MUSHI_API_ENDPOINT?.trim()) {
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
        'Run `get_account_overview` to see accessible projects.',
    )
  }
  log.info('Starting Mushi MCP server', {
    version: VERSION,
    mode,
    endpoint: API_ENDPOINT,
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
