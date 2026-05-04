/**
 * FILE: packages/mcp/src/__tests__/server.integration.test.ts
 * PURPOSE: Real MCP protocol integration tests via `InMemoryTransport`.
 *          A genuine `Client` ↔ `Server` handshake runs in-process; we
 *          intercept `fetch` to assert tool → API request shape (URL,
 *          method, auth headers, body) and return canned envelopes.
 *
 *          These tests catch regressions the previous mock-based suite
 *          could not: protocol-level tool discovery, schema validation by
 *          the SDK, resource URI resolution, and the envelope/error
 *          unwrapping contract that the console depends on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const API_KEY = 'mushi_test_key_0123456789'
const PROJECT_ID = 'proj_00000000-0000-0000-0000-000000000000'

interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/**
 * Build a stub fetch that records every call and returns the next queued
 * response. Simulates the REST envelope `{ ok, data }` that real Mushi
 * handlers produce. Throws if a tool calls out without a queued response.
 */
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

async function connectClient(stubFetch: typeof fetch) {
  const server = createMushiServer({
    version: '0.0.0-test',
    apiEndpoint: API_ENDPOINT,
    apiKey: API_KEY,
    projectId: PROJECT_ID,
    fetch: stubFetch,
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

describe('MCP protocol handshake', () => {
  let fetchStub: ReturnType<typeof createStubFetch>
  let client: Client

  beforeEach(async () => {
    fetchStub = createStubFetch()
    ;({ client } = await connectClient(fetchStub.stub))
  })

  afterEach(async () => {
    await client.close()
  })

  it('advertises every tool with description + input schema', async () => {
    const { tools } = await client.listTools()
    const names = tools.map(t => t.name).sort()
    expect(names).toEqual([
      'dispatch_fix',
      'fix_suggest',
      'get_blast_radius',
      'get_fix_context',
      'get_fix_timeline',
      'get_knowledge_graph',
      'get_recent_reports',
      'get_report_detail',
      'get_similar_bugs',
      'graph_neighborhood',
      'graph_node_status',
      'inventory_diff',
      'inventory_findings',
      'inventory_get',
      'run_nl_query',
      'search_reports',
      'submit_fix_result',
      'test_gen_from_report',
      'transition_status',
      'trigger_judge',
    ])
    for (const t of tools) {
      expect(t.description, `${t.name} description`).toBeTruthy()
      expect(t.inputSchema, `${t.name} inputSchema`).toBeTruthy()
    }
  })

  it('annotates every tool with title + readOnlyHint so clients can render a proper UI', async () => {
    const { tools } = await client.listTools()
    const writeTools = new Set([
      'submit_fix_result',
      'dispatch_fix',
      'trigger_judge',
      'test_gen_from_report',
      'transition_status',
    ])
    for (const t of tools) {
      expect(t.annotations, `${t.name} annotations`).toBeTruthy()
      expect(t.annotations?.title, `${t.name} annotations.title`).toBeTruthy()
      expect(
        typeof t.annotations?.readOnlyHint,
        `${t.name} annotations.readOnlyHint`,
      ).toBe('boolean')
      expect(
        t.annotations?.readOnlyHint,
        `${t.name} readOnlyHint must match scope`,
      ).toBe(!writeTools.has(t.name))
    }
    // transition_status with target 'dismissed' is the destructive one.
    const transition = tools.find(t => t.name === 'transition_status')
    expect(transition?.annotations?.destructiveHint).toBe(true)
  })

  it('advertises project://* resources', async () => {
    const { resources } = await client.listResources()
    const uris = resources.map(r => r.uri).sort()
    expect(uris).toEqual(['project://dashboard', 'project://settings', 'project://stats'])
  })

  it('advertises the fix-plan / judge / triage prompts', async () => {
    const { prompts } = await client.listPrompts()
    const names = prompts.map(p => p.name).sort()
    expect(names).toEqual(['explain_judge_result', 'summarize_report_for_fix', 'triage_next_steps'])
  })
})

describe('tool → REST contract', () => {
  let fetchStub: ReturnType<typeof createStubFetch>
  let client: Client

  beforeEach(async () => {
    fetchStub = createStubFetch()
    ;({ client } = await connectClient(fetchStub.stub))
  })

  afterEach(async () => {
    await client.close()
  })

  it('get_recent_reports calls GET /v1/admin/reports with filters + auth', async () => {
    fetchStub.enqueue({ ok: true, data: { reports: [{ id: 'r1' }], total: 1 } })

    const res = await client.callTool({
      name: 'get_recent_reports',
      arguments: { status: 'classified', severity: 'critical', limit: 5 },
    })

    expect(fetchStub.calls).toHaveLength(1)
    const call = fetchStub.calls[0]
    expect(call.method).toBe('GET')
    expect(call.url).toBe(`${API_ENDPOINT}/v1/admin/reports?status=classified&severity=critical&limit=5`)
    expect(call.headers['authorization']).toBe(`Bearer ${API_KEY}`)
    expect(call.headers['x-mushi-api-key']).toBe(API_KEY)
    expect(call.headers['x-mushi-project']).toBe(PROJECT_ID)

    expect(res.isError).toBeFalsy()
    const content = res.content as Array<{ type: string; text: string }>
    const parsed = JSON.parse(content[0].text)
    expect(parsed).toEqual({ reports: [{ id: 'r1' }], total: 1 })
  })

  it('clamps limit at 100 even if caller asks for more', async () => {
    fetchStub.enqueue({ ok: true, data: { reports: [], total: 0 } })
    await client.callTool({
      name: 'get_recent_reports',
      arguments: { limit: 9999 },
    })
    expect(fetchStub.calls[0].url).toContain('limit=100')
  })

  it('search_reports POSTs to /similarity with projectId scoping', async () => {
    fetchStub.enqueue({ ok: true, data: { results: [] } })
    await client.callTool({
      name: 'search_reports',
      arguments: { query: 'button misaligned', limit: 3 },
    })
    const call = fetchStub.calls[0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe(`${API_ENDPOINT}/v1/admin/reports/similarity`)
    expect(call.body).toEqual({
      query: 'button misaligned',
      k: 3,
      threshold: 0.2,
      projectId: PROJECT_ID,
    })
  })

  it('dispatch_fix POSTs to /fixes/dispatch and forwards the envelope', async () => {
    fetchStub.enqueue({ ok: true, data: { fixId: 'fix_123', status: 'queued' } })
    const res = await client.callTool({
      name: 'dispatch_fix',
      arguments: { reportId: 'rep_abc', agent: 'claude_code' },
    })
    const call = fetchStub.calls[0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe(`${API_ENDPOINT}/v1/admin/fixes/dispatch`)
    expect(call.body).toEqual({
      reportId: 'rep_abc',
      agent: 'claude_code',
      projectId: PROJECT_ID,
    })
    const content = res.content as Array<{ type: string; text: string }>
    expect(JSON.parse(content[0].text)).toEqual({ fixId: 'fix_123', status: 'queued' })
  })

  it('submit_fix_result chains POST /fixes + PATCH /fixes/:id', async () => {
    fetchStub.enqueue({ ok: true, data: { fixId: 'fix_99' } })
    fetchStub.enqueue({ ok: true, data: { updated: true } })

    const res = await client.callTool({
      name: 'submit_fix_result',
      arguments: {
        reportId: 'rep_xyz',
        branch: 'fix/button',
        prUrl: 'https://github.com/x/y/pull/42',
        filesChanged: ['src/Button.tsx'],
        linesChanged: 7,
        summary: 'center button',
      },
    })

    expect(fetchStub.calls).toHaveLength(2)
    const [post, patch] = fetchStub.calls
    expect(post.method).toBe('POST')
    expect(post.url).toBe(`${API_ENDPOINT}/v1/admin/fixes`)
    expect(post.body).toEqual({ reportId: 'rep_xyz', agent: 'mcp' })
    expect(patch.method).toBe('PATCH')
    expect(patch.url).toBe(`${API_ENDPOINT}/v1/admin/fixes/fix_99`)
    expect(patch.body).toMatchObject({
      status: 'completed',
      branch: 'fix/button',
      pr_url: 'https://github.com/x/y/pull/42',
      files_changed: ['src/Button.tsx'],
      lines_changed: 7,
      summary: 'center button',
    })
    const content = res.content as Array<{ type: string; text: string }>
    expect(JSON.parse(content[0].text)).toEqual({ ok: true, fixId: 'fix_99' })
  })

  it('transition_status PATCHes /reports/:id with reason', async () => {
    fetchStub.enqueue({ ok: true, data: { id: 'rep_1', status: 'dismissed' } })
    await client.callTool({
      name: 'transition_status',
      arguments: { reportId: 'rep_1', status: 'dismissed', reason: 'duplicate of rep_7' },
    })
    const call = fetchStub.calls[0]
    expect(call.method).toBe('PATCH')
    expect(call.url).toBe(`${API_ENDPOINT}/v1/admin/reports/rep_1`)
    expect(call.body).toEqual({ status: 'dismissed', reason: 'duplicate of rep_7' })
  })

  it('get_knowledge_graph clamps depth at 4', async () => {
    fetchStub.enqueue({ ok: true, data: { nodes: [], edges: [] } })
    await client.callTool({ name: 'get_knowledge_graph', arguments: { seed: 'Button', depth: 99 } })
    expect(fetchStub.calls[0].url).toBe(`${API_ENDPOINT}/v1/admin/graph/traverse?seed=Button&depth=4`)
  })

  it('run_nl_query POSTs the question to /query', async () => {
    fetchStub.enqueue({ ok: true, data: { rows: [] } })
    await client.callTool({
      name: 'run_nl_query',
      arguments: { question: 'top 5 components with critical bugs this week' },
    })
    const call = fetchStub.calls[0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe(`${API_ENDPOINT}/v1/admin/query`)
    expect(call.body).toEqual({ question: 'top 5 components with critical bugs this week' })
  })

  it('inventory_get calls GET /v1/admin/inventory/:projectId', async () => {
    fetchStub.enqueue({ ok: true, data: { snapshot: null, summary: {} } })
    await client.callTool({ name: 'inventory_get', arguments: {} })
    expect(fetchStub.calls[0].method).toBe('GET')
    expect(fetchStub.calls[0].url).toBe(`${API_ENDPOINT}/v1/admin/inventory/${PROJECT_ID}`)
  })

  it('test_gen_from_report POSTs to inventory test-gen route', async () => {
    fetchStub.enqueue({
      ok: true,
      data: {
        prUrl: 'https://github.com/x/y/pull/99',
        prNumber: 99,
        branch: 'b',
        path: 'e2e/t.spec.ts',
      },
    })
    await client.callTool({
      name: 'test_gen_from_report',
      arguments: { reportId: '11111111-1111-1111-1111-111111111111' },
    })
    const call = fetchStub.calls[0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe(
      `${API_ENDPOINT}/v1/admin/inventory/${PROJECT_ID}/test-gen/from-report/11111111-1111-1111-1111-111111111111`,
    )
  })
})

describe('error surfacing', () => {
  let fetchStub: ReturnType<typeof createStubFetch>
  let client: Client

  beforeEach(async () => {
    fetchStub = createStubFetch()
    ;({ client } = await connectClient(fetchStub.stub))
  })

  afterEach(async () => { await client.close() })

  it('surfaces ok=false envelope as a tool error (not a silent empty data)', async () => {
    fetchStub.enqueue(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'NL query: 60/hour exceeded' } },
      200,
    )
    const res = await client.callTool({
      name: 'run_nl_query',
      arguments: { question: 'anything' },
    })
    expect(res.isError).toBe(true)
    const content = res.content as Array<{ type: string; text: string }>
    expect(content[0].text).toContain('RATE_LIMITED')
  })

  it('surfaces 403 INSUFFICIENT_SCOPE with a human-readable message', async () => {
    fetchStub.enqueue(
      { ok: false, error: { code: 'INSUFFICIENT_SCOPE', message: 'API key is missing required scope "mcp:write".' } },
      403,
    )
    const res = await client.callTool({
      name: 'dispatch_fix',
      arguments: { reportId: 'rep_1' },
    })
    expect(res.isError).toBe(true)
    const content = res.content as Array<{ type: string; text: string }>
    expect(content[0].text).toContain('INSUFFICIENT_SCOPE')
    expect(content[0].text).toContain('mcp:write')
  })

  it('surfaces network errors as tool errors', async () => {
    // No enqueue — stub will throw "No queued response"
    const res = await client.callTool({
      name: 'get_recent_reports',
      arguments: {},
    })
    expect(res.isError).toBe(true)
  })
})

/**
 * Narrow a `readResource` response content entry to the text variant.
 * The MCP schema is a discriminated union (text XOR blob); every Mushi
 * resource is JSON-as-text, so this helper asserts-and-returns the text
 * without sprinkling `as string` everywhere.
 */
function textOf(contents: Awaited<ReturnType<Client['readResource']>>['contents']): string {
  const first = contents[0]
  if (!('text' in first) || typeof first.text !== 'string') {
    throw new Error('Expected text-variant resource content')
  }
  return first.text
}

describe('resources', () => {
  let fetchStub: ReturnType<typeof createStubFetch>
  let client: Client

  beforeEach(async () => {
    fetchStub = createStubFetch()
    ;({ client } = await connectClient(fetchStub.stub))
  })

  afterEach(async () => { await client.close() })

  it('project://dashboard fetches /v1/admin/dashboard and returns JSON', async () => {
    fetchStub.enqueue({ ok: true, data: { pending: 3, fixing: 1 } })
    const result = await client.readResource({ uri: 'project://dashboard' })
    expect(fetchStub.calls[0].url).toBe(`${API_ENDPOINT}/v1/admin/dashboard`)
    expect(result.contents[0].mimeType).toBe('application/json')
    expect(JSON.parse(textOf(result.contents))).toEqual({ pending: 3, fixing: 1 })
  })

  it('project://settings fetches /v1/admin/settings', async () => {
    fetchStub.enqueue({ ok: true, data: { stage1_model: 'claude-sonnet-4-6' } })
    const result = await client.readResource({ uri: 'project://settings' })
    expect(fetchStub.calls[0].url).toBe(`${API_ENDPOINT}/v1/admin/settings`)
    expect(JSON.parse(textOf(result.contents)).stage1_model).toBe('claude-sonnet-4-6')
  })

  it('project://stats fetches /v1/admin/stats', async () => {
    fetchStub.enqueue({ ok: true, data: { total: 12 } })
    const result = await client.readResource({ uri: 'project://stats' })
    expect(fetchStub.calls[0].url).toBe(`${API_ENDPOINT}/v1/admin/stats`)
    expect(JSON.parse(textOf(result.contents)).total).toBe(12)
  })
})
