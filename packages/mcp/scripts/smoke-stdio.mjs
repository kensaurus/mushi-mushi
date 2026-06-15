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
const { TOOL_CATALOG, TDD_TOOL_CATALOG, RESOURCE_CATALOG, PROMPT_CATALOG } = await import(
  pathToFileURL(join(distDir, 'catalog.js')).href
)

const allToolCatalog = [...(TOOL_CATALOG ?? []), ...(TDD_TOOL_CATALOG ?? [])]
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

try {
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

  console.log(
    `OK — ${tools.length} tools / ${resources.length} resources / ${prompts.length} prompts (all match catalog)`,
  )
} finally {
  await client.close()
}
