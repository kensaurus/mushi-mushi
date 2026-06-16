#!/usr/bin/env node
/**
 * Smoke test for MCP logging bundle — hosted HTTP MCP + API access logs.
 * Reads credentials from ~/.cursor/mcp.json (never prints secrets).
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1'
const REQUEST_ID = `qa-${Date.now().toString(36)}`

function loadMushiEnv() {
  const raw = readFileSync(join(homedir(), '.cursor', 'mcp.json'), 'utf8')
  const env = JSON.parse(raw).mcpServers?.mushi?.env ?? {}
  if (!env.MUSHI_API_KEY || !env.MUSHI_PROJECT_ID) {
    throw new Error('Missing MUSHI_API_KEY or MUSHI_PROJECT_ID in ~/.cursor/mcp.json')
  }
  return env
}

async function main() {
  const { MUSHI_API_KEY, MUSHI_PROJECT_ID } = loadMushiEnv()
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${MUSHI_API_KEY}`,
    'X-Mushi-Api-Key': MUSHI_API_KEY,
    'X-Mushi-Project-Id': MUSHI_PROJECT_ID,
    'X-Request-Id': REQUEST_ID,
  }

  console.log('=== 1. API health (access log + X-Request-Id) ===')
  const health = await fetch(`${BASE}/api/health`, { headers })
  console.log(`health: ${health.status} X-Request-Id: ${health.headers.get('x-request-id') ?? '(none)'}`)

  console.log('\n=== 2. Hosted MCP tools/list ===')
  const listRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  const listBody = await listRes.json()
  const toolCount = listBody.result?.tools?.length ?? 0
  console.log(`tools/list: ${listRes.status} tools=${toolCount} error=${listBody.error?.message ?? 'none'}`)

  console.log('\n=== 3. Hosted MCP tools/call get_recent_reports ===')
  const callRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_recent_reports',
        arguments: { limit: 3 },
      },
    }),
  })
  const callBody = await callRes.json()
  const reports = callBody.result?.structuredContent?.total ?? callBody.result?.content?.[0]?.text?.slice(0, 80)
  console.log(`tools/call: ${callRes.status} ok=${!callBody.error} preview=${JSON.stringify(reports).slice(0, 120)}`)

  console.log('\n=== 4. Hosted MCP tools/call diagnose_setup (ingest) ===')
  const diagRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'diagnose_setup',
        arguments: { mode: 'ingest' },
      },
    }),
  })
  const diagBody = await diagRes.json()
  const hasStructured = !!diagBody.result?.structuredContent
  const diagReady = diagBody.result?.structuredContent?.ready
  console.log(
    `diagnose_setup: ${diagRes.status} structured=${hasStructured} ready=${diagReady} error=${diagBody.error?.message ?? 'none'}`,
  )

  console.log('\n=== 5. MCP logs endpoint (service=mcp) ===')
  const logsRes = await fetch(
    `${BASE}/api/v1/admin/mcp/logs/${MUSHI_PROJECT_ID}?service=mcp&limit=5`,
    { headers },
  )
  const logsBody = await logsRes.json()
  const entries = logsBody.data?.entries ?? []
  console.log(`mcp/logs: ${logsRes.status} entries=${entries.length}`)
  for (const e of entries.slice(0, 3)) {
    console.log(`  - [${e.level}] ${e.message} (${e.ts})`)
  }

  const failed =
    health.status !== 200 ||
    listRes.status >= 400 ||
    callRes.status >= 400 ||
    callBody.error ||
    diagRes.status >= 400 ||
    diagBody.error ||
    !hasStructured ||
    logsRes.status >= 400

  console.log(failed ? '\nFAIL' : '\nPASS')
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
