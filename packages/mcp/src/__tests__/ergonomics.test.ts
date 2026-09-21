/**
 * FILE: packages/mcp/src/__tests__/ergonomics.test.ts
 * PURPOSE: MCP ergonomics findings from the 2026-09 GTM audit:
 *   - get_recent_reports returned the list route's ~30 columns raw, including
 *     end_user_id, reporter_token_hash and session_id, against a documented 6;
 *   - search_mushi_docs returned `path` where its description promised `url`,
 *     scored stopwords, ignored section headings, and had no full-page tool;
 *   - with no API key the server exited 1, so an installer saw a dead server.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/server'
import { createMushiServer, createSetupModeServer, SETUP_MODE_TOOLS } from '../server.js'
import { MUSHI_DOCS_INDEX, findMushiDoc, searchMushiDocs } from '../docs-index.js'

/** The public docs site every indexed url and Markdown twin lives under. */
const MUSHI_DOCS_BASE = 'https://kensaur.us/mushi-mushi/docs'
const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const API_KEY = 'mushi_test_key_0123456789'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

interface Call {
  url: string
  headers: Record<string, string>
}

function recordingFetch(respond: (url: string) => Response) {
  const calls: Call[] = []
  const stub = (async (input: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers as Record<string, string> | undefined) ?? {})) {
      headers[k.toLowerCase()] = v
    }
    calls.push({ url: String(input), headers })
    return respond(String(input))
  }) as typeof fetch
  return { stub, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let client: Client | null = null

async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const c = new Client({ name: 'ergonomics-test', version: '0.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), c.connect(clientTransport)])
  client = c
  return c
}

function normalServer(stub: typeof fetch): McpServer {
  return createMushiServer({ version: '0.0.0-test', apiEndpoint: API_ENDPOINT, apiKey: API_KEY, projectId: PROJECT_ID, fetch: stub })
}

afterEach(async () => {
  await client?.close()
  client = null
})

describe('get_recent_reports projection', () => {
  const row = {
    id: 'r1',
    status: 'classified',
    category: 'bug',
    severity: 'high',
    summary: 'Pay button dead',
    component: 'Checkout',
    created_at: '2026-09-20T00:00:00Z',
    processing_error: null,
    description: 'long reporter text',
    breadcrumbs: [{ category: 'click' }],
    end_user_id: 'eu_1',
    reporter_token_hash: 'hash_1',
    session_id: 'sess_1',
    reporter_display_name: 'Jane Doe',
  }

  it('returns the documented fields and no reporter identifiers', async () => {
    const { stub } = recordingFetch(() => json({ ok: true, data: { reports: [row], total: 1 } }))
    const c = await connect(normalServer(stub))
    const res = await c.callTool({ name: 'get_recent_reports', arguments: {} })
    const { reports } = res.structuredContent as { reports: Array<Record<string, unknown>> }
    expect(reports[0]).toEqual({
      id: 'r1',
      status: 'classified',
      category: 'bug',
      severity: 'high',
      summary: 'Pay button dead',
      component: 'Checkout',
      created_at: '2026-09-20T00:00:00Z',
      processing_error: null,
    })
  })

  it('include_raw returns every other column but still strips reporter identifiers', async () => {
    const { stub } = recordingFetch(() => json({ ok: true, data: { reports: [row], total: 1 } }))
    const c = await connect(normalServer(stub))
    const res = await c.callTool({ name: 'get_recent_reports', arguments: { include_raw: true } })
    const { reports } = res.structuredContent as { reports: Array<Record<string, unknown>> }
    expect(reports[0]).toHaveProperty('breadcrumbs')
    expect(reports[0]).toHaveProperty('description')
    for (const key of ['end_user_id', 'reporter_token_hash', 'session_id', 'reporter_display_name']) {
      expect(reports[0], key).not.toHaveProperty(key)
    }
  })

  it('rejects a status outside the vocabulary before calling the API', async () => {
    const { stub, calls } = recordingFetch(() => json({ ok: true, data: { reports: [], total: 0 } }))
    const c = await connect(normalServer(stub))
    const res = await c.callTool({ name: 'get_recent_reports', arguments: { status: 'open' } }).catch((e: unknown) => e)
    const failed = res instanceof Error || (res as { isError?: boolean }).isError === true
    expect(failed).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe('docs search and get_mushi_doc', () => {
  it('ignores stopwords and matches section headings', () => {
    const top = searchMushiDocs('how do I set up the MCP server with OAuth', 3)
    expect(top[0]?.route).toBe('/quickstart/mcp')
    // Stopword-only queries still return something instead of nothing.
    expect(searchMushiDocs('how do I', 3).length).toBeGreaterThan(0)
  })

  it('search_mushi_docs returns url, the field its description promises', async () => {
    const { stub } = recordingFetch(() => json({}))
    const c = await connect(normalServer(stub))
    const res = await c.callTool({ name: 'search_mushi_docs', arguments: { query: 'mcp quickstart', limit: 2 } })
    const { results } = res.structuredContent as { results: Array<Record<string, unknown>> }
    expect(results[0]).toHaveProperty('url')
    expect(results[0]).not.toHaveProperty('path')
    expect(String(results[0]!.url).startsWith(MUSHI_DOCS_BASE)).toBe(true)
  })

  it('findMushiDoc resolves urls and routes, and nothing outside the index', () => {
    const entry = MUSHI_DOCS_INDEX.find((e) => e.route === '/quickstart/mcp')!
    expect(findMushiDoc(entry.url)).toBe(entry)
    expect(findMushiDoc('/quickstart/mcp/')).toBe(entry)
    expect(findMushiDoc('quickstart/mcp')).toBe(entry)
    expect(findMushiDoc(`${MUSHI_DOCS_BASE}/`)?.route).toBe('/')
    expect(findMushiDoc('https://evil.example/quickstart/mcp')).toBeNull()
    expect(findMushiDoc('/../../etc/passwd')).toBeNull()
  })

  it('fetches the public Markdown twin without Mushi credentials and caps it', async () => {
    const long = '# MCP\n' + 'x'.repeat(9000)
    const { stub, calls } = recordingFetch(() => new Response(long, { status: 200, headers: { 'Content-Type': 'text/markdown' } }))
    const c = await connect(normalServer(stub))
    const res = await c.callTool({ name: 'get_mushi_doc', arguments: { page: '/quickstart/mcp' } })
    expect(res.isError).toBeFalsy()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${MUSHI_DOCS_BASE}/llm-md/quickstart/mcp.md`)
    expect(calls[0]!.headers).not.toHaveProperty('authorization')
    expect(calls[0]!.headers).not.toHaveProperty('x-mushi-api-key')
    const doc = res.structuredContent as { markdown: string; truncated: boolean; url: string }
    expect(doc.truncated).toBe(true)
    expect(doc.markdown.length).toBeLessThan(8200)
    expect(doc.markdown).toContain(doc.url)
  })

  it('explains an unknown page instead of fetching it', async () => {
    const { stub, calls } = recordingFetch(() => new Response('nope', { status: 500 }))
    const c = await connect(normalServer(stub))
    const res = await c.callTool({ name: 'get_mushi_doc', arguments: { page: '/not/a/page' } })
    expect(res.isError).toBe(true)
    expect(JSON.stringify(res.content)).toMatch(/search_mushi_docs/)
    expect(calls).toHaveLength(0)
  })
})

describe('setup mode (no API key)', () => {
  function setupServer(stub: typeof fetch): McpServer {
    return createSetupModeServer({ version: '0.0.0-test', missingKeyReport: 'no key: env MUSHI_API_KEY not set', fetch: stub })
  }

  it('lists only the key-free tools and nothing that needs the API', async () => {
    const { stub } = recordingFetch(() => json({}))
    const c = await connect(setupServer(stub))
    const { tools } = await c.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...SETUP_MODE_TOOLS].sort())
    expect(c.getServerCapabilities()?.resources).toBeDefined()
    const { resources } = await c.listResources()
    expect(resources).toEqual([])
    expect(c.getInstructions()).toMatch(/setup mode/)
  })

  it('diagnose_setup explains how to connect without calling the API', async () => {
    const { stub, calls } = recordingFetch(() => json({}))
    const c = await connect(setupServer(stub))
    const res = await c.callTool({ name: 'diagnose_setup', arguments: {} })
    expect(res.isError).toBeFalsy()
    const text = (res.content as Array<{ text: string }>)[0]!.text
    const diagnosis = JSON.parse(text) as { ready: boolean; nextAction: string; details: string }
    expect(diagnosis.ready).toBe(false)
    expect(diagnosis.nextAction).toMatch(/npx mushi-mushi/)
    expect(diagnosis.details).toContain('MUSHI_API_KEY not set')
    expect(calls).toHaveLength(0)
  })

  it('still searches the docs', async () => {
    const { stub } = recordingFetch(() => json({}))
    const c = await connect(setupServer(stub))
    const res = await c.callTool({ name: 'search_mushi_docs', arguments: { query: 'mcp' } })
    expect(res.isError).toBeFalsy()
  })
})
