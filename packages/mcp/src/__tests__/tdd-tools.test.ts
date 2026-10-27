/**
 * FILE: packages/mcp/src/__tests__/tdd-tools.test.ts
 * PURPOSE: Unit tests for TDD / Story-mapping MCP tools (Phase 4).
 *
 * RED → write tests first → GREEN → pass → REFACTOR
 *
 * Tests cover:
 * - map_user_stories: passes correct body, returns runId
 * - generate_tdd_from_story: passes story id, automation_mode
 * - approve_qa_story: sends PATCH with correct status
 * - list_byok_keys: GET with project_id query param
 * - add_byok_key: POST with correct body
 * - list_pending_review_stories: GET returns stories
 * - list_qa_story_runs / get_qa_story_run: projectId, project_id alias, docs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { TDD_TOOL_CATALOG } from '../catalog.js'
import { createMushiServer } from '../server.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
/** Sentence the catalog, discovery card, and generated docs must share. */
const PROJECT_PARAM = 'Optional projectId (project_id is accepted too)'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const API_KEY = 'TEST-FIXTURE-NOT-A-REAL-SECRET'
const PROJECT_ID = 'proj-test-uuid-1234'

interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function createStubFetch() {
  const calls: FetchCall[] = []
  const queue: Array<{ status: number; body: unknown }> = []

  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    if (init?.headers) {
      const h = init.headers as Record<string, string>
      Object.entries(h).forEach(([k, v]) => { headers[k] = v })
    }
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url, method: init?.method ?? 'GET', headers, body })

    const next = queue.shift()
    if (!next) throw new Error(`No queued response for ${init?.method ?? 'GET'} ${url}`)
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch

  return {
    stub,
    calls,
    pushOk: (data: unknown) => queue.push({ status: 200, body: { ok: true, data } }),
    pushErr: (status: number, code: string, message: string) =>
      queue.push({ status, body: { ok: false, error: { code, message } } }),
    lastCall: () => calls.at(-1)!,
  }
}

async function createConnectedClient(fetchStub: typeof fetch) {
  const server = createMushiServer({
    version: '0.0.0-test',
    apiEndpoint: API_ENDPOINT,
    apiKey: API_KEY,
    projectId: PROJECT_ID,
    fetch: fetchStub,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client(
    { name: 'mushi-mcp-tdd-test', version: '0.0.0' },
    { capabilities: {} },
  )
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return { client, server }
}

describe('TDD MCP tools', () => {
  let fetchMock: ReturnType<typeof createStubFetch>
  let client: Client

  beforeEach(async () => {
    fetchMock = createStubFetch()
    const conn = await createConnectedClient(fetchMock.stub)
    client = conn.client
  })

  afterEach(async () => {
    await client.close().catch(() => {})
  })


  describe('map_user_stories', () => {
    it('calls POST /map-from-live with correct body and returns runId', async () => {
      fetchMock.pushOk({ runId: 'run-abc-123', status: 'pending' })

      const result = await client.callTool({
        name: 'map_user_stories',
        arguments: {
          projectId: PROJECT_ID,
          baseUrl: 'https://my-app.vercel.app',
          maxPages: 10,
          provider: 'firecrawl',
        },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain(`/inventory/${PROJECT_ID}/map-from-live`)
      expect(call.method).toBe('POST')
      expect(call.body).toMatchObject({
        base_url: 'https://my-app.vercel.app',
        max_pages: 10,
        provider: 'firecrawl',
      })
      expect(call.headers['X-Mushi-Api-Key']).toBe(API_KEY)

      const text = (result.content as Array<{ type: string; text: string }>)[0].text
      const parsed = JSON.parse(text) as { runId: string }
      expect(parsed.runId).toBe('run-abc-123')
    })

    it('returns error when projectId is missing', async () => {
      const res = await client.callTool({ name: 'map_user_stories', arguments: { baseUrl: 'https://test.com' } })
      // MCP SDK validates schema and returns isError rather than throwing
      expect(res.isError).toBe(true)
    })
  })

  describe('generate_tdd_from_story', () => {
    it('calls POST /stories/:id/generate-test with automation_mode', async () => {
      fetchMock.pushOk({
        qaStoryId: 'qa-story-abc',
        prUrl: 'https://github.com/org/repo/pull/42',
        approvalStatus: 'pending_review',
        needsHumanReview: false,
      })

      await client.callTool({
        name: 'generate_tdd_from_story',
        arguments: {
          projectId: PROJECT_ID,
          storyNodeId: 'user-login',
          automationMode: 'review',
          openPr: true,
        },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain(`/inventory/${PROJECT_ID}/stories/user-login/generate-test`)
      expect(call.method).toBe('POST')
      expect(call.body).toMatchObject({ automation_mode: 'review', open_pr: true })
    })
  })

  describe('approve_qa_story', () => {
    it('sends PATCH with approved status', async () => {
      fetchMock.pushOk({ status: 'approved' })

      await client.callTool({
        name: 'approve_qa_story',
        arguments: { projectId: PROJECT_ID, qaStoryId: 'qa-story-xyz', status: 'approved' },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain(`/inventory/${PROJECT_ID}/stories/qa-story-xyz/approval`)
      expect(call.method).toBe('PATCH')
      expect(call.body).toMatchObject({ status: 'approved' })
    })

    it('sends PATCH with rejected status', async () => {
      fetchMock.pushOk({ status: 'rejected' })

      await client.callTool({
        name: 'approve_qa_story',
        arguments: { projectId: PROJECT_ID, qaStoryId: 'qa-story-xyz', status: 'rejected' },
      })

      const call = fetchMock.lastCall()
      expect(call.body).toMatchObject({ status: 'rejected' })
    })
  })

  describe('list_byok_keys', () => {
    it('calls GET /byok/keys with project_id query param', async () => {
      fetchMock.pushOk({ keys: [{ id: 'key-1', provider_slug: 'anthropic', status: 'active', priority: 100, label: null, cooldown_until: null }] })

      const result = await client.callTool({
        name: 'list_byok_keys',
        arguments: { projectId: PROJECT_ID },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain('/byok/keys')
      expect(call.url).toContain(encodeURIComponent(PROJECT_ID))
      expect(call.method).toBe('GET')

      const text = (result.content as Array<{ type: string; text: string }>)[0].text
      expect(text).toContain('anthropic')
    })
  })

  describe('add_byok_key', () => {
    it('calls POST /byok/keys with provider and key', async () => {
      fetchMock.pushOk({ id: 'new-key-id' })

      await client.callTool({
        name: 'add_byok_key',
        arguments: {
          projectId: PROJECT_ID,
          provider: 'anthropic',
          key: 'sk-ant-testkey12345678901',
          label: 'Backup Anthropic',
          priority: 50,
        },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain('/byok/keys')
      expect(call.method).toBe('POST')
      expect(call.body).toMatchObject({
        provider_slug: 'anthropic',
        label: 'Backup Anthropic',
        priority: 50,
      })
    })
  })

  describe('test_byok_key', () => {
    it('calls the per-key validation endpoint', async () => {
      const keyId = '3a1763bf-5a64-4e42-abde-85dc0219787d'
      fetchMock.pushOk({
        key: { id: keyId, status: 'active', test_status: 'ok' },
        validation: { status: 'ok' },
      })

      await client.callTool({
        name: 'test_byok_key',
        arguments: { projectId: PROJECT_ID, keyId },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain(`/byok/keys/${keyId}/test`)
      expect(call.method).toBe('POST')
    })
  })

  describe('remove_byok_key', () => {
    it('calls DELETE for one pooled key', async () => {
      const keyId = '3a1763bf-5a64-4e42-abde-85dc0219787d'
      fetchMock.pushOk({ removed: true })

      await client.callTool({
        name: 'remove_byok_key',
        arguments: { projectId: PROJECT_ID, keyId },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain(`/byok/keys/${keyId}`)
      expect(call.method).toBe('DELETE')
    })
  })

  describe('list_pending_review_stories', () => {
    it('returns stories from pending review endpoint', async () => {
      fetchMock.pushOk({
        stories: [
          { id: 'qa-1', name: 'Login flow test', origin_story_node_id: 'user-login', automation_mode: 'review', approval_status: 'pending_review', generated_pr_url: null, created_at: new Date().toISOString() },
        ],
      })

      const result = await client.callTool({
        name: 'list_pending_review_stories',
        arguments: { projectId: PROJECT_ID },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain(`/inventory/${PROJECT_ID}/stories/pending-review`)
      expect(call.method).toBe('GET')

      const text = (result.content as Array<{ type: string; text: string }>)[0].text
      expect(text).toContain('Login flow test')
    })
  })

  describe('run_qa_story', () => {
    it('calls POST /qa-stories/:id/run', async () => {
      fetchMock.pushOk({ runId: 'run-xyz' })

      await client.callTool({
        name: 'run_qa_story',
        arguments: { projectId: PROJECT_ID, qaStoryId: 'qa-story-abc' },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain(`/projects/${PROJECT_ID}/qa-stories/qa-story-abc/run`)
      expect(call.method).toBe('POST')
    })
  })

  describe('list_qa_story_runs', () => {
    it('reads runs for the configured project and sends that project header', async () => {
      fetchMock.pushOk({ runs: [{ id: 'run-1', status: 'passed' }] })

      await client.callTool({
        name: 'list_qa_story_runs',
        arguments: { storyId: 'story-1', limit: 5 },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain(`/projects/${PROJECT_ID}/qa-stories/story-1/runs?limit=5`)
      expect(call.headers['X-Mushi-Project-Id']).toBe(PROJECT_ID)
    })

    it('refuses another project on a project-bound connection before calling the API', async () => {
      const result = await client.callTool({
        name: 'list_qa_story_runs',
        arguments: { storyId: 'story-1', projectId: 'other-project' },
      })

      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('PROJECT_SCOPE_MISMATCH')
      expect(fetchMock.calls).toHaveLength(0)
    })

    it('advertises projectId and names the project_id alias', async () => {
      const { tools } = await client.listTools()
      for (const name of ['list_qa_story_runs', 'get_qa_story_run']) {
        const props = tools.find((t) => t.name === name)!.inputSchema.properties as Record<string, { description?: string }>
        expect(props.project_id, name).toBeUndefined()
        expect(props.projectId?.description, name).toContain('`project_id` is accepted too')
      }
    })

    it('uses the projectId an account connection passes, including project_id', async () => {
      const other = '2000000b-0000-4000-8000-000000000000'
      const accountFetch = createStubFetch()
      accountFetch.pushOk({ runs: [] })
      const server = createMushiServer({
        version: '0.0.0-test',
        apiEndpoint: API_ENDPOINT,
        apiKey: API_KEY,
        fetch: accountFetch.stub,
      })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      const account = new Client({ name: 'mushi-mcp-tdd-account', version: '0.0.0' }, { capabilities: {} })
      await Promise.all([server.connect(serverTransport), account.connect(clientTransport)])
      try {
        await account.callTool({
          name: 'list_qa_story_runs',
          arguments: { storyId: 'story-1', project_id: other },
        })
      } finally {
        await account.close().catch(() => {})
      }
      const call = accountFetch.lastCall()
      expect(call.url).toContain(`/projects/${other}/qa-stories/story-1/runs`)
      expect(call.headers['X-Mushi-Project-Id']).toBe(other)
    })
  })

  describe('get_qa_story_run', () => {
    it('picks the run from the unwrapped runs list for the named project', async () => {
      fetchMock.pushOk({
        runs: [
          { id: 'run-other', status: 'passed' },
          { id: 'run-1', status: 'failed', error_message: 'button missing' },
        ],
      })

      const result = await client.callTool({
        name: 'get_qa_story_run',
        arguments: { storyId: 'story-1', runId: 'run-1' },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain(`/projects/${PROJECT_ID}/qa-stories/story-1/runs?limit=50`)
      expect(call.headers['X-Mushi-Project-Id']).toBe(PROJECT_ID)
      const text = (result.content as Array<{ type: string; text: string }>)[0].text
      expect(text).toContain('button missing')
      expect(text).not.toContain('run-other')
    })

    it('uses project_id on an account connection', async () => {
      const other = '2000000b-0000-4000-8000-000000000000'
      const accountFetch = createStubFetch()
      accountFetch.pushOk({ runs: [{ id: 'run-9', status: 'failed', error_message: 'missing' }] })
      const server = createMushiServer({
        version: '0.0.0-test',
        apiEndpoint: API_ENDPOINT,
        apiKey: API_KEY,
        fetch: accountFetch.stub,
      })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      const account = new Client({ name: 'mushi-mcp-tdd-account-run', version: '0.0.0' }, { capabilities: {} })
      await Promise.all([server.connect(serverTransport), account.connect(clientTransport)])
      try {
        const result = await account.callTool({
          name: 'get_qa_story_run',
          arguments: { storyId: 'story-1', runId: 'run-9', project_id: other },
        })
        const text = (result.content as Array<{ type: string; text: string }>)[0].text
        expect(text).toContain('missing')
      } finally {
        await account.close().catch(() => {})
      }
      const call = accountFetch.lastCall()
      expect(call.url).toContain(`/projects/${other}/qa-stories/story-1/runs`)
      expect(call.headers['X-Mushi-Project-Id']).toBe(other)
    })
  })

  describe('improve_qa_story', () => {
    it('calls POST /pdca/improve-qa-stories with project_id', async () => {
      fetchMock.pushOk({ improved: 3 })

      const result = await client.callTool({
        name: 'improve_qa_story',
        arguments: { projectId: PROJECT_ID },
      })

      const call = fetchMock.lastCall()
      expect(call.url).toContain('/pdca/improve-qa-stories')
      expect(call.method).toBe('POST')
      expect(call.body).toMatchObject({ project_id: PROJECT_ID })

      const text = (result.content as Array<{ type: string; text: string }>)[0].text
      expect(text).toContain('3')
    })
  })
})

describe('QA run tool project parameter', () => {
  const names = ['list_qa_story_runs', 'get_qa_story_run'] as const

  function registration(name: string): string {
    const src = readFileSync(resolve(REPO_ROOT, 'packages/mcp/src/server.ts'), 'utf8')
    const marker = `server.registerTool(\n    '${name}'`
    const start = src.indexOf(marker)
    expect(start, name).toBeGreaterThan(-1)
    const next = src.indexOf('\n  server.registerTool(', start + marker.length)
    return src.slice(start, next === -1 ? undefined : next)
  }

  it('documents projectId and project_id in the catalog and generated docs', () => {
    for (const name of names) {
      const tool = TDD_TOOL_CATALOG.find((t) => t.name === name)
      expect(tool?.description, name).toContain(PROJECT_PARAM)
    }

    const mdx = readFileSync(resolve(REPO_ROOT, 'apps/docs/content/sdks/mcp-tools.mdx'), 'utf8')
    const twin = readFileSync(resolve(REPO_ROOT, 'apps/docs/public/llm-md/sdks/mcp-tools.md'), 'utf8')
    const full = readFileSync(resolve(REPO_ROOT, 'apps/docs/public/llms-full.txt'), 'utf8')
    const glama = JSON.parse(readFileSync(resolve(REPO_ROOT, 'glama.json'), 'utf8')) as {
      tools: Array<{ name: string; description: string }>
    }
    const discovery = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'packages/server/supabase/functions/_shared/mcp-discovery-tools.json'), 'utf8'),
    ) as { tools: Record<string, { description: string }> }

    for (const name of names) {
      const row = `| \`${name}\` |`
      expect(mdx.split('\n').find((line) => line.startsWith(row)), name).toContain(PROJECT_PARAM)
      expect(twin.split('\n').find((line) => line.startsWith(row)), name).toContain(PROJECT_PARAM)
      expect(full.split('\n').find((line) => line.startsWith(row)), name).toContain(PROJECT_PARAM)
      expect(glama.tools.find((t) => t.name === name)?.description, name).toContain(PROJECT_PARAM)
      expect(discovery.tools[name]?.description, name).toContain(PROJECT_PARAM)
    }
  })

  it('points both schemas at the snake_case normaliser', () => {
    for (const name of names) {
      const block = registration(name)
      expect(block, name).toContain('acceptSnakeCaseAliases')
      expect(block, name).toContain('normalizeArgAliases')
    }
  })
})
