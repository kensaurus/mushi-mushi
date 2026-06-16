/**
 * FILE: packages/mcp/src/__tests__/catalog-parity.test.ts
 * PURPOSE: Contract test that validates the catalog is internally consistent:
 *
 *   1. Every tool registered via `createMushiServer()` appears in
 *      TOOL_CATALOG + TDD_TOOL_CATALOG + CODEBASE_TOOL_CATALOG (no ghost tools).
 *
 *   2. Every tool in those catalogs is registered in `createMushiServer()`
 *      (no orphaned catalog entries).
 *
 *   3. Every resource registered appears in RESOURCE_CATALOG.
 *
 *   4. Every prompt registered appears in PROMPT_CATALOG.
 *
 *   5. Scope filtering works: mcp:read tools are present in a read-only
 *      server, mcp:write tools are absent.
 *
 * This catches the category of bug where a developer adds a tool to the
 * server but forgets to add it to the catalog, or vice versa.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'
import {
  TOOL_CATALOG,
  TDD_TOOL_CATALOG,
  CODEBASE_TOOL_CATALOG,
  RESOURCE_CATALOG,
  PROMPT_CATALOG,
} from '../catalog.js'

const ALL_TOOL_CATALOG = [
  ...TOOL_CATALOG,
  ...TDD_TOOL_CATALOG,
  ...CODEBASE_TOOL_CATALOG,
]
const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const TEST_TOKEN = 'fixture-token-not-a-secret'
const PROJECT_ID = 'proj_00000000-0000-0000-0000-000000000000'

function makeStubFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

async function buildClient(opts?: { scopes?: string[] }) {
  const stubFetch = makeStubFetch()
  const server = createMushiServer({
    version: '0.0.0',
    apiEndpoint: API_ENDPOINT,
    apiKey: TEST_TOKEN,
    projectId: PROJECT_ID,
    scopes: opts?.scopes as readonly ('mcp:read' | 'mcp:write')[] | undefined,
    fetch: stubFetch,
  })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'parity-test', version: '0.0.0' }, { capabilities: {} })

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return { client, server, stubFetch }
}

describe('Catalog parity — full scope', () => {
  let client: Client

  beforeEach(async () => {
    ;({ client } = await buildClient())
  })

  it('server exposes exactly the tools in TOOL_CATALOG + TDD_TOOL_CATALOG + CODEBASE_TOOL_CATALOG', async () => {
    const { tools } = await client.listTools()
    const serverNames = new Set(tools.map((t) => t.name))
    const catalogNames = new Set(ALL_TOOL_CATALOG.map((t) => t.name))

    const inServerNotCatalog = [...serverNames].filter((n) => !catalogNames.has(n))
    const inCatalogNotServer = [...catalogNames].filter((n) => !serverNames.has(n))

    expect(inServerNotCatalog, 'tools registered in server but missing from catalog').toEqual([])
    expect(inCatalogNotServer, 'tools in catalog but not registered in server').toEqual([])
  })

  it('server exposes exactly the resources in RESOURCE_CATALOG', async () => {
    const { resources } = await client.listResources()
    const serverUris = new Set(resources.map((r) => r.uri))
    const catalogUris = new Set(RESOURCE_CATALOG.map((r) => r.uri))

    const inServerNotCatalog = [...serverUris].filter((u) => !catalogUris.has(u))
    const inCatalogNotServer = [...catalogUris].filter((u) => !serverUris.has(u))

    expect(inServerNotCatalog, 'resources registered in server but missing from catalog').toEqual([])
    expect(inCatalogNotServer, 'resources in catalog but not registered in server').toEqual([])
  })

  it('server exposes exactly the prompts in PROMPT_CATALOG', async () => {
    const { prompts } = await client.listPrompts()
    const serverNames = new Set(prompts.map((p) => p.name))
    const catalogNames = new Set(PROMPT_CATALOG.map((p) => p.name))

    const inServerNotCatalog = [...serverNames].filter((n) => !catalogNames.has(n))
    const inCatalogNotServer = [...catalogNames].filter((n) => !serverNames.has(n))

    expect(inServerNotCatalog, 'prompts registered in server but missing from catalog').toEqual([])
    expect(inCatalogNotServer, 'prompts in catalog but not registered in server').toEqual([])
  })

  it('every tool description in catalog matches what server advertises', async () => {
    const { tools } = await client.listTools()
    const serverToolMap = new Map(tools.map((t) => [t.name, t]))

    for (const spec of ALL_TOOL_CATALOG) {
      const serverTool = serverToolMap.get(spec.name)
      expect(serverTool, `catalog tool "${spec.name}" not found in server's tools/list`).toBeDefined()
      if (!serverTool) continue
      expect(serverTool.description, `description mismatch for tool "${spec.name}"`).toBe(spec.description)
    }
  })

  it('every read-only catalog tool has readOnlyHint=true in server', async () => {
    const { tools } = await client.listTools()
    const serverToolMap = new Map(tools.map((t) => [t.name, t]))

    for (const spec of ALL_TOOL_CATALOG) {
      if (!spec.hints.readOnly) continue
      const serverTool = serverToolMap.get(spec.name)
      if (!serverTool) continue
      expect(
        serverTool.annotations?.readOnlyHint,
        `catalog says "${spec.name}" is readOnly but server annotates it otherwise`,
      ).toBe(true)
    }
  })
})

describe('Catalog parity — mcp:read scope filter', () => {
  let client: Client

  beforeEach(async () => {
    ;({ client } = await buildClient({ scopes: ['mcp:read'] }))
  })

  it('read-only server does not expose mcp:write tools', async () => {
    const { tools } = await client.listTools()
    const serverNames = new Set(tools.map((t) => t.name))
    const writeToolNames = ALL_TOOL_CATALOG
      .filter((t) => t.scope === 'mcp:write')
      .map((t) => t.name)

    const exposedWriteTools = writeToolNames.filter((n) => serverNames.has(n))
    expect(exposedWriteTools, 'write-scoped tools leaked into read-only server').toEqual([])
  })

  it('read-only server exposes all mcp:read tools', async () => {
    const { tools } = await client.listTools()
    const serverNames = new Set(tools.map((t) => t.name))
    const readToolNames = ALL_TOOL_CATALOG
      .filter((t) => t.scope === 'mcp:read')
      .map((t) => t.name)

    const missingReadTools = readToolNames.filter((n) => !serverNames.has(n))
    expect(missingReadTools, 'read tools missing from read-only server').toEqual([])
  })
})
