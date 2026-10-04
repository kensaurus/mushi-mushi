/**
 * Streamable HTTP MCP sessions (Sentry MUSHI-MUSHI-SERVER-29, 2026-10-04):
 * the hosted Supabase MCP refuses a bare tools/call with 400
 * "Mcp-Session-Id header is required". The client must initialize first.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mcpCallTool, resetMcpSessions } from '../../supabase/functions/_shared/mcp-http-session.ts'

interface Seen { method: string; session: string | null; version: string | null }

function server(opts: { sessionId?: string | null; sse?: boolean; expireFirstCall?: boolean; initStatus?: number } = {}) {
  const seen: Seen[] = []
  let calls = 0
  const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { method: string; id?: number }
    const h = new Headers(init?.headers)
    seen.push({ method: body.method, session: h.get('mcp-session-id'), version: h.get('mcp-protocol-version') })
    if (body.method === 'initialize') {
      if (opts.initStatus) return new Response('nope', { status: opts.initStatus })
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (opts.sessionId !== null) headers['mcp-session-id'] = opts.sessionId ?? 'sess-1'
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-06-18' } }), { status: 200, headers })
    }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    calls++
    if (opts.sessionId !== null && !h.get('mcp-session-id')) {
      return new Response('{"message":"Mcp-Session-Id header is required for non-initialization requests"}', { status: 400 })
    }
    if (opts.expireFirstCall && calls === 1) return new Response('gone', { status: 404 })
    const msg = { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '[{"name":"reports"}]' }] } }
    return opts.sse
      ? new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      : new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { seen, fetchImpl }
}

const URL_ = 'https://mcp.example/mcp?project_ref=abc&read_only=true'

beforeEach(() => resetMcpSessions())

describe('mcpCallTool', () => {
  it('initializes, then calls with the session id and protocol version', async () => {
    const s = server()
    const r = await mcpCallTool({ url: URL_, token: 'tok-12345678', fetchImpl: s.fetchImpl }, 'list_tables')
    expect(r.error).toBeNull()
    expect(r.result?.content?.[0]?.text).toBe('[{"name":"reports"}]')
    expect(s.seen.map((x) => x.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    expect(s.seen[2]).toMatchObject({ session: 'sess-1', version: '2025-06-18' })
  })

  it('reads an SSE answer', async () => {
    const s = server({ sse: true })
    const r = await mcpCallTool({ url: URL_, token: 'tok-12345678', fetchImpl: s.fetchImpl }, 'list_tables')
    expect(r.result?.content?.[0]?.text).toBe('[{"name":"reports"}]')
  })

  it('reuses the session for the next call', async () => {
    const s = server()
    await mcpCallTool({ url: URL_, token: 'tok-12345678', fetchImpl: s.fetchImpl }, 'list_tables')
    await mcpCallTool({ url: URL_, token: 'tok-12345678', fetchImpl: s.fetchImpl }, 'get_advisors')
    expect(s.seen.filter((x) => x.method === 'initialize')).toHaveLength(1)
  })

  it('starts a new session when the server forgot the old one', async () => {
    const s = server({ expireFirstCall: true })
    const r = await mcpCallTool({ url: URL_, token: 'tok-12345678', fetchImpl: s.fetchImpl }, 'list_tables')
    expect(r.error).toBeNull()
    expect(s.seen.filter((x) => x.method === 'initialize')).toHaveLength(2)
  })

  it('works with a stateless server that returns no session id', async () => {
    const s = server({ sessionId: null })
    const r = await mcpCallTool({ url: URL_, token: 'tok-12345678', fetchImpl: s.fetchImpl }, 'list_tables')
    expect(r.error).toBeNull()
    expect(s.seen[2]?.session).toBeNull()
  })

  it('reports an initialize failure in words instead of throwing', async () => {
    const s = server({ initStatus: 401 })
    const r = await mcpCallTool({ url: URL_, token: 'tok-12345678', fetchImpl: s.fetchImpl }, 'list_tables')
    expect(r.status).toBe(401)
    expect(r.error).toMatch(/initialize failed: HTTP 401/)
  })
})
