/**
 * FILE: project-bootstrap.ts
 * PURPOSE: Shared local file writes after browser project bootstrap (env + MCP).
 */
import { writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import nodePath from 'node:path'
import { buildMcpServerBlock, buildMcpServerName, writeMcpServerEntry } from './mcp-config.js'

export interface ProjectBootstrapFilesResult {
  envUpdated: boolean
  mcpUpdated: boolean
}

/** Write `.env.local` and `.cursor/mcp.json` for a freshly minted project key. */
export async function writeProjectBootstrapFiles(opts: {
  cwd?: string
  endpoint: string
  projectId: string
  apiKey: string
}): Promise<ProjectBootstrapFilesResult> {
  const cwd = opts.cwd ?? process.cwd()
  const envPath = nodePath.join(cwd, '.env.local')
  const mushiBlock = [
    '# Mushi MCP — drop into .env.local (gitignored). The MCP binary picks these up on spawn.',
    `MUSHI_API_ENDPOINT=${opts.endpoint}`,
    `MUSHI_PROJECT_ID=${opts.projectId}`,
    `MUSHI_API_KEY=${opts.apiKey}`,
  ].join('\n')

  // Merge — never clobber. A vibe-coder running `mushi project create` inside an
  // existing app must keep every other var (DATABASE_URL, NEXT_PUBLIC_*, Stripe
  // keys, …). Read the existing file, strip only prior MUSHI_* lines (bare and
  // framework-prefixed) plus our own comment, then append a fresh Mushi block.
  // Mirrors the strip logic in init.ts so a re-run is idempotent.
  const envUpdated = existsSync(envPath)
  const existing = envUpdated ? await readFile(envPath, 'utf8') : ''
  const MUSHI_LINE_RE = /^(NEXT_PUBLIC_|NUXT_PUBLIC_|VITE_|EXPO_PUBLIC_)?MUSHI_[A-Z_]+=.*/gm
  const MUSHI_COMMENT_RE = /^# Mushi MCP\b.*/gm
  const stripped = existing
    .replace(MUSHI_LINE_RE, '')
    .replace(MUSHI_COMMENT_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  const prefix = stripped.length > 0 ? `${stripped}\n\n` : ''
  await writeFile(envPath, `${prefix}${mushiBlock}\n`, 'utf8')

  const mcpPath = nodePath.join(cwd, '.cursor', 'mcp.json')
  const serverName = buildMcpServerName({ legacy: true })
  const serverBlock = buildMcpServerBlock({
    endpoint: opts.endpoint,
    projectId: opts.projectId,
    apiKey: opts.apiKey,
  })
  const { created: mcpCreated } = await writeMcpServerEntry({
    configPath: mcpPath,
    serverName,
    serverBlock,
  })

  return { envUpdated, mcpUpdated: !mcpCreated }
}
