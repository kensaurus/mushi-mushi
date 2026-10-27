/**
 * file_report: files a free-form report through POST
 * /v1/admin/projects/:id/reports (the route `mushi reports file` and the
 * console use), with write scope, not idempotent, and input checked before
 * any call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'
import { TOOL_CATALOG } from '../catalog.js'
import { TOOL_FEATURE_MAP } from '../feature-groups.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const API_KEY = 'TEST-FIXTURE-NOT-A-REAL-SECRET'
const PROJECT_ID = '1000000a-0000-4000-8000-000000000000'
const OTHER_PROJECT = '1000000b-0000-4000-8000-000000000000'
const REPORT_ID = '4000000a-0000-4000-8000-000000000000'

interface Call { url: string; method: string; body: unknown }

function stubFetch() {
  const calls: Call[] = []
  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, method: init?.method ?? 'GET', body })
    const data = { reportId: REPORT_ID, projectId: PROJECT_ID, title: body?.title ?? '', status: 'new', severity: body?.severity ?? null, component: body?.component ?? null }
    return new Response(JSON.stringify({ ok: true, data }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { stub, calls }
}

describe('file_report', () => {
  let fetchMock: ReturnType<typeof stubFetch>
  let client: Client

  beforeEach(async () => {
    fetchMock = stubFetch()
    const server = createMushiServer({ version: '0.0.0-test', apiEndpoint: API_ENDPOINT, apiKey: API_KEY, projectId: PROJECT_ID, fetch: fetchMock.stub })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'file-report-test', version: '0.0.0' }, { capabilities: {} })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })
  afterEach(async () => {
    await client.close().catch(() => {})
  })

  it('is a write tool in the triage group that is not idempotent', () => {
    const entry = TOOL_CATALOG.find((t) => t.name === 'file_report')
    expect(entry?.scope).toBe('mcp:write')
    expect(entry?.hints).toMatchObject({ readOnly: false, destructive: false, idempotent: false })
    expect(TOOL_FEATURE_MAP.file_report).toBe('triage')
  })

  it('POSTs the report to the configured project and returns the new id', async () => {
    const res = await client.callTool({
      name: 'file_report',
      arguments: { title: 'Checkout adds tax twice', description: 'Cart of 2 shows tax x2', severity: 'high', component: 'checkout' },
    })
    expect(res.isError).toBeFalsy()
    expect(fetchMock.calls).toHaveLength(1)
    expect(fetchMock.calls[0]).toMatchObject({
      url: `${API_ENDPOINT}/v1/admin/projects/${PROJECT_ID}/reports`,
      method: 'POST',
      body: { title: 'Checkout adds tax twice', description: 'Cart of 2 shows tax x2', severity: 'high', component: 'checkout' },
    })
    expect(res.structuredContent).toMatchObject({ reportId: REPORT_ID, status: 'new', severity: 'high' })
  })

  it('refuses another project on a project-bound connection, filing nothing', async () => {
    const res = await client.callTool({ name: 'file_report', arguments: { title: 'Blank settings page', description: 'White screen', projectId: OTHER_PROJECT } })
    expect(res.isError).toBe(true)
    expect(JSON.stringify(res.content)).toContain('PROJECT_SCOPE_MISMATCH')
    expect(fetchMock.calls).toHaveLength(0)
  })

  it('rejects a short title or an unknown severity before calling the API', async () => {
    const short = await client.callTool({ name: 'file_report', arguments: { title: 'ab', description: 'x' } })
    expect(short.isError).toBe(true)
    const sev = await client.callTool({ name: 'file_report', arguments: { title: 'fine title', description: 'x', severity: 'urgent' } })
    expect(sev.isError).toBe(true)
    expect(fetchMock.calls).toHaveLength(0)
  })
})
