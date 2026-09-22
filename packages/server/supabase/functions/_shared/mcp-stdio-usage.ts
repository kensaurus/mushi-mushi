/**
 * FILE: mcp-stdio-usage.ts
 * PURPOSE: Make tool calls from the stdio MCP server (`npx @mushi-mushi/mcp`)
 *          visible: one mcp_tool_invocations row per tool call, plus the
 *          company-funnel events the hosted transport already emits.
 *
 * OVERVIEW:
 * - The stdio server runs on the developer's machine, so until 2026-09-22 its
 *   tool calls left no trace: Fix pulled and Habit read 0 for the install path
 *   the ICP actually uses.
 * - It now tags every request with `X-Mushi-Client: mcp-stdio/<version>` and,
 *   inside a tool call, `X-Mushi-Mcp-Tool` + `X-Mushi-Mcp-Invocation`.
 * - Only API-key requests count. Event names come from STDIO_TOOL_EVENTS, never
 *   from the client, so a forged header can at most mislabel the caller's own
 *   project's usage.
 * - A tool that makes several requests shares one invocation id; the partial
 *   unique index on mcp_tool_invocations(request_id) and the product_events
 *   dedup key keep it to one row each.
 */

import type { Context, Next } from 'npm:hono@4'

import { keepAlive } from './background.ts'
import { getServiceClient } from './db.ts'
import { recordMcpToolInvocation } from './mcp-tool-audit.ts'
import { emitProductEvent } from './product-events.ts'

export const STDIO_CLIENT_PREFIX = 'mcp-stdio/'

const TOOL_NAME = /^[a-z][a-z0-9_]{1,63}$/
const INVOCATION_ID = /^[A-Za-z0-9-]{8,64}$/

/**
 * Tools whose use is a funnel step (docs/plan-gtm.md: habit counts report
 * opens, fix context pulled and fixes dispatched). The hosted transport emits
 * the same names from mcp/index.ts.
 */
export const STDIO_TOOL_EVENTS = {
  get_report_detail: 'report_opened',
  get_fix_context: 'fix_context_pulled',
  suggest_fix: 'fix_context_pulled',
  dispatch_fix: 'fix_dispatched',
} as const

type StdioFunnelTool = keyof typeof STDIO_TOOL_EVENTS

export interface StdioMcpCall {
  tool: string
  invocationId: string
  clientVersion: string
}

/** The stdio attribution headers, or null when the request did not come from a stdio tool call. */
export function parseStdioMcpCall(headers: {
  client?: string | null
  tool?: string | null
  invocation?: string | null
}): StdioMcpCall | null {
  const client = headers.client?.trim() ?? ''
  if (!client.startsWith(STDIO_CLIENT_PREFIX)) return null
  const tool = headers.tool?.trim() ?? ''
  const invocationId = headers.invocation?.trim() ?? ''
  if (!TOOL_NAME.test(tool) || !INVOCATION_ID.test(invocationId)) return null
  return {
    tool,
    invocationId,
    clientVersion: client.slice(STDIO_CLIENT_PREFIX.length, STDIO_CLIENT_PREFIX.length + 32),
  }
}

/** `/api/v1/admin/reports/<id>` → `<id>`; any other path → null. */
export function reportIdFromPath(path: string): string | null {
  const match = /\/v1\/admin\/reports\/([^/]+)$/.exec(path)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function isFunnelTool(tool: string): tool is StdioFunnelTool {
  return Object.hasOwn(STDIO_TOOL_EVENTS, tool)
}

/**
 * Properties for the funnel event, read from the request the tool made. Null
 * when this request is not the one that carries the step (a tool may make
 * other requests under the same invocation id).
 */
async function funnelProperties(c: Context, tool: StdioFunnelTool): Promise<Record<string, string> | null> {
  if (tool === 'dispatch_fix') {
    if (c.req.method !== 'POST' || !c.req.path.endsWith('/v1/admin/fixes/dispatch')) return null
    // The route already parsed the body; Hono serves the cached copy.
    const body = (await c.req.json().catch(() => null)) as { reportId?: unknown; agent?: unknown } | null
    if (typeof body?.reportId !== 'string') return null
    return { report_id: body.reportId, agent: typeof body.agent === 'string' ? body.agent : 'default' }
  }
  if (c.req.method !== 'GET') return null
  const reportId = reportIdFromPath(c.req.path)
  return reportId ? { report_id: reportId } : null
}

async function noteStdioMcpCall(
  c: Context,
  call: StdioMcpCall,
  status: 'ok' | 'error',
  durationMs: number,
): Promise<void> {
  const projectId = (c.get('projectId') as string | null | undefined) ?? null
  await recordMcpToolInvocation({
    projectId,
    apiKeyId: (c.get('apiKeyId') as string | undefined) ?? null,
    toolName: call.tool,
    transport: 'stdio',
    status,
    durationMs,
    requestId: call.invocationId,
    errorCode: status === 'error' ? String(c.res.status) : null,
  })

  if (status !== 'ok' || !isFunnelTool(call.tool)) return
  const properties = await funnelProperties(c, call.tool)
  if (!properties) return
  await emitProductEvent(getServiceClient(), {
    userId: (c.get('userId') as string | undefined) ?? null,
    eventName: STDIO_TOOL_EVENTS[call.tool],
    surface: 'mcp',
    dedupKey: `mcp-stdio:${call.invocationId}`,
    properties: { ...properties, project_id: projectId, via: 'stdio' },
  })
}

/**
 * Hono middleware: after the route runs, record a stdio tool call made with an
 * API key. Never blocks or alters the response.
 */
export function stdioMcpUsage() {
  return async (c: Context, next: Next): Promise<void> => {
    const call = parseStdioMcpCall({
      client: c.req.header('x-mushi-client'),
      tool: c.req.header('x-mushi-mcp-tool'),
      invocation: c.req.header('x-mushi-mcp-invocation'),
    })
    if (!call) return next()
    const started = Date.now()
    await next()
    if (c.get('authMethod') !== 'apiKey') return
    const status = c.res.status < 400 ? 'ok' : 'error'
    void keepAlive(noteStdioMcpCall(c, call, status, Date.now() - started))
  }
}
