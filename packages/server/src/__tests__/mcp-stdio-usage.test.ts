/**
 * FILE: packages/server/src/__tests__/mcp-stdio-usage.test.ts
 * PURPOSE: The api records stdio MCP tool calls and credits the funnel steps
 *          they represent (_shared/mcp-stdio-usage.ts).
 *
 * Until 2026-09-22 recordMcpToolInvocation dropped every non-hosted call and
 * nothing emitted product events for stdio, so the ICP's main install path
 * read 0 in Fix pulled and Habit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordMcpToolInvocation = vi.fn(async () => {})
const emitProductEvent = vi.fn(async () => true)
const pending: Promise<unknown>[] = []

vi.mock('../../supabase/functions/_shared/mcp-tool-audit.ts', () => ({ recordMcpToolInvocation }))
vi.mock('../../supabase/functions/_shared/product-events.ts', () => ({ emitProductEvent }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/background.ts', () => ({
  keepAlive: (p: Promise<unknown>) => {
    pending.push(p)
    return p
  },
}))

const { parseStdioMcpCall, reportIdFromPath, stdioMcpUsage, STDIO_TOOL_EVENTS } = await import(
  '../../supabase/functions/_shared/mcp-stdio-usage.ts'
)

const INVOCATION = '8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const REPORT_ID = '22222222-2222-4222-8222-222222222222'

interface FakeRequest {
  method?: string
  path: string
  headers?: Record<string, string>
  body?: unknown
  vars?: Record<string, unknown>
  status?: number
}

/** The slice of Hono's Context the middleware reads. */
function fakeContext(req: FakeRequest) {
  const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    req: {
      method: req.method ?? 'GET',
      path: req.path,
      header: (name: string) => headers[name.toLowerCase()],
      json: async () => req.body,
    },
    get: (key: string) => req.vars?.[key],
    res: { status: req.status ?? 200 },
  }
}

const stdioHeaders = (tool: string) => ({
  'X-Mushi-Client': 'mcp-stdio/0.22.0',
  'X-Mushi-Mcp-Tool': tool,
  'X-Mushi-Mcp-Invocation': INVOCATION,
})

const apiKeyVars = { authMethod: 'apiKey', projectId: 'proj-1', apiKeyId: 'key-1', userId: 'owner-1' }

async function run(req: FakeRequest): Promise<{ nextCalled: boolean }> {
  let nextCalled = false
  type MiddlewareContext = Parameters<ReturnType<typeof stdioMcpUsage>>[0]
  await stdioMcpUsage()(fakeContext(req) as unknown as MiddlewareContext, async () => {
    nextCalled = true
  })
  await Promise.all(pending.splice(0))
  return { nextCalled }
}

beforeEach(() => {
  recordMcpToolInvocation.mockClear()
  emitProductEvent.mockClear()
})

describe('parseStdioMcpCall', () => {
  it('accepts the stdio client with a tool and an invocation id', () => {
    expect(parseStdioMcpCall({ client: 'mcp-stdio/0.22.0', tool: 'get_fix_context', invocation: INVOCATION })).toEqual({
      tool: 'get_fix_context',
      invocationId: INVOCATION,
      clientVersion: '0.22.0',
    })
  })

  it('ignores other clients, missing parts and malformed values', () => {
    expect(parseStdioMcpCall({ client: 'mushi-web/1.28.0', tool: 'get_fix_context', invocation: INVOCATION })).toBeNull()
    expect(parseStdioMcpCall({ client: 'mcp-stdio/0.22.0', tool: null, invocation: INVOCATION })).toBeNull()
    expect(parseStdioMcpCall({ client: 'mcp-stdio/0.22.0', tool: 'Get Fix', invocation: INVOCATION })).toBeNull()
    expect(parseStdioMcpCall({ client: 'mcp-stdio/0.22.0', tool: 'get_fix_context', invocation: 'x' })).toBeNull()
  })
})

describe('reportIdFromPath', () => {
  it('reads the report id from the detail route only', () => {
    expect(reportIdFromPath(`/api/v1/admin/reports/${REPORT_ID}`)).toBe(REPORT_ID)
    expect(reportIdFromPath(`/api/v1/admin/reports/${REPORT_ID}/timeline`)).toBeNull()
    expect(reportIdFromPath('/api/v1/admin/reports/%E0%A4%A')).toBeNull()
  })
})

describe('stdioMcpUsage middleware', () => {
  it('records the call and emits fix_context_pulled for get_fix_context on the report route', async () => {
    const { nextCalled } = await run({
      path: `/api/v1/admin/reports/${REPORT_ID}`,
      headers: stdioHeaders('get_fix_context'),
      vars: apiKeyVars,
    })
    expect(nextCalled).toBe(true)
    expect(recordMcpToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'stdio',
        toolName: 'get_fix_context',
        status: 'ok',
        projectId: 'proj-1',
        apiKeyId: 'key-1',
        requestId: INVOCATION,
      }),
    )
    expect(emitProductEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        eventName: 'fix_context_pulled',
        surface: 'mcp',
        userId: 'owner-1',
        dedupKey: `mcp-stdio:${INVOCATION}`,
        properties: { report_id: REPORT_ID, project_id: 'proj-1', via: 'stdio' },
      }),
    )
  })

  it('emits report_opened for get_report_detail', async () => {
    await run({ path: `/api/v1/admin/reports/${REPORT_ID}`, headers: stdioHeaders('get_report_detail'), vars: apiKeyVars })
    expect(emitProductEvent).toHaveBeenCalledWith({}, expect.objectContaining({ eventName: 'report_opened' }))
  })

  it('emits fix_dispatched with the report and agent from the dispatch body', async () => {
    await run({
      method: 'POST',
      path: '/api/v1/admin/fixes/dispatch',
      headers: stdioHeaders('dispatch_fix'),
      body: { reportId: REPORT_ID, agent: 'claude_code' },
      vars: apiKeyVars,
    })
    expect(emitProductEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        eventName: 'fix_dispatched',
        properties: { report_id: REPORT_ID, agent: 'claude_code', project_id: 'proj-1', via: 'stdio' },
      }),
    )
  })

  it('records but does not emit for a tool that is not a funnel step', async () => {
    await run({ path: '/api/v1/admin/inventory/proj-1', headers: stdioHeaders('get_inventory'), vars: apiKeyVars })
    expect(recordMcpToolInvocation).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'get_inventory' }))
    expect(emitProductEvent).not.toHaveBeenCalled()
  })

  it('does not emit from a funnel tool request that is not the step itself', async () => {
    await run({
      path: `/api/v1/admin/reports/${REPORT_ID}/timeline`,
      headers: stdioHeaders('get_fix_context'),
      vars: apiKeyVars,
    })
    expect(recordMcpToolInvocation).toHaveBeenCalled()
    expect(emitProductEvent).not.toHaveBeenCalled()
  })

  it('records a failed call as an error and emits nothing', async () => {
    await run({
      path: `/api/v1/admin/reports/${REPORT_ID}`,
      headers: stdioHeaders('get_fix_context'),
      vars: apiKeyVars,
      status: 403,
    })
    expect(recordMcpToolInvocation).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', errorCode: '403' }))
    expect(emitProductEvent).not.toHaveBeenCalled()
  })

  it('ignores JWT (console) requests, unauthenticated requests and non-stdio clients', async () => {
    await run({ path: `/api/v1/admin/reports/${REPORT_ID}`, headers: stdioHeaders('get_fix_context'), vars: { authMethod: 'jwt' } })
    await run({ path: `/api/v1/admin/reports/${REPORT_ID}`, headers: stdioHeaders('get_fix_context'), vars: {} })
    const { nextCalled } = await run({ path: `/api/v1/admin/reports/${REPORT_ID}`, vars: apiKeyVars })
    expect(nextCalled).toBe(true)
    expect(recordMcpToolInvocation).not.toHaveBeenCalled()
    expect(emitProductEvent).not.toHaveBeenCalled()
  })

  it('maps only to events the taxonomy defines', async () => {
    const { MUSHI_EVENTS } = await import('../../../core/src/analytics-taxonomy')
    for (const event of Object.values(STDIO_TOOL_EVENTS)) {
      const spec = MUSHI_EVENTS[event as keyof typeof MUSHI_EVENTS] as { surface: string | readonly string[] }
      expect([spec.surface].flat()).toContain('mcp')
    }
  })
})
