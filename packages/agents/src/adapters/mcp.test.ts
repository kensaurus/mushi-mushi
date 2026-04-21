/**
 * FILE: packages/agents/src/adapters/mcp.test.ts
 * PURPOSE: Cover the MCP fix-agent JSON-RPC contract + SEP-1686 task polling
 *          (V5.3 §2.10, M7).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { McpFixAgent } from './mcp.js'
import type { FixContext } from '../types.js'

// `component` is consumed as a path prefix by `checkFileScope` (see
// scope.test.ts), not as a bare name. Storing 'Checkout' would make
// 'src/Checkout/x.ts'.startsWith(component) return false and cause the
// "passes valid fixes" test below to fail for a fixture-only reason.
const ctx: FixContext = {
  reportId: 'rep-87654321',
  projectId: 'proj-1',
  report: { description: 'd', category: 'BUG', severity: 'P3', component: 'src/Checkout' },
  reproductionSteps: ['step1'],
  relevantCode: [{ path: 'src/Checkout/index.tsx', content: 'export {}' }],
  config: { maxLines: 200, scopeRestriction: 'component', repoUrl: 'https://github.com/x/y.git' },
}

interface MockFetchCall {
  url: string
  body: { method: string; params?: { id?: string; name?: string; arguments?: unknown } }
}

function setFetch(impl: (call: MockFetchCall) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    return impl({ url: String(url), body })
  }) as unknown as typeof fetch
}

describe('McpFixAgent — JSON-RPC tools/call (V5.3 §2.10)', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.useRealTimers() })

  it('returns a normalized FixResult on synchronous tools/call success', async () => {
    setFetch(() => new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'json', data: {
          success: true,
          branch: 'mushi/fix-87654321',
          filesChanged: ['src/Checkout/index.tsx'],
          linesChanged: 12,
          summary: 'Fixed null deref',
        } }],
      },
    }), { status: 200 }))

    const agent = new McpFixAgent({ serverUrl: 'http://mcp.example.com', sdkMode: 'hand-rolled' })
    const r = await agent.generateFix(ctx)
    expect(r.success).toBe(true)
    expect(r.linesChanged).toBe(12)
    expect(r.filesChanged).toEqual(['src/Checkout/index.tsx'])
  })

  it('falls back to parsing JSON inside a text content item', async () => {
    setFetch(() => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify({ success: true, filesChanged: [], linesChanged: 0, summary: 'noop' }) }] },
    }), { status: 200 }))
    const r = await new McpFixAgent({ serverUrl: 'http://x', sdkMode: 'hand-rolled' }).generateFix(ctx)
    expect(r.success).toBe(true)
  })

  it('marks as failed when isError is true', async () => {
    setFetch(() => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: { isError: true, content: [{ type: 'text', text: 'OOM' }] },
    }), { status: 200 }))
    const r = await new McpFixAgent({ serverUrl: 'http://x', sdkMode: 'hand-rolled' }).generateFix(ctx)
    expect(r.success).toBe(false)
    expect(r.error).toContain('OOM')
  })

  it('surfaces JSON-RPC error.code as a failed FixResult', async () => {
    setFetch(() => new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' },
    }), { status: 200 }))
    const r = await new McpFixAgent({ serverUrl: 'http://x', sdkMode: 'hand-rolled' }).generateFix(ctx)
    expect(r.success).toBe(false)
    expect(r.error).toContain('-32601')
    expect(r.error).toContain('Method not found')
  })

  it('forwards Bearer token on the handshake request', async () => {
    let captured: string | undefined
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      captured = (init?.headers as Record<string, string>)?.Authorization
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'json', data: { success: true, filesChanged: [], linesChanged: 0, summary: '' } }] } }), { status: 200 })
    }) as unknown as typeof fetch

    await new McpFixAgent({ serverUrl: 'http://x', bearer: 'sekret', sdkMode: 'hand-rolled' }).generateFix(ctx)
    expect(captured).toBe('Bearer sekret')
  })
})

describe('McpFixAgent — SEP-1686 Tasks polling (V5.3 §2.10)', () => {
  it('polls tasks/get until completion and returns the embedded result', async () => {
    const sequence: Array<() => Response> = [
      () => new Response(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: { task: { id: 'task-1', status: 'queued' } },
      }), { status: 200 }),
      () => new Response(JSON.stringify({
        jsonrpc: '2.0', id: 2,
        result: { id: 'task-1', status: 'running' },
      }), { status: 200 }),
      () => new Response(JSON.stringify({
        jsonrpc: '2.0', id: 3,
        result: {
          id: 'task-1', status: 'completed',
          result: { content: [{ type: 'json', data: { success: true, branch: 'b', filesChanged: ['a.ts'], linesChanged: 3, summary: 'ok' } }] },
        },
      }), { status: 200 }),
    ]
    let i = 0
    setFetch(() => sequence[i++]())

    const agent = new McpFixAgent({ serverUrl: 'http://x', pollIntervalMs: 1, timeoutMs: 5_000, sdkMode: 'hand-rolled' })
    const r = await agent.generateFix(ctx)
    expect(r.success).toBe(true)
    expect(r.linesChanged).toBe(3)
    expect(i).toBe(3)
  })

  it('cancels and throws on timeout', async () => {
    let cancelled = false
    setFetch(({ body }) => {
      if (body.method === 'tools/call') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { task: { id: 't', status: 'queued' } } }), { status: 200 })
      }
      if (body.method === 'tasks/get') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { id: 't', status: 'running' } }), { status: 200 })
      }
      if (body.method === 'tasks/cancel') {
        cancelled = true
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { id: 't', status: 'cancelled' } }), { status: 200 })
      }
      return new Response('', { status: 500 })
    })

    const agent = new McpFixAgent({ serverUrl: 'http://x', pollIntervalMs: 5, timeoutMs: 20, sdkMode: 'hand-rolled' })
    const r = await agent.generateFix(ctx)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/timed out/)
    expect(cancelled).toBe(true)
  })

  it('reports failed tasks with the server-provided message', async () => {
    let phase = 0
    setFetch(() => {
      phase++
      if (phase === 1) {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { task: { id: 't', status: 'queued' } } }), { status: 200 })
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0', id: 2,
        result: { id: 't', status: 'failed', error: { code: 1, message: 'context exceeded' } },
      }), { status: 200 })
    })
    const r = await new McpFixAgent({ serverUrl: 'http://x', pollIntervalMs: 1, sdkMode: 'hand-rolled' }).generateFix(ctx)
    expect(r.success).toBe(false)
    expect(r.error).toContain('context exceeded')
  })
})

describe('McpFixAgent.validateResult', () => {
  const a = new McpFixAgent({ serverUrl: 'http://x' })
  it('rejects fixes outside component scope', () => {
    const v = a.validateResult(ctx, { success: true, branch: 'b', filesChanged: ['src/Auth/login.ts'], linesChanged: 10, summary: '' })
    expect(v.valid).toBe(false)
  })
  it('rejects fixes that exceed maxLines', () => {
    const v = a.validateResult(ctx, { success: true, branch: 'b', filesChanged: ['src/Checkout/x.ts'], linesChanged: 999, summary: '' })
    expect(v.valid).toBe(false)
  })
  it('passes valid fixes', () => {
    const v = a.validateResult(ctx, { success: true, branch: 'b', filesChanged: ['src/Checkout/x.ts'], linesChanged: 10, summary: '' })
    expect(v.valid).toBe(true)
  })
})
