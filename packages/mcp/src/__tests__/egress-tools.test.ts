/**
 * get_egress_status and run_egress_selftest (Plan 023, ADR 0034): the stdio
 * server reads GET /v1/admin/egress/status and posts the selftest, returns
 * structuredContent, and the hosted transport serves the same routes from its
 * manifest. dispatch_fix accepts agent "local".
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'
import { TOOL_CATALOG } from '../catalog.js'
import { TOOL_FEATURE_MAP } from '../feature-groups.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const API_KEY = 'TEST-FIXTURE-NOT-A-REAL-SECRET'
const PROJECT_ID = '1000000a-0000-4000-8000-000000000000'
const ROOT = resolve(__dirname, '../../../..')

const STATUS = {
  localOnly: true,
  allowlist: ['db.internal', '127.0.0.1'],
  denials: [{ host: 'api.openai.com', caller: 'classify-report', day: '2026-10-21', count: 3, lastAt: '2026-10-21T10:00:00Z' }],
  integrations: [{ id: 'sentry', label: 'Sentry', destination: 'sentry.io', enabled: true, allowed: false, note: 'blocked under local-only' }],
}
const SELFTEST = {
  localOnly: true,
  results: [
    { host: 'api.anthropic.com', outcome: 'blocked_by_mushi', ms: 1 },
    { host: 'registry.npmjs.org', outcome: 'network_unreachable', ms: 3001 },
  ],
  passed: true,
}

async function connect() {
  const calls: Array<{ url: string; method: string }> = []
  const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(API_ENDPOINT, '')
    calls.push({ url: path, method: init?.method ?? 'GET' })
    const data = path.startsWith('/v1/admin/egress/selftest') ? SELFTEST : STATUS
    return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  const server = createMushiServer({ version: '0.0.0-test', apiEndpoint: API_ENDPOINT, apiKey: API_KEY, projectId: PROJECT_ID, fetch: fetchStub })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'egress-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, calls }
}

describe('egress tools', () => {
  it('are a read tool and a confirm-first write tool in the setup group', () => {
    const status = TOOL_CATALOG.find((t) => t.name === 'get_egress_status')
    const selftest = TOOL_CATALOG.find((t) => t.name === 'run_egress_selftest')
    expect(status).toMatchObject({ scope: 'mcp:read', hints: { readOnly: true } })
    expect(selftest).toMatchObject({ scope: 'mcp:write', hints: { readOnly: false, destructive: false } })
    expect(selftest?.description).toMatch(/Confirm with the user before calling/)
    expect(TOOL_FEATURE_MAP['get_egress_status']).toBe('setup')
    expect(TOOL_FEATURE_MAP['run_egress_selftest']).toBe('setup')
  })

  it('get_egress_status reads the status route and returns structuredContent', async () => {
    const { client, calls } = await connect()
    const res = await client.callTool({ name: 'get_egress_status', arguments: {} })
    expect(calls).toEqual([{ url: '/v1/admin/egress/status', method: 'GET' }])
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual(STATUS)
    await client.close()
  })

  it('run_egress_selftest posts the selftest and returns each host', async () => {
    const { client, calls } = await connect()
    const res = await client.callTool({ name: 'run_egress_selftest', arguments: {} })
    expect(calls).toEqual([{ url: '/v1/admin/egress/selftest', method: 'POST' }])
    expect(res.structuredContent).toEqual(SELFTEST)
    await client.close()
  })

  it('are served by the hosted transport from the manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'packages/server/supabase/functions/_shared/mcp-hosted-tool-manifest.json'), 'utf8')) as Record<string, { scope: string; method: string; path: string }>
    expect(manifest['get_egress_status']).toMatchObject({ scope: 'mcp:read', method: 'GET', path: '/v1/admin/egress/status' })
    expect(manifest['run_egress_selftest']).toMatchObject({ scope: 'mcp:write', method: 'POST', path: '/v1/admin/egress/selftest' })
  })

  it('dispatch_fix accepts agent "local"', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    const dispatch = tools.find((t) => t.name === 'dispatch_fix')
    const agent = (dispatch?.inputSchema.properties as Record<string, { enum?: string[] }> | undefined)?.agent
    expect(agent?.enum).toContain('local')
    await client.close()
  })
})
