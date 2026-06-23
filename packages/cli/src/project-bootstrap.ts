/**
 * FILE: project-bootstrap.ts
 * PURPOSE: Shared local file writes after browser project bootstrap (env + MCP).
 */
import { writeFile } from 'node:fs/promises'
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
  const envLines = [
    '# Mushi MCP — drop into .env.local (gitignored). The MCP binary picks these up on spawn.',
    `MUSHI_API_ENDPOINT=${opts.endpoint}`,
    `MUSHI_PROJECT_ID=${opts.projectId}`,
    `MUSHI_API_KEY=${opts.apiKey}`,
    '',
  ]
  const envUpdated = existsSync(envPath)
  await writeFile(envPath, envLines.join('\n'), 'utf8')

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
