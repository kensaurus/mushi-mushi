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
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMushiServer } from '../server.js'

const API_ENDPOINT = 'https://api.test.mushimushi.dev'
const API_KEY = 'mushi_test_key_0123456789'
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
