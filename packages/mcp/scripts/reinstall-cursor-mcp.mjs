#!/usr/bin/env node
/**
 * Update ~/.cursor/mcp.json mushi entry → stdio (local dist) without printing secrets.
 * Usage: node packages/mcp/scripts/reinstall-cursor-mcp.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MCP_JSON = join(homedir(), '.cursor', 'mcp.json')
const DIST = resolve(__dirname, '..', 'dist', 'index.js')
const API_ENDPOINT = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'
const ICON = 'https://kensaur.us/mushi-mushi/integrations/mushi-mark-512.png'
const FEATURES = 'triage,fixes,inventory,setup,docs'

const raw = readFileSync(MCP_JSON, 'utf8')
const cfg = JSON.parse(raw)
const prev = cfg.mcpServers?.mushi ?? {}

let apiKey =
  prev.env?.MUSHI_API_KEY ??
  prev.headers?.['X-Mushi-Api-Key'] ??
  prev.headers?.Authorization?.replace(/^Bearer\s+/i, '')
let projectId =
  prev.env?.MUSHI_PROJECT_ID ??
  prev.headers?.['X-Mushi-Project-Id']

if (!apiKey || !projectId) {
  console.error('FAIL: could not read MUSHI_API_KEY / MUSHI_PROJECT_ID from existing mushi block')
  process.exit(1)
}

cfg.mcpServers = cfg.mcpServers ?? {}
cfg.mcpServers.mushi = {
  command: 'node',
  args: [DIST.replace(/\\/g, '/')],
  env: {
    MUSHI_API_ENDPOINT: API_ENDPOINT,
    MUSHI_API_KEY: apiKey,
    MUSHI_PROJECT_ID: projectId,
    MUSHI_FEATURES: FEATURES,
  },
  icon: ICON,
}

writeFileSync(MCP_JSON, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
console.log('OK: ~/.cursor/mcp.json mushi → stdio (local dist)')
console.log('   transport: stdio')
console.log('   features:', FEATURES)
console.log('   icon:', ICON)
console.log('   project:', projectId.slice(0, 8) + '…')
console.log('   binary:', DIST)
