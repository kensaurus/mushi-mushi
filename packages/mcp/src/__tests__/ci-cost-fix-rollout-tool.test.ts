/**
 * "Apply to every app" for the CI cost fixes (ADR 0047 amendment):
 * preview_ci_cost_fix_rollout (read), apply_ci_cost_fix_rollout (write, one
 * draft PR per repo) and get_ci_cost_fix_bundle (read). Each calls its route,
 * the write refuses more than 10 repos, more than 20 items or a bad kind
 * before any call, and the hosted transport maps all three.
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
const BUNDLE = '5000000a-0000-4000-8000-000000000000'
const ROOT = resolve(__dirname, '../../../..')

async function connect() {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: url.replace(API_ENDPOINT, ''), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify({ ok: true, data: { repos: [], results: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  const server = createMushiServer({ version: '0.0.0-test', apiEndpoint: API_ENDPOINT, apiKey: API_KEY, projectId: PROJECT_ID, fetch: fetchStub })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'ci-cost-fix-rollout-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, calls }
}

const ITEM = { workflowPath: '.github/workflows/ci.yml', kind: 'skip_drafts' }

describe('CI cost fix rollout tools', () => {
  it('are in the fixes group; the write one says one draft PR per repo and asks to confirm', () => {
    const spec = (n: string) => TOOL_CATALOG.find((t) => t.name === n)
    expect(spec('preview_ci_cost_fix_rollout')?.scope).toBe('mcp:read')
    expect(spec('get_ci_cost_fix_bundle')?.scope).toBe('mcp:read')
    const apply = spec('apply_ci_cost_fix_rollout')
    expect(apply?.scope).toBe('mcp:write')
    expect(apply?.hints.readOnly).toBe(false)
    expect(apply?.description).toMatch(/ONE draft pull request per repo/)
    expect(apply?.description).toMatch(/Confirm with the user first/)
    for (const n of ['preview_ci_cost_fix_rollout', 'apply_ci_cost_fix_rollout', 'get_ci_cost_fix_bundle']) expect(TOOL_FEATURE_MAP[n]).toBe('fixes')
  })

  it('preview reads the configured project; apply POSTs the repos; the bundle is read by id', async () => {
    const { client, calls } = await connect()
    expect((await client.callTool({ name: 'preview_ci_cost_fix_rollout', arguments: {} })).isError).toBeFalsy()
    const repos = [{ projectId: PROJECT_ID, repo: 'kensaurus/glot.it', items: [ITEM] }]
    expect((await client.callTool({ name: 'apply_ci_cost_fix_rollout', arguments: { repos } })).isError).toBeFalsy()
    expect((await client.callTool({ name: 'get_ci_cost_fix_bundle', arguments: { bundleId: BUNDLE } })).isError).toBeFalsy()
    expect(calls).toEqual([
      { url: `/v1/admin/ci/cost-fix-rollout?project_id=${PROJECT_ID}`, method: 'GET', body: null },
      { url: '/v1/admin/ci/cost-fix-rollout', method: 'POST', body: { repos } },
      { url: `/v1/admin/ci/cost-fix-bundles/${BUNDLE}`, method: 'GET', body: null },
    ])
    await client.close()
  })

  it('apply refuses more than 10 repos, more than 20 items, a bad kind or path before any call', async () => {
    const { client, calls } = await connect()
    const repo = (items: unknown[]) => ({ projectId: PROJECT_ID, repo: 'kensaurus/glot.it', items })
    for (const repos of [
      Array.from({ length: 11 }, () => repo([ITEM])),
      [repo(Array.from({ length: 21 }, () => ITEM))],
      [repo([{ ...ITEM, kind: 'delete_workflow' }])],
      [repo([{ ...ITEM, workflowPath: 'package.json' }])],
      [],
    ]) {
      const res = await client.callTool({ name: 'apply_ci_cost_fix_rollout', arguments: { repos } })
      expect(res.isError).toBe(true)
    }
    expect((await client.callTool({ name: 'get_ci_cost_fix_bundle', arguments: { bundleId: 'nope' } })).isError).toBe(true)
    expect(calls).toEqual([])
    await client.close()
  })

  it('the hosted transport maps all three and wraps them as untrusted', () => {
    const hosted = readFileSync(resolve(ROOT, 'packages/server/supabase/functions/mcp/index.ts'), 'utf8')
    expect(hosted).toMatch(/apply_ci_cost_fix_rollout: \{\s+scope: 'mcp:write'/)
    expect(hosted).toContain("apiCall('/v1/admin/ci/cost-fix-rollout'")
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'packages/server/supabase/functions/_shared/mcp-hosted-tool-manifest.json'), 'utf8'))
    expect(manifest.preview_ci_cost_fix_rollout.path).toBe('/v1/admin/ci/cost-fix-rollout?project_id={projectId}')
    expect(manifest.get_ci_cost_fix_bundle.path).toBe('/v1/admin/ci/cost-fix-bundles/{bundleId}')
    const untrusted = hosted.match(/const UNTRUSTED_TOOLS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
    for (const n of ['preview_ci_cost_fix_rollout', 'apply_ci_cost_fix_rollout', 'get_ci_cost_fix_bundle']) expect(untrusted).toContain(`'${n}'`)
  })
})
