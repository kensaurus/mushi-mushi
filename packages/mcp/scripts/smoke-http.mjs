#!/usr/bin/env node
/**
 * Smoke test for hosted HTTP MCP — lists tools and validates count vs catalog.
 *
 * Env (never log values):
 *   MUSHI_MCP_HTTP_URL — e.g. https://xyz.supabase.co/functions/v1/mcp
 *   MUSHI_MCP_API_KEY  — project API key with mcp:read
 *
 * Run: node packages/mcp/scripts/smoke-http.mjs
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')

function extractHostedToolCount() {
  const hostedContent = readFileSync(resolve(ROOT, 'packages/server/supabase/functions/mcp/index.ts'), 'utf8')
  const manifest = JSON.parse(
    readFileSync(resolve(ROOT, 'packages/server/supabase/functions/mcp/hosted-tool-manifest.json'), 'utf8'),
  )
  const names = new Set(Object.keys(manifest))
  const toolsSection =
    hostedContent.split('const BASE_TOOLS')[1]?.split('/** Full catalog')[0] ?? ''
  for (const line of toolsSection.split('\n')) {
    const nameMatch = line.match(/^  ([a-z_]+):\s*\{/)
    if (nameMatch) names.add(nameMatch[1])
  }
  return names.size
}

const url = process.env.MUSHI_MCP_HTTP_URL
const apiKey = process.env.MUSHI_MCP_API_KEY

if (!url || !apiKey) {
  console.error('SKIP smoke-http: set MUSHI_MCP_HTTP_URL and MUSHI_MCP_API_KEY')
  process.exit(0)
}

const initRes = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-Mushi-Api-Key': apiKey,
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke-http', version: '1.0.0' } },
  }),
})

if (!initRes.ok) {
  console.error(`FAIL initialize HTTP ${initRes.status}`)
  process.exit(1)
}

const listRes = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-Mushi-Api-Key': apiKey,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
})

const listBody = await listRes.json()
const tools = listBody?.result?.tools ?? listBody?.tools ?? []
const expected = extractHostedToolCount()

console.log(`HTTP MCP tools/list: ${tools.length} tools (expected ${expected})`)
if (tools.length < expected) {
  console.error('FAIL — hosted tool count below catalog')
  process.exit(1)
}

console.log('OK — smoke-http passed')
