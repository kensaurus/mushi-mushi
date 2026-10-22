/**
 * request_ci_placement_change (ADR 0037): a write tool that can only ASK.
 * It POSTs the change to /v1/admin/ci/placement/requests for the configured
 * project (the server rebuilds the payload from a fresh preview), never calls
 * approve or execute, refuses a variable outside the allowlist before any
 * call, and is mapped on the hosted transport too.
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

async function connect() {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: url.replace(API_ENDPOINT, ''), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify({ ok: true, data: { id: 'req-1', status: 'pending_approval', payloadSha256: 'a'.repeat(64), preview: { repo: 'kensaurus/yen-yen' } } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  const server = createMushiServer({ version: '0.0.0-test', apiEndpoint: API_ENDPOINT, apiKey: API_KEY, projectId: PROJECT_ID, fetch: fetchStub })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'ci-placement-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, calls }
}

describe('request_ci_placement_change', () => {
  it('is a write tool in the fixes group that only requests', () => {
    const spec = TOOL_CATALOG.find((t) => t.name === 'request_ci_placement_change')
    expect(spec?.scope).toBe('mcp:write')
    expect(spec?.hints.readOnly).toBe(false)
    expect(spec?.description).toMatch(/only creates a request/)
    expect(spec?.description).toMatch(/never changes runner labels or registrations/)
    expect(TOOL_FEATURE_MAP['request_ci_placement_change']).toBe('fixes')
  })

  it('POSTs the change for the configured project and nothing else', async () => {
    const { client, calls } = await connect()
    const res = await client.callTool({ name: 'request_ci_placement_change', arguments: { repo: 'kensaurus/yen-yen', variable: 'LINUX_RUNNER', value: 'kensaurus-local', reason: 'paid minutes while idle' } })
    expect(res.isError).toBeFalsy()
    expect(calls).toEqual([{ url: '/v1/admin/ci/placement/requests', method: 'POST', body: { projectId: PROJECT_ID, repo: 'kensaurus/yen-yen', variable: 'LINUX_RUNNER', value: 'kensaurus-local', reason: 'paid minutes while idle' } }])
    expect(calls.some((c) => /approve|execute/.test(c.url))).toBe(false)
    await client.callTool({ name: 'request_ci_placement_change', arguments: { repo: 'kensaurus/yen-yen', variable: 'RUNNER_E2E', value: null } })
    expect(calls[1].body).toMatchObject({ variable: 'RUNNER_E2E', value: null })
    await client.close()
  })

  it('refuses a variable outside the allowlist before any call', async () => {
    const { client, calls } = await connect()
    const res = await client.callTool({ name: 'request_ci_placement_change', arguments: { repo: 'kensaurus/yen-yen', variable: 'EXPO_PUBLIC_API_URL', value: 'x' } })
    expect(res.isError).toBe(true)
    expect(calls).toEqual([])
    await client.close()
  })

  it('the hosted transport maps it to the same route and wraps it as untrusted', () => {
    const hosted = readFileSync(resolve(ROOT, 'packages/server/supabase/functions/mcp/index.ts'), 'utf8')
    expect(hosted).toMatch(/request_ci_placement_change: \{\s+scope: 'mcp:write'/)
    expect(hosted).toContain("apiCall('/v1/admin/ci/placement/requests'")
    const untrusted = hosted.match(/const UNTRUSTED_TOOLS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
    expect(untrusted).toContain("'request_ci_placement_change'")
  })
})
