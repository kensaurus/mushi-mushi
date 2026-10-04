/**
 * FILE: _shared/mcp-http-session.ts
 * PURPOSE: Call a tool on a remote MCP server over Streamable HTTP, with the
 *          session lifecycle the spec requires.
 *
 * The hosted Supabase MCP (`https://mcp.supabase.com/mcp`) began refusing a
 * bare `tools/call` with HTTP 400 "Mcp-Session-Id header is required for
 * non-initialization requests" (Sentry MUSHI-MUSHI-SERVER-29, 2026-10-04:
 * backend-drift-scanner). A client must first send `initialize`, keep the
 * `Mcp-Session-Id` the server returns, send `notifications/initialized`, and
 * then send that id (plus `MCP-Protocol-Version`) on every request. The
 * server may answer as JSON or as an SSE stream; both are read here.
 *
 * Sessions are cached per (endpoint, token) for a few minutes. A 404 means
 * the server dropped the session: start a new one and retry once.
 */

const PROTOCOL_VERSION = '2025-06-18'
const SESSION_TTL_MS = 5 * 60_000

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface Session {
  id: string | null
  protocolVersion: string
  expiresAt: number
}

const sessions = new Map<string, Session>()

/** For tests. */
export function resetMcpSessions(): void {
  sessions.clear()
}

export interface McpToolResult {
  content?: Array<{ type?: string; text?: string }>
  isError?: boolean
}

export interface McpToolResponse {
  /** HTTP status of the tools/call request (0 when it never got one). */
  status: number
  result: McpToolResult | null
  /** JSON-RPC or transport error in words, or null. */
  error: string | null
}

interface JsonRpcMessage {
  id?: number | string | null
  result?: unknown
  error?: { message?: string } | null
}

/** Read a JSON-RPC message from a JSON or SSE response body. */
async function readMessage(res: Response, id: number): Promise<JsonRpcMessage | null> {
  const type = res.headers.get('content-type') ?? ''
  const text = await res.text().catch(() => '')
  if (!text) return null
  if (type.includes('text/event-stream')) {
    let found: JsonRpcMessage | null = null
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      try {
        const msg = JSON.parse(line.slice(5).trim()) as JsonRpcMessage
        if (msg && (msg.id === id || found === null)) found = msg
        if (msg?.id === id) break
      } catch {
        // Not JSON (keep-alive or comment); skip.
      }
    }
    return found
  }
  try {
    return JSON.parse(text) as JsonRpcMessage
  } catch {
    return null
  }
}

function baseHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  }
}

async function openSession(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  timeoutMs: number,
): Promise<Session | { error: string; status: number }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'mushi-mushi', version: '1' },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    return { status: res.status, error: `initialize failed: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}` }
  }
  const id = res.headers.get('mcp-session-id')
  const msg = await readMessage(res, 0)
  if (msg?.error) return { status: res.status, error: `initialize failed: ${msg.error.message ?? 'error'}` }
  const negotiated = (msg?.result as { protocolVersion?: string } | undefined)?.protocolVersion ?? PROTOCOL_VERSION

  const headers: Record<string, string> = { ...baseHeaders(token), 'MCP-Protocol-Version': negotiated }
  if (id) headers['Mcp-Session-Id'] = id
  // The server answers 202 with no body; a failure here surfaces on the call.
  await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    signal: AbortSignal.timeout(timeoutMs),
  }).then((r) => r.text()).catch(() => undefined)

  return { id, protocolVersion: negotiated, expiresAt: Date.now() + SESSION_TTL_MS }
}

/**
 * `tools/call` on a Streamable HTTP MCP server, opening (and caching) a
 * session first. Never throws for an HTTP or JSON-RPC failure: the caller
 * gets `{ status, result: null, error }`. Network errors and timeouts do throw.
 */
export async function mcpCallTool(
  opts: { url: string; token: string; fetchImpl?: FetchLike; timeoutMs?: number },
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResponse> {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  const timeoutMs = opts.timeoutMs ?? 15_000
  const key = `${opts.url.split('?')[0]}|${opts.url.split('?')[1] ?? ''}|${opts.token.slice(-8)}`

  for (let attempt = 0; attempt < 2; attempt++) {
    let session = sessions.get(key)
    if (!session || session.expiresAt < Date.now()) {
      const opened = await openSession(fetchImpl, opts.url, opts.token, timeoutMs)
      if ('error' in opened) return { status: opened.status, result: null, error: opened.error }
      session = opened
      sessions.set(key, session)
    }

    const headers: Record<string, string> = { ...baseHeaders(opts.token), 'MCP-Protocol-Version': session.protocolVersion }
    if (session.id) headers['Mcp-Session-Id'] = session.id
    const res = await fetchImpl(opts.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    // 404 = the server forgot the session; 400 can also mean it wants one.
    if ((res.status === 404 || res.status === 400) && attempt === 0) {
      await res.text().catch(() => undefined)
      sessions.delete(key)
      continue
    }
    if (!res.ok) {
      return { status: res.status, result: null, error: `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}` }
    }
    const msg = await readMessage(res, 1)
    if (!msg) return { status: res.status, result: null, error: 'empty response' }
    if (msg.error) return { status: res.status, result: null, error: msg.error.message ?? JSON.stringify(msg.error) }
    return { status: res.status, result: (msg.result ?? null) as McpToolResult | null, error: null }
  }
  return { status: 0, result: null, error: 'session could not be established' }
}
