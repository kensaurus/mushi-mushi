#!/usr/bin/env node
/**
 * Smoke test for the built stdio binary. Spawns `dist/index.js`, initialises
 * the MCP protocol over stdio, and validates that the server advertises all
 * tools/resources/prompts defined in the catalog. Counts are derived from the
 * built catalog module — never hardcoded — so this gate stays green without
 * manual edits when tools are added.
 *
 * Run: `node packages/mcp/scripts/smoke-stdio.mjs`
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')
const serverPath = join(distDir, 'index.js')

// Import the built catalog to derive expected counts and names.
// This ensures the smoke gate tracks the catalog automatically.
// Use pathToFileURL for Windows ESM compatibility (file:// required on win32).
import { pathToFileURL } from 'node:url'
const { TOOL_CATALOG, TDD_TOOL_CATALOG, CODEBASE_TOOL_CATALOG, RESOURCE_CATALOG, PROMPT_CATALOG } = await import(
  pathToFileURL(join(distDir, 'catalog.js')).href
)

const allToolCatalog = [
  ...(TOOL_CATALOG ?? []),
  ...(TDD_TOOL_CATALOG ?? []),
  ...(CODEBASE_TOOL_CATALOG ?? []),
]
// Stdio exposes tools only; resources stay on resources/list (hosted HTTP also registers resource names as tools).
const expectedToolNames = allToolCatalog.map((t) => t.name)
const expectedResourceNames = (RESOURCE_CATALOG ?? []).map((r) => r.name)
const expectedPromptNames = (PROMPT_CATALOG ?? []).map((p) => p.name)

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    MUSHI_API_KEY: 'smoke-test-key',
    MUSHI_PROJECT_ID: 'smoke-test-project',
    MUSHI_API_ENDPOINT: 'http://127.0.0.1:1/offline',
    // Validate the FULL catalog surface. A fresh install defaults to the lean
    // DEFAULT_FEATURE_GROUPS; `all` opts into every tool so this gate can
    // assert catalog parity (every catalog tool is advertised).
    MUSHI_FEATURES: 'all',
  },
})

const client = new Client(
  { name: 'mushi-smoke', version: '0.0.0' },
  { capabilities: {} },
)

let failed = false

function fail(msg) {
  console.error('FAIL:', msg)
  failed = true
}

/**
 * Regression guard: the server must exit on its own once the client closes
 * stdin (EOF), without being killed. Real MCP clients (Cursor, Claude
 * Desktop) never exercise this path — they kill the child process directly
 * on shutdown — but external Docker introspection harnesses (e.g. Glama's
 * build test) pipe requests over stdio, close the pipe, and wait for a
 * natural exit. An un-refed `setInterval` (or any other unmanaged handle)
 * left running after `connect()` will keep the event loop — and the
 * container — alive forever, which reads as a hung/failed build test even
 * though every JSON-RPC response was correct.
 */
async function checkStdinEofExit() {
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [serverPath], {
    env: {
      MUSHI_API_KEY: 'smoke-test-key',
      MUSHI_PROJECT_ID: 'smoke-test-project',
      MUSHI_API_ENDPOINT: 'http://127.0.0.1:1/offline',
      MUSHI_FEATURES: 'all',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const exitPromise = new Promise((resolve) => child.once('exit', resolve))

  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke-lifecycle', version: '1.0' },
      },
    }) + '\n',
  )
  // Give the server a moment to boot, respond, and schedule its background
  // timers before we close stdin — we want to prove the shutdown path wins
  // even with those timers pending, not just on a cold-start race.
  await new Promise((r) => setTimeout(r, 750))
  child.stdin.end()

  const timeoutMs = 8000
  const result = await Promise.race([
    exitPromise,
    new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), timeoutMs)),
  ])

  if (result === 'TIMEOUT') {
    child.kill('SIGKILL')
    fail(
      `Server did not exit within ${timeoutMs}ms of stdin EOF — an un-refed ` +
        `timer/handle is likely keeping the event loop alive again (this is ` +
        `the Glama Docker introspection hang regression).`,
    )
  } else if (result !== 0) {
    fail(`Server exited with code ${result} on stdin EOF (expected 0)`)
  } else {
    console.log('OK — server exits cleanly on stdin EOF')
  }
}

try {
  await checkStdinEofExit()
  if (failed) process.exit(1)

  await client.connect(transport)
  const { tools } = await client.listTools()
  const { resources } = await client.listResources()
  const { prompts } = await client.listPrompts()

  const toolNames = tools.map((t) => t.name)
  const resourceNames = resources.map((r) => r.name)
  const promptNames = prompts.map((p) => p.name)

  const result = {
    tools: tools.length,
    resources: resources.length,
    prompts: prompts.length,
    firstTool: tools[0]?.name,
  }
  console.log(JSON.stringify(result, null, 2))

  // Validate all catalog tools are exposed (catalog is source of truth)
  const missingTools = expectedToolNames.filter((n) => !toolNames.includes(n))
  const extraTools = toolNames.filter((n) => !expectedToolNames.includes(n))
  if (missingTools.length > 0) fail(`Tools in catalog but not advertised: ${missingTools.join(', ')}`)
  if (extraTools.length > 0) fail(`Tools advertised but not in catalog: ${extraTools.join(', ')}`)

  // Validate resources
  const missingResources = expectedResourceNames.filter((n) => !resourceNames.includes(n))
  const extraResources = resourceNames.filter((n) => !expectedResourceNames.includes(n))
  if (missingResources.length > 0) fail(`Resources in catalog but not advertised: ${missingResources.join(', ')}`)
  if (extraResources.length > 0) fail(`Resources advertised but not in catalog: ${extraResources.join(', ')}`)

  // Validate prompts
  const missingPrompts = expectedPromptNames.filter((n) => !promptNames.includes(n))
  const extraPrompts = promptNames.filter((n) => !expectedPromptNames.includes(n))
  if (missingPrompts.length > 0) fail(`Prompts in catalog but not advertised: ${missingPrompts.join(', ')}`)
  if (extraPrompts.length > 0) fail(`Prompts advertised but not in catalog: ${extraPrompts.join(', ')}`)

  if (failed) {
    process.exit(1)
  }

  const expectedToolCount = expectedToolNames.length
  console.log(
    `OK — ${tools.length} tools (expected ${expectedToolCount}) / ${resources.length} resources / ${prompts.length} prompts (all match catalog)`,
  )
} finally {
  await client.close()
}
