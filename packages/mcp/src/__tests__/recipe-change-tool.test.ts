/**
 * FILE: packages/mcp/src/__tests__/recipe-change-tool.test.ts
 * PURPOSE: propose_recipe_change carries each edit's baseSha (the blob SHA the
 *          dry run diffed against) to POST /recipe/changes, so the server's
 *          stale-base guard refuses a confirm whose file changed since the
 *          dry run. Before, the tool's input schema dropped the field.
 */

import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'

const PROJECT_ID = '1000000a-0000-4000-8000-000000000000'

async function connect() {
  const bodies: unknown[] = []
  const fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(init?.body ? JSON.parse(init.body as string) : undefined)
    return new Response(JSON.stringify({ ok: true, data: { dryRun: true, ok: true, reason: null, files: [], denied: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  const server = createMushiServer({ version: '0.0.0-test', apiEndpoint: 'https://api.test.mushimushi.dev', apiKey: 'TEST-FIXTURE-NOT-A-REAL-SECRET', projectId: PROJECT_ID, fetch: fetchStub })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'mushi-mcp-recipe-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, bodies }
}

describe('propose_recipe_change', () => {
  it('sends each edit’s baseSha (a SHA, or null for a new file) with the confirm', async () => {
    const { client, bodies } = await connect()
    const edits = [
      { path: 'mushi.recipe.json', content: '{"version":1}\n', baseSha: 'abc123' },
      { path: '.env.example', content: 'API_URL=\n', baseSha: null },
    ]
    const res = await client.callTool({ name: 'propose_recipe_change', arguments: { element: 'env', edits, confirm: true } })
    expect(res.isError).not.toBe(true)
    expect(bodies[0]).toEqual({ element: 'env', edits, dryRun: false })
  })

  it('leaves baseSha out when the caller did not send one (unchecked, as before)', async () => {
    const { client, bodies } = await connect()
    await client.callTool({ name: 'propose_recipe_change', arguments: { element: 'gates', edits: [{ path: 'mushi.recipe.json', content: '{}\n' }] } })
    expect(bodies[0]).toEqual({ element: 'gates', edits: [{ path: 'mushi.recipe.json', content: '{}\n' }], dryRun: true })
  })
})
