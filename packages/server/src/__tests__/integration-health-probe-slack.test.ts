/**
 * FILE: integration-health-probe-slack.test.ts
 * PURPOSE: The health cron reads the saved Slack channel, stores the probe's
 *          channel error, and still writes the rest of the batch when the
 *          detail column is not migrated yet.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const OPERATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SLACK_PROJECT = '11111111-1111-4111-8111-111111111111'
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222'

const env: Record<string, string | undefined> = {
  MUSHI_OPERATOR_USER_IDS: OPERATOR,
  SLACK_BOT_TOKEN: 'xoxb-operator',
}

let current: ReturnType<typeof clientFor>

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => current }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (_name: string, handler: unknown) => handler,
  reportError: vi.fn(),
  reportMessage: vi.fn(),
}))

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null }
type InsertMode = 'ok' | 'missing-detail' | 'other-error'

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

/**
 * Honor `.select('a, b')` the way PostgREST does, so a cron that stops
 * selecting slack_channel_id cannot see that column. Optionally refuse an
 * insert that still carries `detail`.
 */
function clientFor(inner: FakeDb, mode: InsertMode) {
  let rejectedDetail = false
  return {
    from(table: string) {
      const q = inner.from(table)
      let cols: string | undefined
      const origSelect = q.select.bind(q)
      const origInsert = q.insert.bind(q)
      const origThen = q.then.bind(q)
      const query = q as typeof q & {
        select: (c?: string, opts?: { count?: string; head?: boolean }) => typeof q
        insert: (payload: Row | Row[]) => { then: QueryResult['data'] extends never ? never : typeof origThen }
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
      if (table === 'integration_health_history' && mode !== 'ok') {
        query.insert = ((payload: Row | Row[]) => {
          const rows = Array.isArray(payload) ? payload : [payload]
          const hasDetail = rows.some((row) => row != null && 'detail' in row)
          const refuse = (error: { code: string; message: string }) => ({
            then: (onFulfilled?: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
              Promise.resolve({ data: null, error }).then(onFulfilled, onRejected),
          })
          if (mode === 'missing-detail' && hasDetail && !rejectedDetail) {
            rejectedDetail = true
            return refuse({
              code: 'PGRST204',
              message: "Could not find the 'detail' column of 'integration_health_history' in the schema cache",
            })
          }
          if (mode === 'other-error' && hasDetail) {
            return refuse({ code: '23505', message: 'duplicate key value violates unique constraint' })
          }
          return origInsert(payload)
        }) as typeof query.insert
      }
      return query
    },
    rpc: inner.rpc.bind(inner),
  }
}

function seed(): FakeDb {
  const now = new Date().toISOString()
  return makeFakeDb(
    {
      project_settings: [
        { project_id: SLACK_PROJECT, slack_channel_id: 'C0DEAD', slack_bot_token_ref: null },
        { project_id: OTHER_PROJECT },
      ],
      projects: [
        { id: SLACK_PROJECT, organization_id: null, owner_id: OPERATOR },
        { id: OTHER_PROJECT, organization_id: null, owner_id: OPERATOR },
      ],
      organization_integration_settings: [],
      project_integrations: [],
      reward_webhooks: [{
        id: 'wh-1',
        project_id: OTHER_PROJECT,
        organization_id: '33333333-3333-4333-8333-333333333333',
        url: null,
        secret_hash: null,
        enabled: true,
      }],
      byok_keys: [],
      gate_runs: [
        { project_id: SLACK_PROJECT, gate: 'radar', started_at: now },
        { project_id: OTHER_PROJECT, gate: 'radar', started_at: now },
      ],
      integration_health_history: [],
      cron_runs: [],
    },
    { autoId: true },
  )
}

let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] }, serve: () => {} })
  ;({ handler } = await import('../../supabase/functions/integration-health-probe/index.ts'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] }, serve: () => {} })
})

function slackFetch() {
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
}

async function run(mode: InsertMode): Promise<{ status: number; inner: FakeDb }> {
  const inner = seed()
  current = clientFor(inner, mode)
  slackFetch()
  const res = await handler(new Request('https://example.test/integration-health-probe', { method: 'POST' }))
  return { status: res.status, inner }
}

describe('integration-health-probe Slack channel rows', () => {
  it('reads the saved channel and stores the Slack error on that row only', async () => {
    const { status, inner } = await run('ok')
    expect(status).toBe(200)
    const rows = inner.table('integration_health_history')
    const slack = rows.find((row) => row.kind === 'slack')
    const other = rows.find((row) => row.project_id === OTHER_PROJECT)
    expect(slack).toMatchObject({
      project_id: SLACK_PROJECT,
      status: 'down',
      detail: { slack_error: 'channel_not_found', channel_id: 'C0DEAD' },
    })
    expect(other).toBeTruthy()
    expect(other).not.toHaveProperty('detail')
  })

  it('keeps every project in the batch when detail is not migrated yet', async () => {
    const { status, inner } = await run('missing-detail')
    expect(status).toBe(200)
    const rows = inner.table('integration_health_history')
    expect(rows.map((row) => row.project_id).sort()).toEqual([OTHER_PROJECT, SLACK_PROJECT].sort())
    expect(rows.every((row) => !('detail' in row))).toBe(true)
    expect(rows.find((row) => row.kind === 'slack')?.status).toBe('down')
  })

  it('fails the run instead of dropping detail when the insert error is something else', async () => {
    const { status, inner } = await run('other-error')
    expect(status).toBe(500)
    expect(inner.table('integration_health_history')).toHaveLength(0)
  })
})
