/**
 * `mushi connect` — save credentials, optionally write env vars, wire IDE MCP,
 * and poll until the SDK heartbeat lands on the configured backend.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CliConfig } from './config.js'
import { CONFIG_PATH, saveConfig } from './config.js'
import { assertEndpoint } from './endpoint.js'
import { detectFramework, envVarsToWrite, readPackageJson } from './detect.js'
import { waitForIngestReady } from './heartbeat-wait.js'

export interface ConnectOptions {
  apiKey: string
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

/** Ensure .cursor/mcp.json (contains API keys) is not committed. */
async function ensureMcpJsonGitignored(cwd: string, messages: string[]): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore')
  const patterns = ['.cursor/mcp.json', '.cursor/']
  let content: string | null = null
  try { content = await readFile(gitignorePath, 'utf8') } catch { /* no .gitignore */ }
  if (content === null) {
    messages.push(
      '⚠ No .gitignore found — .cursor/mcp.json contains your API key. Add `.cursor/mcp.json` before committing.',
    )
    return
  }
  const covered = patterns.some((p) => content!.split('\n').some((line) => line.trim() === p || line.trim() === `${p}/`))
  if (covered) return
  await appendFile(gitignorePath, '\n# Mushi — keep MCP credentials out of git\n.cursor/mcp.json\n', 'utf8')
  messages.push('✓ Added .cursor/mcp.json to .gitignore (contains API key)')
}

export async function runConnect(
  opts: ConnectOptions,
  baseConfig: CliConfig = {},
): Promise<ConnectResult> {
  const cwd = resolve(opts.cwd ?? process.cwd())
  const endpoint = assertEndpoint(opts.endpoint)
  const messages: string[] = []

  const config: CliConfig = {
    ...baseConfig,
    apiKey: opts.apiKey,
    projectId: opts.projectId,
    endpoint,
  }
  saveConfig(config)
  messages.push(`✓ Credentials saved to ${CONFIG_PATH}`)

  let envPath: string | null = null
  if (opts.writeEnv !== false) {
    const pkg = readPackageJson(cwd)
    const framework = detectFramework(cwd, pkg)
    const lines = envVarsToWrite(opts.apiKey, opts.projectId, framework).split('\n')
    envPath = join(cwd, '.env.local')
    const wrote = await mergeEnvFile(envPath, lines)
    messages.push(
      wrote
        ? `✓ Env vars merged into ${envPath}`
        : `✓ Env vars already present in ${envPath} (existing values left untouched)`,
    )
  }

  let mcpPath: string | null = null
  if (opts.wireIde !== false) {
    const mcpDir = join(cwd, '.cursor')
    mcpPath = join(mcpDir, 'mcp.json')
    const serverName = `mushi-${opts.projectId.slice(0, 8)}`
    const mcpServerBlock = {
      command: 'npx',
      args: ['-y', '@mushi-mushi/mcp@latest'],
      env: {
        MUSHI_API_ENDPOINT: endpoint,
        MUSHI_PROJECT_ID: opts.projectId,
        MUSHI_API_KEY: opts.apiKey,
      },
    }
    let merged: Record<string, unknown> = { mcpServers: {} }
    try {
      merged = JSON.parse(await readFile(mcpPath, 'utf8')) as Record<string, unknown>
    } catch { /* fresh or unreadable — start with empty config */ }
    const servers = (merged.mcpServers as Record<string, unknown>) ?? {}
    servers[serverName] = mcpServerBlock
    merged.mcpServers = servers
    await mkdir(mcpDir, { recursive: true })
    await writeFile(mcpPath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
    await ensureMcpJsonGitignored(cwd, messages)
    messages.push(`✓ Wired ${mcpPath} — restart Cursor and run "list mushi tools"`)
  }

  let heartbeat: ConnectResult['heartbeat'] = null
  if (opts.wait) {
    const timeoutSec = opts.waitTimeoutSec ?? 120
    const maxAttempts = Math.max(1, Math.ceil((timeoutSec * 1000) / 3000))
    messages.push(`… Waiting for SDK heartbeat (up to ${timeoutSec}s) — start your dev server with the snippet installed`)
    heartbeat = await waitForIngestReady({
      endpoint,
      apiKey: opts.apiKey,
      projectId: opts.projectId,
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

  const ok = !opts.wait || Boolean(heartbeat?.ok)
  return { ok, envPath, mcpPath, heartbeat, messages }
}
