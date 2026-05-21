/**
 * FILE: packages/mcp/src/__tests__/scopes.test.ts
 * PURPOSE: Contract tests for per-scope tool filtering (introduced in
 *          MCP 0.7) and the new `structuredContent` shape on every read
 *          tool that defines an `outputSchema`.
 *
 *          Why this matters: a read-only API key (mcp:read) MUST NOT see
 *          write tools in `tools/list`. Before this filter, the LLM saw
 *          all 23 tools and would pick `dispatch_fix`, then burn a full
 *          round-trip on a 403 INSUFFICIENT_SCOPE response. After the
 *          filter, the LLM only knows about the read surface and never
 *          attempts a forbidden call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'
import { TOOL_CATALOG, type McpScope } from '../catalog.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const API_KEY = 'mushi_test_key_0123456789'
const PROJECT_ID = 'proj_00000000-0000-0000-0000-000000000000'

interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function createStubFetch() {
  const calls: FetchCall[] = []
  const queue: Array<{ status: number; body: unknown }> = []

  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v
      }
    }
    let body: unknown = undefined
    if (typeof init?.body === 'string' && init.body.length > 0) {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body,
    })
    const next = queue.shift()
    if (!next) throw new Error(`No queued response for ${init?.method ?? 'GET'} ${url}`)
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch

  return {
    stub,
    calls,
    queue,
    enqueue(body: unknown, status = 200) {
      queue.push({ status, body })
    },
  }
}

async function connectClient(stubFetch: typeof fetch, scopes?: readonly McpScope[]) {
  const server = createMushiServer({
    version: '0.0.0-test',
    apiEndpoint: API_ENDPOINT,
    apiKey: API_KEY,
    projectId: PROJECT_ID,
    fetch: stubFetch,
    scopes,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client(
    { name: 'mushi-mcp-test-client', version: '0.0.0' },
    { capabilities: {} },
  )
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return { client, server }
}

describe('per-scope tool filtering', () => {
  let fetchStub: ReturnType<typeof createStubFetch>

  beforeEach(() => {
    fetchStub = createStubFetch()
  })

  it('default (no scopes) registers every tool', async () => {
    const { client } = await connectClient(fetchStub.stub)
    try {
      const { tools } = await client.listTools()
      expect(tools).toHaveLength(TOOL_CATALOG.length)
    } finally {
      await client.close()
    }
  })

  it('mcp:read alone hides every write tool', async () => {
    const { client } = await connectClient(fetchStub.stub, ['mcp:read'])
    try {
      const { tools } = await client.listTools()
      const names = new Set(tools.map(t => t.name))
      const writeTools = TOOL_CATALOG.filter(t => t.scope === 'mcp:write').map(t => t.name)
      const readTools = TOOL_CATALOG.filter(t => t.scope === 'mcp:read').map(t => t.name)
      for (const w of writeTools) {
        expect(names.has(w), `write tool ${w} must be filtered out for mcp:read`).toBe(false)
      }
      for (const r of readTools) {
        expect(names.has(r), `read tool ${r} must be visible for mcp:read`).toBe(true)
      }
    } finally {
      await client.close()
    }
  })

  it('mcp:write alone hides every read tool', async () => {
    const { client } = await connectClient(fetchStub.stub, ['mcp:write'])
    try {
      const { tools } = await client.listTools()
      const names = new Set(tools.map(t => t.name))
      const readTools = TOOL_CATALOG.filter(t => t.scope === 'mcp:read').map(t => t.name)
      for (const r of readTools) {
        expect(names.has(r), `read tool ${r} must be filtered out for mcp:write`).toBe(false)
      }
    } finally {
      await client.close()
    }
  })

  it('explicit empty scope list deregisters the tools capability entirely', async () => {
    // When zero tools are registered, the SDK doesn't advertise the
    // `tools` capability, so `tools/list` returns a -32601 "Method not
    // found" — the cheapest possible signal that the LLM has no tools
    // to call. Cheaper than even an empty list response.
    const { client } = await connectClient(fetchStub.stub, [])
    try {
      await expect(client.listTools()).rejects.toThrow(/Method not found/)
    } finally {
      await client.close()
    }
  })

  it('calling a filtered-out tool returns an isError result without hitting the API', async () => {
    const { client } = await connectClient(fetchStub.stub, ['mcp:read'])
    try {
      // dispatch_fix is mcp:write — must not be registered.
      const res = await client.callTool({ name: 'dispatch_fix', arguments: { reportId: 'r1' } })
      expect(res.isError).toBe(true)
      const content = res.content as Array<{ type: string; text: string }>
      expect(content[0].text).toMatch(/dispatch_fix not found/)
      // Critically: no fetch was made — the LLM didn't burn a round-trip
      // on an INSUFFICIENT_SCOPE response from the API.
      expect(fetchStub.calls).toHaveLength(0)
    } finally {
      await client.close()
    }
  })
})

describe('structured tool output (MCP 2025-06-18)', () => {
  let fetchStub: ReturnType<typeof createStubFetch>
  let client: Client

  beforeEach(async () => {
    fetchStub = createStubFetch()
    ;({ client } = await connectClient(fetchStub.stub))
  })

  afterEach(async () => {
    await client.close()
  })

  it('get_recent_reports returns structuredContent typed by the outputSchema', async () => {
    fetchStub.enqueue({
      ok: true,
      data: {
        reports: [{ id: 'r1', status: 'classified' }],
        total: 42,
      },
    })
    const res = await client.callTool({
      name: 'get_recent_reports',
      arguments: { limit: 5 },
    })
    // structuredContent is the new typed payload (MCP 2025-06-18). Clients
    // that read this directly skip JSON.parse and get a typed object.
    expect(res.structuredContent).toEqual({
      reports: [{ id: 'r1', status: 'classified' }],
      total: 42,
    })
    // Text content is still present for older clients.
    const content = res.content as Array<{ type: string; text: string }>
    expect(JSON.parse(content[0].text)).toEqual({
      reports: [{ id: 'r1', status: 'classified' }],
      total: 42,
    })
  })

  it('search_reports exposes results array as structuredContent', async () => {
    fetchStub.enqueue({
      ok: true,
      data: { results: [{ id: 'r1', similarity: 0.9 }] },
    })
    const res = await client.callTool({
      name: 'search_reports',
      arguments: { query: 'checkout flake' },
    })
    expect(res.structuredContent).toEqual({
      results: [{ id: 'r1', similarity: 0.9 }],
    })
  })

  it('dispatch_fix exposes fixId as structuredContent so downstream tools can chain', async () => {
    fetchStub.enqueue({
      ok: true,
      data: { fixId: 'fix_abc', status: 'queued' },
    })
    const res = await client.callTool({
      name: 'dispatch_fix',
      arguments: { reportId: 'rep_1' },
    })
    expect(res.structuredContent).toEqual({ fixId: 'fix_abc', status: 'queued' })
  })

  it('listTools advertises outputSchema where defined', async () => {
    const { tools } = await client.listTools()
    const recent = tools.find(t => t.name === 'get_recent_reports')
    expect(recent?.outputSchema).toBeTruthy()
    expect(recent?.outputSchema).toMatchObject({ type: 'object' })
  })
})
