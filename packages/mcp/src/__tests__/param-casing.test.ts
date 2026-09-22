/**
 * FILE: packages/mcp/src/__tests__/param-casing.test.ts
 * PURPOSE: One parameter spelling across the catalog. Tools used to mix
 *          `reportId` with `project_id` in the same schema, and spell the same
 *          id `report_id` in one tool and `reportId` in the next. Every input
 *          parameter is camelCase now; the old snake_case spelling is still
 *          accepted (arg-aliases.ts) and named in the parameter description.
 *          Free-text filters whose values are a closed set are enums.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'
import { normalizeArgAliases, snakeAliasOf } from '../arg-aliases.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222'
const REPORT_ID = '33333333-3333-4333-8333-333333333333'

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

function recordingFetch(respond: (call: Call) => unknown) {
  const calls: Call[] = []
  const stub = (async (input: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers as Record<string, string> | undefined) ?? {})) {
      headers[k.toLowerCase()] = v
    }
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    return new Response(JSON.stringify({ ok: true, data: respond(call) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return { stub, calls }
}

let client: Client | null = null
afterEach(async () => {
  await client?.close()
  client = null
})

/** projectId null = account mode (no MUSHI_PROJECT_ID). */
async function connect(stub: typeof fetch, projectId: string | null = PROJECT_ID): Promise<Client> {
  const server = createMushiServer({
    version: '0.0.0-test',
    apiEndpoint: API_ENDPOINT,
    apiKey: 'mushi_test_key_0123456789', // gitleaks:allow
    ...(projectId ? { projectId } : {}),
    fetch: stub,
    features: 'all',
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const c = new Client({ name: 'param-casing-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), c.connect(clientTransport)])
  client = c
  return c
}

describe('normalizeArgAliases', () => {
  it('renames the snake_case alias of a declared camelCase parameter', () => {
    expect(normalizeArgAliases({ project_id: 'p', limit: 5 }, ['projectId', 'limit'])).toEqual({ projectId: 'p', limit: 5 })
  })

  it('keeps the camelCase value when both spellings are sent', () => {
    expect(normalizeArgAliases({ projectId: 'camel', project_id: 'snake' }, ['projectId'])).toEqual({ projectId: 'camel' })
  })

  it('leaves undeclared keys alone so the schema still decides', () => {
    expect(normalizeArgAliases({ report_id: 'r', extra_key: 1 }, ['projectId'])).toEqual({ report_id: 'r', extra_key: 1 })
  })

  it('maps camelCase to snake_case one capital at a time', () => {
    expect(snakeAliasOf('externalUserId')).toBe('external_user_id')
    expect(snakeAliasOf('topK')).toBe('top_k')
    expect(snakeAliasOf('seed')).toBe('seed')
  })
})

describe('tool input schemas', () => {
  it('spell every parameter in camelCase', async () => {
    const c = await connect(recordingFetch(() => ({})).stub)
    const { tools } = await c.listTools()
    expect(tools.length).toBeGreaterThan(60)
    const snake = tools.flatMap((t) =>
      Object.keys((t.inputSchema.properties ?? {}) as Record<string, unknown>)
        .filter((p) => p.includes('_'))
        .map((p) => `${t.name}.${p}`),
    )
    expect(snake).toEqual([])
  })

  it('name the old spelling in the description of every renamed parameter', async () => {
    const c = await connect(recordingFetch(() => ({})).stub)
    const { tools } = await c.listTools()
    const props = (name: string) =>
      tools.find((t) => t.name === name)!.inputSchema.properties as Record<string, { description?: string }>
    expect(props('get_recent_reports').projectId?.description).toContain('`project_id` is accepted too')
    expect(props('get_recent_reports').includeRaw?.description).toContain('`include_raw` is accepted too')
    expect(props('triage_issue').reportId?.description).toContain('`report_id` is accepted too')
    expect(props('query_lessons').diffText?.description).toContain('`diff_text` is accepted too')
  })

  it('use enums for closed value sets', async () => {
    const c = await connect(recordingFetch(() => ({})).stub)
    const { tools } = await c.listTools()
    const prop = (tool: string, name: string) =>
      (tools.find((t) => t.name === tool)!.inputSchema.properties as Record<string, { enum?: string[] }>)[name]
    expect(prop('list_gate_findings', 'gate')?.enum).toEqual(
      expect.arrayContaining(['dead_handler', 'mock_leak', 'crawl', 'status_claim', 'code_health']),
    )
    expect(prop('list_gate_findings', 'severity')?.enum).toEqual(['info', 'warn', 'error'])
    expect(prop('list_skills', 'category')?.enum).toEqual(expect.arrayContaining(['workflow', 'debug', 'audit', 'other']))
    expect(prop('search_codebase', 'mode')?.enum).toEqual(['semantic', 'name'])
    expect(prop('dispatch_fix', 'agent')?.enum).toEqual(expect.arrayContaining(['auto', 'cursor_cloud', 'github_cloud_agent']))
    const out = tools.find((t) => t.name === 'search_codebase')!.outputSchema!.properties as Record<string, { enum?: string[] }>
    expect(out.mode?.enum).toEqual(['semantic', 'name'])
  })
})

describe('snake_case aliases at call time', () => {
  it('accepts report_id where the schema says reportId', async () => {
    const { stub, calls } = recordingFetch((call) =>
      call.url.endsWith('/timeline') ? { report_id: REPORT_ID, timeline: [] } : { id: REPORT_ID, summary: 's' },
    )
    const c = await connect(stub)
    const res = await c.callTool({ name: 'get_report_evidence', arguments: { report_id: REPORT_ID } })
    expect(res.isError).toBeFalsy()
    expect(calls.map((x) => x.url)).toContain(`${API_ENDPOINT}/v1/admin/reports/${REPORT_ID}`)
  })

  it('routes project_id to the X-Mushi-Project-Id header like projectId', async () => {
    const { stub, calls } = recordingFetch(() => ({ reports: [], total: 0 }))
    const c = await connect(stub, null)
    await c.callTool({ name: 'get_recent_reports', arguments: { project_id: OTHER_PROJECT } })
    const list = calls.find((x) => x.url.includes('/v1/admin/reports?'))
    expect(list?.headers['x-mushi-project-id']).toBe(OTHER_PROJECT)
  })

  it('maps renamed body fields back to the wire names the API reads', async () => {
    const { stub, calls } = recordingFetch(() => ({ lessons: [] }))
    const c = await connect(stub)
    await c.callTool({ name: 'query_lessons', arguments: { diff_text: 'diff', max_tokens: 500, top_k: 3 } })
    expect(calls[0]?.body).toEqual({ diff_text: 'diff', max_tokens: 500, top_k: 3, project_id: PROJECT_ID })
    calls.length = 0
    await c.callTool({ name: 'set_tier', arguments: { externalUserId: 'u1', tierSlug: 'champion' } })
    expect(calls[0]?.body).toEqual({ external_user_id: 'u1', tier_slug: 'champion' })
  })

  it('rejects a gate id outside the vocabulary before calling the API', async () => {
    const { stub, calls } = recordingFetch(() => ({ runs: [], findings: [] }))
    const c = await connect(stub)
    const res = await c.callTool({ name: 'list_gate_findings', arguments: { gate: 'dead-handler' } }).catch((e: unknown) => e)
    const failed = res instanceof Error || (res as { isError?: boolean }).isError === true
    expect(failed).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('forwards search_codebase mode to the search route', async () => {
    const { stub, calls } = recordingFetch(() => ({ results: [], query: 'x', mode: 'name' }))
    const c = await connect(stub)
    const res = await c.callTool({ name: 'search_codebase', arguments: { query: 'x', mode: 'name', scope_prefix: 'src' } })
    expect(res.isError).toBeFalsy()
    expect(calls[0]?.body).toMatchObject({ query: 'x', mode: 'name', scope_prefix: 'src' })
  })
})
