#!/usr/bin/env node
/**
 * Smoke test for the built stdio binary. Spawns `dist/index.js`, initialises
 * the MCP protocol over stdio, and asserts the server advertises the
 * expected tool / resource / prompt counts. No network calls — we set a
 * bogus MUSHI_API_ENDPOINT so any tool invocation would fail fast, but
 * discovery doesn't touch the network.
 *
 * Run: `node packages/mcp/scripts/smoke-stdio.mjs`
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverPath = join(__dirname, '..', 'dist', 'index.js')

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    MUSHI_API_KEY: 'smoke-test-key',
    MUSHI_PROJECT_ID: 'smoke-test-project',
    MUSHI_API_ENDPOINT: 'http://127.0.0.1:1/offline',
  },
})

const client = new Client(
  { name: 'mushi-smoke', version: '0.0.0' },
  { capabilities: {} },
)

try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  const { resources } = await client.listResources()
  const { prompts } = await client.listPrompts()
  const result = {
    tools: tools.length,
    resources: resources.length,
    prompts: prompts.length,
    firstTool: tools[0]?.name,
  }
  console.log(JSON.stringify(result, null, 2))
  if (tools.length !== 13 || resources.length !== 3 || prompts.length !== 3) {
    console.error('FAIL: expected 13 tools / 3 resources / 3 prompts, got', result)
    process.exit(1)
  }
  console.log('OK')
} finally {
  await client.close()
}
