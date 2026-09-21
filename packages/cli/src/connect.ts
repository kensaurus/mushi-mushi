/**
 * `mushi connect` — save credentials, optionally write env vars, wire IDE MCP,
 * and poll until the SDK heartbeat lands on the configured backend.
 */

import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CliConfig } from './config.js'
import { CONFIG_PATH, saveConfig, savedSdkKeyFor } from './config.js'
import { assertEndpoint } from './endpoint.js'
import { requireUuid } from './cli-shared.js'
import { detectFramework, envVarsToWrite, readPackageJson } from './detect.js'
import { waitForIngestReady } from './heartbeat-wait.js'
import { describeUnsafeSdkKey, probeKeyScope, type ProbeKeyScope } from './key-scopes.js'
import { buildMcpServerBlock, buildMcpServerName, writeMcpServerEntry } from './mcp-config.js'

export interface ConnectOptions {
  /** Private CLI key: saved to the CLI config and used for the heartbeat poll. */
  apiKey: string
  /**
   * Ingest-only (report:write) key for the SDK env vars. Falls back to the
   * key saved for this project, then to `apiKey` — whichever is used must
   * prove it is ingest-only before it is written, because SDK env vars ship
   * inside the app bundle.
   */
  sdkKey?: string
  projectId: string
  endpoint: string
  cwd?: string
  /** Write MUSHI_* / VITE_* env lines to .env.local (merge, never overwrite keys). */
  writeEnv?: boolean
  /** Run mushi setup --ide cursor after saving config. */
  wireIde?: boolean
  /** Poll ingest-setup until sdk_installed is true. */
  wait?: boolean
  waitTimeoutSec?: number
  json?: boolean
  /** Test seam for the key-scope probe. */
  probeKeyScope?: ProbeKeyScope
}

export type SdkEnvKeyResolution =
  | { ok: true; key: string }
  | { ok: false; reason: string }

/**
 * Choose the key for the SDK env vars and prove it cannot read. Candidates in
 * order: an explicit --sdk-key, the ingest key saved for this project, the
 * CLI key itself (fine only when it happens to be ingest-only, e.g. a key
 * minted in the console). Anything the probe cannot confirm is refused.
 */
export async function resolveSdkEnvKey(opts: {
  sdkKey?: string
  apiKey: string
  projectId: string
  endpoint: string
  baseConfig: CliConfig
  probe: ProbeKeyScope
}): Promise<SdkEnvKeyResolution> {
  const candidate = opts.sdkKey ?? savedSdkKeyFor(opts.baseConfig, opts.projectId) ?? opts.apiKey
  const probe = await opts.probe(opts.endpoint, candidate, opts.projectId)
  if (probe.result === 'ingest-only') return { ok: true, key: candidate }
  return { ok: false, reason: describeUnsafeSdkKey(probe, opts.endpoint) }
}

export interface ConnectResult {
  ok: boolean
  envPath: string | null
  mcpPath: string | null
  heartbeat: Awaited<ReturnType<typeof waitForIngestReady>> | null
  messages: string[]
}

function envKeyPresent(content: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}=`, 'm').test(content)
}

/** Returns true when any lines were written (existing keys are never overwritten). */
async function mergeEnvFile(path: string, lines: string[]): Promise<boolean> {
  const block = `\n# Mushi — added by mushi connect\n${lines.join('\n')}\n`
  let existing: string | null = null
  try { existing = await readFile(path, 'utf8') } catch { /* file does not exist yet */ }
  if (existing !== null) {
    const needs = lines.filter((line) => {
      const key = line.split('=')[0]
      return !envKeyPresent(existing!, key)
    })
    if (needs.length === 0) return false
    await appendFile(path, `\n# Mushi — added by mushi connect\n${needs.join('\n')}\n`, 'utf8')
    return true
  }
  await writeFile(path, block, 'utf8')
  return true
}

export async function runConnect(
  opts: ConnectOptions,
  baseConfig: CliConfig = {},
): Promise<ConnectResult> {
  const cwd = resolve(opts.cwd ?? process.cwd())
  const endpoint = assertEndpoint(opts.endpoint)
  const projectId = requireUuid(opts.projectId, 'projectId')
  const messages: string[] = []

  const writeEnv = opts.writeEnv !== false
  const sdkEnvKey = writeEnv
    ? await resolveSdkEnvKey({
        sdkKey: opts.sdkKey,
        apiKey: opts.apiKey,
        projectId,
        endpoint,
        baseConfig,
        probe: opts.probeKeyScope ?? probeKeyScope,
      })
    : null

  const config: CliConfig = {
    ...baseConfig,
    apiKey: opts.apiKey,
    projectId,
    endpoint,
    ...(sdkEnvKey?.ok ? { sdkKey: { projectId, key: sdkEnvKey.key } } : {}),
  }
  saveConfig(config)
  messages.push(`✓ Credentials saved to ${CONFIG_PATH}`)

  let envPath: string | null = null
  let envRefused = false
  if (sdkEnvKey && !sdkEnvKey.ok) {
    envRefused = true
    messages.push(
      `✗ Did not write SDK env vars: ${sdkEnvKey.reason}. ` +
        'Pass an ingest-only key with --sdk-key <key> (console → Projects → API keys, scope report:write), ' +
        'or run `npx mushi-mushi`, which mints one.',
    )
  } else if (sdkEnvKey?.ok) {
    const pkg = readPackageJson(cwd)
    const framework = detectFramework(cwd, pkg)
    const lines = envVarsToWrite(sdkEnvKey.key, projectId, framework).split('\n')
    envPath = join(cwd, '.env.local')
    const wrote = await mergeEnvFile(envPath, lines)
    messages.push(
      wrote
        ? `✓ Env vars merged into ${envPath}`
        : `✓ Env vars already present in ${envPath} (existing values left untouched)`,
    )
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
    if (deps['@capacitor/core'] && deps['react']) {
      messages.push(
        'ℹ Capacitor + React detected — install @mushi-mushi/web (or @mushi-mushi/react) and call initMushi() in main.tsx. ' +
          'Optional @mushi-mushi/capacitor for native shell parity.',
      )
    }
  }

  let mcpPath: string | null = null
  if (opts.wireIde !== false) {
    const mcpDir = join(cwd, '.cursor')
    mcpPath = join(mcpDir, 'mcp.json')
    const serverName = buildMcpServerName({ projectId })
    const serverBlock = buildMcpServerBlock({
      endpoint,
      projectId,
      apiKey: opts.apiKey,
      client: 'cursor',
      inlineKey: false, // no secret in the file; the MCP server reads the saved CLI key
    })
    // No .gitignore entry: the block carries a placeholder, not the key, so
    // the file is safe to commit and share.
    await writeMcpServerEntry({ configPath: mcpPath, serverName, serverBlock })
    messages.push(`✓ Wired ${mcpPath} — restart Cursor and run "list mushi tools"`)
    messages.push(`  The MCP server reads the key saved in ${CONFIG_PATH} (export MUSHI_API_KEY before launching Cursor to override it).`)
  }

  let heartbeat: ConnectResult['heartbeat'] = null
  if (opts.wait) {
    const timeoutSec = opts.waitTimeoutSec ?? 120
    const maxAttempts = Math.max(1, Math.ceil((timeoutSec * 1000) / 3000))
    messages.push(`… Waiting for SDK heartbeat (up to ${timeoutSec}s) — start your dev server with the snippet installed`)
    heartbeat = await waitForIngestReady({
      endpoint,
      apiKey: opts.apiKey,
      projectId,
      maxAttempts,
      onPoll: (payload, attempt) => {
        if (!opts.json && attempt % 3 === 0) {
          const sdk = payload.steps.find((s) => s.id === 'sdk_installed')
          const seen = payload.diagnostic?.last_sdk_seen_at ?? 'never'
          process.stdout.write(`  poll ${attempt}: sdk_installed=${sdk?.complete ? 'yes' : 'no'} last_seen=${seen}\n`)
        }
      },
    })
    if (heartbeat.ok) {
      const label =
        heartbeat.reason === 'heartbeat'
          ? 'SDK heartbeat detected'
          : 'Ingest setup complete'
      messages.push(`✓ ${label} — ingest pipeline is live`)
    } else if (heartbeat.reason === 'unauthorized') {
      messages.push(
        `✗ The backend rejected these credentials (${heartbeat.error ?? 'auth error'}). ` +
          'Double-check --api-key, --project-id, and --endpoint, then re-run `mushi connect --wait`.',
      )
    } else {
      messages.push(
        `✗ No heartbeat before timeout (${heartbeat.reason}). ` +
          'Confirm env vars are in your build, restart the dev server, then re-run `mushi connect --wait`.',
      )
    }
  }

  const ok = !envRefused && (!opts.wait || Boolean(heartbeat?.ok))
  return { ok, envPath, mcpPath, heartbeat, messages }
}
