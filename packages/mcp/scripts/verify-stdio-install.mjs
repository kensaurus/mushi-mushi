#!/usr/bin/env node
/**
 * End-to-end verify of the stdio MCP install (same shape as ~/.cursor/mcp.json).
 * Never prints API keys.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const MCP_JSON = join(homedir(), '.cursor', 'mcp.json')
const cfg = JSON.parse(readFileSync(MCP_JSON, 'utf8'))
const mushi = cfg.mcpServers?.mushi
if (!mushi?.command) {
  console.error('FAIL: mushi is not stdio in mcp.json')
  process.exit(1)
}

const transport = new StdioClientTransport({
  command: mushi.command,
  args: mushi.args,
  env: { ...process.env, ...mushi.env },
})

const client = new Client({ name: 'verify-install', version: '1.0.0' }, { capabilities: {} })
let failed = 0
function fail(msg) {
  console.error('FAIL:', msg)
  failed++
}

try {
  await client.connect(transport)

  const { tools } = await client.listTools()
  const { resources } = await client.listResources()

  console.log('── Handshake / catalog ──')
  console.log('   tools:', tools.length)
  console.log('   resources:', resources.length)
  console.log('   icon in mcp.json:', mushi.icon ? 'yes' : 'no')
  console.log('   MUSHI_FEATURES:', mushi.env?.MUSHI_FEATURES ?? '(unset → all)')

  const expectedLean = ['get_recent_reports', 'diagnose_setup', 'search_mushi_docs', 'dispatch_fix']
  const hiddenLegacy = ['setup_check', 'ingest_setup_check']
  for (const n of expectedLean) {
    if (!tools.some((t) => t.name === n)) fail(`missing expected tool: ${n}`)
  }
  for (const n of hiddenLegacy) {
    if (tools.some((t) => t.name === n)) fail(`legacy tool should be hidden: ${n}`)
  }

  const resourceAsTool = ['project_stats', 'inventory_current']
  for (const n of resourceAsTool) {
    if (tools.some((t) => t.name === n)) fail(`resource should not be duplicated as tool on stdio: ${n}`)
    if (!resources.some((r) => r.name === n)) fail(`missing resource: ${n}`)
  }

  console.log('── Tool calls ──')
  const docs = await client.callTool({ name: 'search_mushi_docs', arguments: { query: 'mcp cursor setup', limit: 3 } })
  const docsText = docs.content?.[0]?.text ?? ''
  if (docs.isError || (!docsText.includes('MCP setup') && !docsText.includes('mcp-setup'))) {
    fail('search_mushi_docs did not return MCP setup doc')
  } else {
    console.log('   search_mushi_docs: OK')
  }

  const setup = await client.callTool({ name: 'diagnose_setup', arguments: { mode: 'ingest' } })
  if (setup.isError) {
    fail('diagnose_setup failed: ' + (setup.content?.[0]?.text?.slice(0, 120) ?? ''))
  } else {
    console.log('   diagnose_setup (ingest): OK')
  }

  const recent = await client.callTool({ name: 'get_recent_reports', arguments: { limit: 1 } })
  if (recent.isError) {
    fail('get_recent_reports error: ' + (recent.content?.[0]?.text?.slice(0, 120) ?? 'unknown'))
  } else {
    console.log('   get_recent_reports (live API): OK')
  }

  const conn = await client.callTool({ name: 'diagnose_connection', arguments: {} })
  if (conn.isError) fail('diagnose_connection failed')
  else console.log('   diagnose_connection: OK')

  if (failed === 0) {
    console.log('\nOK — stdio install verified (' + tools.length + ' tools, ' + resources.length + ' resources)')
  } else {
    console.error('\n' + failed + ' failure(s)')
    process.exit(1)
  }
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err))
  process.exit(1)
} finally {
  await client.close().catch(() => {})
}
