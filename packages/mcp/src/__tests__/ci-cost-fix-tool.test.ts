/**
 * open_ci_cost_fix (ADR 0047): a write tool that opens a DRAFT pull request
 * applying one CI cost fix to one workflow. It POSTs the advice's autofix
 * target to /v1/admin/ci/cost-fixes for the configured project, refuses an
 * unknown kind or a path outside .github/workflows before any call, and is
 * mapped on the hosted transport too.
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
    return new Response(JSON.stringify({ ok: true, data: { job: { id: 'job-1', status: 'queued' } } }), { status: 202, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  const server = createMushiServer({ version: '0.0.0-test', apiEndpoint: API_ENDPOINT, apiKey: API_KEY, projectId: PROJECT_ID, fetch: fetchStub })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'ci-cost-fix-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, calls }
}

describe('open_ci_cost_fix', () => {
  it('is a write tool in the fixes group that says the PR is a draft', () => {
    const spec = TOOL_CATALOG.find((t) => t.name === 'open_ci_cost_fix')
    expect(spec?.scope).toBe('mcp:write')
    expect(spec?.hints.readOnly).toBe(false)
    expect(spec?.description).toMatch(/DRAFT pull request/)
    expect(spec?.description).toMatch(/Confirm with the user first/)
    expect(TOOL_FEATURE_MAP['open_ci_cost_fix']).toBe('fixes')
  })

  it('POSTs the fix for the configured project', async () => {
    const { client, calls } = await connect()
    const res = await client.callTool({ name: 'open_ci_cost_fix', arguments: { repo: 'kensaurus/glot.it', workflowPath: '.github/workflows/ci.yml', kind: 'skip_drafts' } })
    expect(res.isError).toBeFalsy()
    expect(calls).toEqual([{ url: '/v1/admin/ci/cost-fixes', method: 'POST', body: { projectId: PROJECT_ID, repo: 'kensaurus/glot.it', workflowPath: '.github/workflows/ci.yml', kind: 'skip_drafts' } }])
    await client.close()
  })

  it('refuses an unknown kind or a file outside .github/workflows before any call', async () => {
    const { client, calls } = await connect()
    const bad = [
      { repo: 'kensaurus/glot.it', workflowPath: '.github/workflows/ci.yml', kind: 'delete_workflow' },
      { repo: 'kensaurus/glot.it', workflowPath: 'package.json', kind: 'skip_drafts' },
      { repo: 'glot.it', workflowPath: '.github/workflows/ci.yml', kind: 'skip_drafts' },
    ]
    for (const args of bad) {
      const res = await client.callTool({ name: 'open_ci_cost_fix', arguments: args })
      expect(res.isError).toBe(true)
    }
    expect(calls).toEqual([])
    await client.close()
  })

  it('the hosted transport maps it to the same route and wraps it as untrusted', () => {
    const hosted = readFileSync(resolve(ROOT, 'packages/server/supabase/functions/mcp/index.ts'), 'utf8')
    expect(hosted).toMatch(/open_ci_cost_fix: \{\s+scope: 'mcp:write'/)
    expect(hosted).toContain("apiCall('/v1/admin/ci/cost-fixes'")
    const untrusted = hosted.match(/const UNTRUSTED_TOOLS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
    expect(untrusted).toContain("'open_ci_cost_fix'")
  })
})
