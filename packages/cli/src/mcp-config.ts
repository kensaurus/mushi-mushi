/**
 * Shared helper for writing / merging MCP server entries into IDE config files.
 *
 * Unified server naming: `mushi-<slug>` where slug is derived from project name
 * (or falls back to first 8 chars of projectId). The special single-project
 * `project use` command uses `mushi` for backwards compatibility.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { CONFIG_PATH } from './config.js'
import { MUSHI_MCP_PIN_SPEC } from './version.js'

/** Lean default — mirrors DEFAULT_FEATURE_GROUPS in @mushi-mushi/mcp/feature-groups */
const DEFAULT_MUSHI_FEATURES = 'triage,fixes,inventory,setup,docs'

/** MCP clients the CLI writes config for. Each expands env references differently. */
export const MCP_CLIENTS = ['cursor', 'claude', 'continue', 'zed'] as const
export type McpClient = (typeof MCP_CLIENTS)[number]

export function isMcpClient(value: unknown): value is McpClient {
  return typeof value === 'string' && (MCP_CLIENTS as readonly string[]).includes(value)
}

/** Human name for messages ("Restart Claude Code…"). */
export const MCP_CLIENT_LABEL: Record<McpClient, string> = {
  cursor: 'Cursor',
  claude: 'Claude Code',
  continue: 'Continue',
  zed: 'Zed',
}

/** Local subprocess entry: `npx @mushi-mushi/mcp` with its env block. */
export interface StdioMcpServerEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * Hosted Streamable HTTP entry. `type` is required: Claude Code reads an entry
 * without it as a stdio server and skips it ("has a url but no type"); Cursor
 * accepts the field. Deliberately URL-only: adding a static `Authorization`
 * header tells MCP clients OAuth isn't needed and disables the browser login
 * flow. The client mints and stores its own revocable key via the consent page.
 */
export interface HostedMcpServerEntry {
  type: 'http'
  url: string
}

export type McpServerEntry = StdioMcpServerEntry | HostedMcpServerEntry

export function buildHostedMcpServerBlock(url: string): HostedMcpServerEntry {
  return { type: 'http', url }
}

export interface WriteMcpOptions {
  /** Absolute path to the IDE config file, e.g. `/repo/.cursor/mcp.json` */
  configPath: string
  /** Key to use inside `mcpServers`, e.g. `mushi-myproject` */
  serverName: string
  /** The server block to upsert */
  serverBlock: McpServerEntry
  /** If true, only log what would be written without touching the fs */
  dryRun?: boolean
}

export interface WriteMcpResult {
  created: boolean
  path: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads the existing mcp-json file (if present), merges the new server entry,
 * and writes the result back. Preserves every other key and `mcpServers` entry.
 *
 * A file that exists but does not parse is an error, not a blank slate: the
 * Claude Code target is the repo-root `.mcp.json` the whole team shares, and
 * silently replacing a file with a stray comma would delete everyone's servers.
 */
export async function writeMcpServerEntry(opts: WriteMcpOptions): Promise<WriteMcpResult> {
  const { configPath, serverName, serverBlock, dryRun = false } = opts

  // Read the existing config directly and treat a missing file as "created".
  // Deriving `created` from the read result (rather than a separate existsSync
  // pre-check) avoids a check-then-use file-system race (js/file-system-race).
  let existing: string | null = null
  try {
    existing = await readFile(configPath, 'utf8')
  } catch {
    existing = null
  }

  let merged: Record<string, unknown> = {}
  if (existing !== null && existing.trim() !== '') {
    let parsed: unknown
    try {
      parsed = JSON.parse(existing)
    } catch {
      throw new Error(`${configPath} is not valid JSON — fix or remove it, then re-run (nothing was written).`)
    }
    if (!isPlainObject(parsed)) {
      throw new Error(`${configPath} is not a JSON object — fix or remove it, then re-run (nothing was written).`)
    }
    merged = parsed
  }

  const currentServers = merged.mcpServers
  if (currentServers !== undefined && !isPlainObject(currentServers)) {
    throw new Error(`${configPath} has an "mcpServers" field that is not an object — fix it, then re-run (nothing was written).`)
  }
  merged.mcpServers = { ...(currentServers ?? {}), [serverName]: serverBlock }

  const output = JSON.stringify(merged, null, 2) + '\n'
  if (!dryRun) {
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(configPath, output, 'utf8')
  }

  return { created: existing === null, path: configPath }
}

/**
 * The `MUSHI_API_KEY` env value to write for a client when the literal key is
 * kept out of the file, or `null` to leave the variable out entirely.
 *
 * - cursor: `${env:MUSHI_API_KEY}` — the only env interpolation form Cursor
 *   documents. A bare `${MUSHI_API_KEY}` is not in that list, so the literal
 *   text could reach the server as the key.
 * - claude: `${MUSHI_API_KEY:-}` — Claude Code keeps an unset `${VAR}` as
 *   literal text; the empty default expands to "" instead, and
 *   @mushi-mushi/mcp treats an empty key as unset and reads the CLI config.
 * - continue / zed: no documented expansion, so any placeholder would be sent
 *   verbatim. Omit the variable; the server falls back to the key `mushi
 *   login` saved in the CLI config.
 */
export function apiKeyPlaceholderFor(client: McpClient): string | null {
  switch (client) {
    case 'cursor':
      return '${env:MUSHI_API_KEY}'
    case 'claude':
      return '${MUSHI_API_KEY:-}'
    case 'continue':
    case 'zed':
      return null
  }
}

/**
 * Build a canonical stdio `mcpServers` block for the Mushi MCP server.
 *
 * @param opts.client - The MCP client that will read the file; picks the env
 *   placeholder syntax (see {@link apiKeyPlaceholderFor}).
 * @param opts.inlineKey - When true, the literal API key is written into the
 *   env block (headless/CI clients that do no substitution — keep the file out
 *   of git). By default no secret is written and the file is safe to commit.
 */
export function buildMcpServerBlock(opts: {
  endpoint: string
  projectId: string
  apiKey: string
  client: McpClient
  /** Write the literal key into env (default false → client placeholder or none). */
  inlineKey?: boolean
}): StdioMcpServerEntry {
  const keyValue = opts.inlineKey ? opts.apiKey : apiKeyPlaceholderFor(opts.client)
  return {
    command: 'npx',
    args: ['-y', MUSHI_MCP_PIN_SPEC],
    env: {
      MUSHI_API_ENDPOINT: opts.endpoint,
      MUSHI_PROJECT_ID: opts.projectId,
      ...(keyValue !== null ? { MUSHI_API_KEY: keyValue } : {}),
      MUSHI_FEATURES: DEFAULT_MUSHI_FEATURES,
    },
  }
}

/**
 * Explain where the MCP server gets its key when `inlineKey` is false. The
 * key itself is never printed: the server already falls back to the CLI
 * config, so exporting it is an optional override, not a required step.
 */
export function printKeyExportHint(client: McpClient, configPath: string = CONFIG_PATH): void {
  console.log('')
  console.log('  No API key was written into the MCP config (safe to commit).')
  console.log(`  The MCP server uses the key \`mushi login\` saved in ${configPath}.`)
  if (apiKeyPlaceholderFor(client) !== null) {
    console.log(`  To use a different key, export MUSHI_API_KEY in the environment ${MCP_CLIENT_LABEL[client]} is launched from.`)
  }
  console.log('  To write the key into the file instead (keep it out of git), re-run with --inline-key.')
}

/**
 * Derive the canonical server name for an entry in `mcpServers`.
 *
 * When `projectName` is given, slugify it (lowercase, hyphens, max 24 chars).
 * Otherwise fall back to `mushi-<first-8-of-projectId>`.
 *
 * For the `project use` single-project path, pass `legacy: true` to get the
 * bare `mushi` key for backwards compatibility with existing Cursor configs.
 */
export function buildMcpServerName(opts: {
  projectId?: string
  projectName?: string
  legacy?: boolean
}): string {
  if (opts.legacy) return 'mushi'
  if (opts.projectName) {
    const slug = opts.projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24)
    return `mushi-${slug}`
  }
  return `mushi-${(opts.projectId ?? 'unknown').slice(0, 8)}`
}
