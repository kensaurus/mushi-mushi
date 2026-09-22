/**
 * FILE: packages/mcp/src/__tests__/stdio-attribution.test.ts
 * PURPOSE: The stdio server names itself and its tool call on every API
 *          request, so the api can count stdio tool use and credit the funnel
 *          (packages/server/supabase/functions/_shared/mcp-stdio-usage.ts).
 *
 * Until 2026-09-22 stdio requests carried no client or tool identifier, so the
 * ICP's main install path read 0 in Fix pulled and Habit.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const REPORT_ID = '22222222-2222-4222-8222-222222222222'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

interface SeenRequest {
  method: string
  path: string
  headers: Record<string, string>
}

/** Answers every request with an ok envelope and records its headers. */
function recordingFetch() {
  const seen: SeenRequest[] = []
  const stub = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    seen.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    })
    const data = url.pathname.endsWith(`/reports/${REPORT_ID}`)
      ? { id: REPORT_ID, project_id: PROJECT_ID, status: 'classified', summary: 'Pay button dead' }
      : {}
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return { stub, seen }
}

let client: Client | null = null

async function connect(stub: typeof fetch): Promise<Client> {
  const server = createMushiServer({
    version: '9.9.9-test',
    apiEndpoint: API_ENDPOINT,
    apiKey: 'mushi_test_key_0123456789',
    projectId: PROJECT_ID,
    fetch: stub,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const c = new Client({ name: 'stdio-attribution-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), c.connect(clientTransport)])
  client = c
  return c
}

afterEach(async () => {
  await client?.close()
  client = null
})

describe('stdio tool attribution headers', () => {
  it('names the client, the tool and one invocation on a single-request tool', async () => {
    const { stub, seen } = recordingFetch()
    const c = await connect(stub)
    await c.callTool({ name: 'get_report_detail', arguments: { reportId: REPORT_ID } })

    const detail = seen.find((r) => r.path.endsWith(`/v1/admin/reports/${REPORT_ID}`))
    expect(detail?.headers['x-mushi-client']).toBe('mcp-stdio/9.9.9-test')
    expect(detail?.headers['x-mushi-mcp-tool']).toBe('get_report_detail')
    expect(detail?.headers['x-mushi-mcp-invocation']).toMatch(UUID)
  })

  it('gives every request of one multi-request call the same invocation id', async () => {
    const { stub, seen } = recordingFetch()
    const c = await connect(stub)
    await c.callTool({ name: 'triage_issue', arguments: { report_id: REPORT_ID } })

    const ids = new Set(seen.map((r) => r.headers['x-mushi-mcp-invocation']))
    expect(seen.length).toBeGreaterThan(1)
    expect(ids.size).toBe(1)
    expect(seen.every((r) => r.headers['x-mushi-mcp-tool'] === 'triage_issue')).toBe(true)
  })

  it('uses a fresh invocation id for each call', async () => {
    const { stub, seen } = recordingFetch()
    const c = await connect(stub)
    await c.callTool({ name: 'get_report_detail', arguments: { reportId: REPORT_ID } })
    await c.callTool({ name: 'get_report_detail', arguments: { reportId: REPORT_ID } })

    const ids = seen
      .filter((r) => r.path.endsWith(`/v1/admin/reports/${REPORT_ID}`))
      .map((r) => r.headers['x-mushi-mcp-invocation'])
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})
