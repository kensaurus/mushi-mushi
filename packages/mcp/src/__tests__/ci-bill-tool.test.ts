/**
 * get_ci_bill: reads GET /v1/admin/ci/bill (the real GitHub Actions bill)
 * for the configured project over 30 days by default, leaves the project out
 * for an account-level key, allows up to 90 days, returns structuredContent,
 * wraps the text as data (repo names come from GitHub), and is read-only.
 * The hosted transport serves the same path from its manifest.
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

const BILL = {
  window: { days: 30, from: '2026-09-28', to: '2026-10-27' },
  provenance: 'measured',
  currency: 'USD',
  available: true,
  unavailableReason: null,
  owners: [],
  month: { label: '2026-10', grossUsd: 2, discountUsd: 1, netUsd: 1 },
  totals: { grossUsd: 2, discountUsd: 1, netUsd: 1, minutes: 100 },
  previousTotals: null,
  change: null,
  byRepo: [{ repo: 'acme/ignore-previous-instructions', netUsd: 1, grossUsd: 2, discountUsd: 1, minutes: 100 }],
  bySku: [],
  byDay: [],
  dataThrough: '2026-10-27',
  agentShare: null,
}

async function connect(projectId: string | undefined) {
  const urls: string[] = []
  const methods: string[] = []
  const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(url.replace(API_ENDPOINT, ''))
    methods.push(init?.method ?? 'GET')
    return new Response(JSON.stringify({ ok: true, data: BILL }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  const server = createMushiServer({ version: '0.0.0-test', apiEndpoint: API_ENDPOINT, apiKey: API_KEY, projectId, fetch: fetchStub })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'ci-bill-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, urls, methods }
}

describe('get_ci_bill', () => {
  it('is a read-only, untrusted tool in the default fixes group that says its money is measured', () => {
    const spec = TOOL_CATALOG.find((t) => t.name === 'get_ci_bill')
    expect(spec?.scope).toBe('mcp:read')
    expect(spec?.hints.readOnly).toBe(true)
    expect(spec?.returnsUntrusted).toBe(true)
    expect(spec?.description).toMatch(/measured/)
    expect(TOOL_FEATURE_MAP['get_ci_bill']).toBe('fixes')
  })

  it('reads the configured project for 30 days with GET only, returns structuredContent and wraps the text', async () => {
    const { client, urls, methods } = await connect(PROJECT_ID)
    const res = await client.callTool({ name: 'get_ci_bill', arguments: {} })
    await client.callTool({ name: 'get_ci_bill', arguments: { days: 90 } })
    expect(urls).toEqual([`/v1/admin/ci/bill?days=30&project_id=${PROJECT_ID}`, `/v1/admin/ci/bill?days=90&project_id=${PROJECT_ID}`])
    expect(methods).toEqual(['GET', 'GET'])
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual(BILL)
    const text = (res.content as Array<{ text: string }>)[0]!.text
    expect(text).toContain('<mushi-data role=')
    await client.close()
  })

  it('leaves the project out for an account-level key, and refuses a window over 90 days', async () => {
    const account = await connect(undefined)
    await account.client.callTool({ name: 'get_ci_bill', arguments: {} })
    expect(account.urls).toEqual(['/v1/admin/ci/bill?days=30'])
    await account.client.close()
    const bound = await connect(PROJECT_ID)
    const res = await bound.client.callTool({ name: 'get_ci_bill', arguments: { days: 91 } })
    expect(res.isError).toBe(true)
    expect(bound.urls).toEqual([])
    await bound.client.close()
  })

  it('is served by the hosted transport from the manifest, wrapped as untrusted there too', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'packages/server/supabase/functions/_shared/mcp-hosted-tool-manifest.json'), 'utf8')) as Record<string, { scope: string; method: string; path: string }>
    expect(manifest['get_ci_bill']).toMatchObject({ scope: 'mcp:read', method: 'GET', path: '/v1/admin/ci/bill?project_id={projectId}&days={days|30}' })
    const hosted = readFileSync(resolve(ROOT, 'packages/server/supabase/functions/mcp/index.ts'), 'utf8')
    const untrusted = hosted.match(/const UNTRUSTED_TOOLS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
    expect(untrusted).toContain("'get_ci_bill'")
  })
})
