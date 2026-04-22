#!/usr/bin/env node
/**
 * FILE: packages/mcp/scripts/demo-terminal-config.mjs
 * PURPOSE: Show — in one runnable script — exactly what happens when
 *          someone drops a `mushi-mushi-local` MCP entry into their
 *          Cursor or Claude Desktop config and the editor spawns the
 *          server. Boots the built MCP binary via stdio with the three
 *          env vars a user would set, runs a real Client through the
 *          protocol handshake, calls one tool, and prints every wire
 *          response.
 *
 *          Intentionally verbose — this is documentation you can execute.
 *
 *          Usage:
 *              export MUSHI_API_ENDPOINT=http://localhost:54321/functions/v1/api
 *              export MUSHI_API_KEY=mushi_xxx…           # pasted from the admin UI
 *              export MUSHI_PROJECT_ID=<project-uuid>    # from the admin URL
 *              pnpm --filter @mushi-mushi/mcp build
 *              node packages/mcp/scripts/demo-terminal-config.mjs
 *
 *          If MUSHI_API_ENDPOINT is unreachable we fall back to the
 *          built-in localhost mock from `localhost-e2e.mjs` so the
 *          demo still renders a full round-trip.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import http from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverPath = join(__dirname, '..', 'dist', 'index.js')

const endpoint = process.env.MUSHI_API_ENDPOINT
const apiKey = process.env.MUSHI_API_KEY
const projectId = process.env.MUSHI_PROJECT_ID

async function pickEndpoint() {
  if (endpoint && apiKey) {
    try {
      const url = new URL(endpoint)
      await new Promise((resolve, reject) => {
        const req = http.request({ host: url.hostname, port: url.port || 80, path: '/', method: 'HEAD', timeout: 800 },
          () => resolve())
        req.on('error', reject)
        req.on('timeout', () => req.destroy(new Error('timeout')))
        req.end()
      })
      console.log(`Using live endpoint: ${endpoint}`)
      return { endpoint, apiKey: apiKey, projectId: projectId ?? '' }
    } catch {
      console.log(`Live endpoint ${endpoint} unreachable — falling back to built-in mock.`)
    }
  } else {
    console.log('No MUSHI_API_* env vars — falling back to built-in mock.')
  }

  // Minimal inline mock so the demo is always self-contained.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      data: req.url.startsWith('/v1/admin/reports?')
        ? { reports: [{ id: 'rep_demo', summary: 'Demo report', severity: 'low', status: 'classified' }], total: 1 }
        : { stub: true, path: req.url },
    }))
  })
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
  process.on('exit', () => server.close())
  return {
    endpoint: `http://127.0.0.1:${port}`,
    apiKey: 'mushi_demo_key',
    projectId: 'proj_demo_00000000-0000-0000-0000-000000000000',
  }
}

const cfg = await pickEndpoint()

console.log('\n— Spawning MCP binary exactly as Cursor would —')
console.log(JSON.stringify({
  command: 'node',
  args: [serverPath],
  env: { MUSHI_API_ENDPOINT: cfg.endpoint, MUSHI_API_KEY: cfg.apiKey.slice(0, 12) + '…', MUSHI_PROJECT_ID: cfg.projectId },
}, null, 2))

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    MUSHI_API_ENDPOINT: cfg.endpoint,
    MUSHI_API_KEY: cfg.apiKey,
    MUSHI_PROJECT_ID: cfg.projectId,
  },
})
const client = new Client({ name: 'demo-terminal', version: '0.0.0' }, { capabilities: {} })
await client.connect(transport)

console.log('\n— Handshake —')
const { tools } = await client.listTools()
console.log(`${tools.length} tools:`)
for (const t of tools) console.log(`  • ${t.name.padEnd(22)} ${t.description?.slice(0, 60) ?? ''}`)

const { resources } = await client.listResources()
console.log(`\n${resources.length} resources:`)
for (const r of resources) console.log(`  • ${r.uri.padEnd(22)} ${r.name ?? ''}`)

const { prompts } = await client.listPrompts()
console.log(`\n${prompts.length} prompts:`)
for (const p of prompts) console.log(`  • /${p.name.padEnd(26)} ${p.description?.slice(0, 60) ?? ''}`)

console.log('\n— Calling get_recent_reports —')
const call = await client.callTool({ name: 'get_recent_reports', arguments: { limit: 3 } })
const first = call.content[0]
if (first?.type === 'text') {
  const parsed = JSON.parse(first.text)
  console.log(JSON.stringify(parsed, null, 2).split('\n').slice(0, 20).join('\n'))
} else {
  console.log('(non-text response)', call)
}

await client.close()
console.log('\n✓ Demo complete.')
process.exit(0)
