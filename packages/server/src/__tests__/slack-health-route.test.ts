/**
 * FILE: slack-health-route.test.ts
 * PURPOSE: POST /v1/admin/health/integration/slack passes the saved channel
 *          into the probe and stores the Slack error on the health row.
 *          A source-text check of the route would pass if that wiring broke.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const P = '11111111-1111-4111-8111-111111111111'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let db: ReturnType<typeof projecting>

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn(), withSentry: (_n: string, h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock('../../supabase/functions/api/helpers.ts', () => ({
  canManageProjectSdkConfig: vi.fn(),
  coerceSdkConfigUpdate: vi.fn(),
  ingestReport: vi.fn(),
  invokeFixWorker: vi.fn(),
  normalizeSdkConfig: vi.fn(),
  triggerClassification: vi.fn(),
}))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    callerProjectIds: async () => [P],
    scopedOwnedProjectIds: async () => [P],
  }
})

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null }

function projectColumns(data: unknown, cols: string | undefined): unknown {
  if (!cols || cols.trim() === '*' || data == null) return data
  const keys = cols.split(',').map((part) => part.trim()).filter(Boolean)
  const project = (row: Row): Row => {
    const out: Row = {}
    for (const key of keys) if (key in row) out[key] = row[key]
    return out
  }
  if (Array.isArray(data)) return data.map((row) => project(row as Row))
  if (typeof data === 'object') return project(data as Row)
  return data
}

/** PostgREST drops columns the select list does not name. */
function projecting(inner: FakeDb) {
  return {
    from(table: string) {
      const q = inner.from(table)
      let cols: string | undefined
      const origSelect = q.select.bind(q)
      const origThen = q.then.bind(q)
      const query = q as typeof q & {
        select: (c?: string, opts?: { count?: string; head?: boolean }) => typeof q
        then: typeof origThen
      }
      query.select = (c?: string, opts?: { count?: string; head?: boolean }) => {
        if (typeof c === 'string') cols = c
        return origSelect(c, opts)
      }
      query.then = ((onFulfilled?: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
        origThen((result: QueryResult) => {
          const next = { ...result, data: projectColumns(result.data, cols) }
          return onFulfilled ? onFulfilled(next) : next
        }, onRejected)) as typeof origThen
      return query
    },
    rpc: inner.rpc.bind(inner),
  }
}

let app: Hono

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined } })
  const { registerModernizationHealthSuperRoutes } = await import('../../supabase/functions/api/routes/modernization-health-super.ts')
  app = new Hono()
  registerModernizationHealthSuperRoutes(app as never)
})

describe('POST /v1/admin/health/integration/slack', () => {
  it('probes the saved channel and stores the Slack error on the health row', async () => {
    const inner = makeFakeDb(
      {
        project_settings: [{ project_id: P, slack_bot_token_ref: 'sec-1', slack_channel_id: 'C0DEAD' }],
        project_integrations: [],
        integration_health_history: [],
      },
      { rpc: (fn, args) => (fn === 'vault_get_secret' && args.secret_id === 'sec-1' ? 'xoxb-test' : null) },
    )
    db = projecting(inner)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const target = String(url)
      if (target.includes('auth.test')) {
        return new Response(JSON.stringify({ ok: true, team: 'acme', bot_id: 'B1' }), { status: 200 })
      }
      if (target.includes('conversations.info')) {
        return new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${target}`)
    }))

    const res = await app.request('/v1/admin/health/integration/slack', {
      method: 'POST',
      headers: { 'X-Mushi-Project-Id': P },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { status: string } }
    expect(body.data.status).toBe('down')
    expect(inner.table('integration_health_history')).toEqual([
      expect.objectContaining({
        project_id: P,
        kind: 'slack',
        status: 'down',
        source: 'manual',
        detail: { slack_error: 'channel_not_found', channel_id: 'C0DEAD' },
      }),
    ])
  })
})
