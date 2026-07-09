/**
 * Shared helper for writing / merging MCP server entries into IDE config files.
 *
 * Unified server naming: `mushi-<slug>` where slug is derived from project name
 * (or falls back to first 8 chars of projectId). The special single-project
 * `project use` command uses `mushi` for backwards compatibility.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { MUSHI_MCP_PIN_SPEC } from './version.js'

/** Lean default — mirrors DEFAULT_FEATURE_GROUPS in @mushi-mushi/mcp/feature-groups */
const DEFAULT_MUSHI_FEATURES = 'triage,fixes,inventory,setup,docs'

export type McpServerEntry =
  | {
      command: string
      args: string[]
      env: Record<string, string>
    }
  /**
   * Hosted Streamable HTTP entry. Deliberately URL-only: adding a static
   * `Authorization` header tells MCP clients OAuth isn't needed and disables
   * the browser login flow. The client mints and stores its own revocable
   * key via the consent page.
   */
  | { url: string }

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

/**
 * Reads the existing mcp-json file (if present), merges the new server entry,
 * and writes the result back. Preserves all other `mcpServers` entries.
 */
export async function writeMcpServerEntry(opts: WriteMcpOptions): Promise<WriteMcpResult> {
  const { configPath, serverName, serverBlock, dryRun = false } = opts

  // Read the existing config directly and treat a missing file as "created".
  // Deriving `created` from the read result (rather than a separate existsSync
  // pre-check) avoids a check-then-use file-system race (js/file-system-race).
  let merged: Record<string, unknown> = { mcpServers: {} }
  let created = false
  try {
    const existing = await readFile(configPath, 'utf8')
    try {
      merged = JSON.parse(existing) as Record<string, unknown>
    } catch {
      merged = { mcpServers: {} }
    }
  } catch {
    created = true
    merged = { mcpServers: {} }
  }

  const servers = (merged.mcpServers as Record<string, unknown>) ?? {}
  servers[serverName] = serverBlock
  merged.mcpServers = servers

  const output = JSON.stringify(merged, null, 2) + '\n'
  if (!dryRun) {
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(configPath, output, 'utf8')
  }

  return { created, path: configPath }
}

/**
 * Build a canonical `mcpServers` block for the Mushi MCP server.
 */
export function buildMcpServerBlock(opts: {
  endpoint: string
  projectId: string
  apiKey: string
}): McpServerEntry {
  return {
    command: 'npx',
    args: ['-y', MUSHI_MCP_PIN_SPEC],
    env: {
      MUSHI_API_ENDPOINT: opts.endpoint,
      MUSHI_PROJECT_ID: opts.projectId,
      MUSHI_API_KEY: opts.apiKey,
      MUSHI_FEATURES: DEFAULT_MUSHI_FEATURES,
    },
  }
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
