/**
 * FILE: fixes-list-console.test.ts
 * PURPOSE: GET /v1/admin/fixes, console QA group C.
 *   #89  The list never returned cursor_agent_id, cursor_artifacts,
 *        claude_workflow_run_url or check_run_updated_at, so the agent
 *        badges, links, artifacts gallery and "CI synced" never rendered.
 *   #91  The list stopped at 50 with no way to reach older attempts. It now
 *        takes an offset and returns the exact total.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const P = '1000000b-0000-4000-8000-000000000000'
const USER = '2000000b-0000-4000-8000-000000000000'

let db: FakeDb
let lastColumns = ''

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({
    ...db,
    from: (table: string) => {
      const q = db.from(table)
      if (table !== 'fix_attempts') return q
      const select = q.select.bind(q)
      ;(q as unknown as { select: typeof select }).select = (cols?: string, opts?: { count?: string; head?: boolean }) => {
        lastColumns = cols ?? ''
        return select(cols, opts)
      }
      return q
    },
  }),
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/entitlements.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next() }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/fix-report-truth-load.ts', () => ({
  loadReportFixTruths: async () => ({ truths: new Map(), reports: new Map() }),
  loadRecentFixTruths: async () => ({ truths: new Map() }),
  reportTitle: () => null,
}))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, callerProjectIds: async () => [P] }
})

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerQueryFixesRepoRoutes } = await import('../../supabase/functions/api/routes/query-fixes-repo.ts')
  app = new Hono()
  registerQueryFixesRepoRoutes(app as never)
})

function attempt(i: number, extra: Row = {}): Row {
  return {
    id: `f${i}`,
    project_id: P,
    report_id: `r${i}`,
    agent: 'cursor_cloud',
    status: 'completed',
    started_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
    ...extra,
  }
}

async function get(path: string) {
  const res = await app.request(path)
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('GET /v1/admin/fixes', () => {
  it('#89 returns the agent and CI-sync fields the rows render', async () => {
    db = makeFakeDb({
      fix_attempts: [
        attempt(1, {
          cursor_agent_id: 'bc-1',
          cursor_artifacts: [{ kind: 'screenshot', path: 'a.png', mime: 'image/png' }],
          claude_workflow_run_url: 'https://github.com/o/r/actions/runs/1',
          check_run_updated_at: '2026-10-02T00:00:00Z',
        }),
      ],
    })
    const res = await get('/v1/admin/fixes')
    for (const col of ['cursor_agent_id', 'cursor_artifacts', 'claude_workflow_run_url', 'check_run_updated_at']) {
      expect(lastColumns).toContain(col)
    }
    expect(res.json.data.fixes[0]).toMatchObject({
      cursor_agent_id: 'bc-1',
      claude_workflow_run_url: 'https://github.com/o/r/actions/runs/1',
      check_run_updated_at: '2026-10-02T00:00:00Z',
    })
  })

  it('#91 pages with an offset and returns the exact total', async () => {
    db = makeFakeDb({ fix_attempts: Array.from({ length: 75 }, (_, i) => attempt(i)) })
    const first = await get('/v1/admin/fixes?limit=50')
    const second = await get('/v1/admin/fixes?limit=50&offset=50')
    expect(first.json.data.total).toBe(75)
    expect(first.json.data.fixes).toHaveLength(50)
    expect(second.json.data.fixes).toHaveLength(25)
    const ids = new Set([...first.json.data.fixes, ...second.json.data.fixes].map((f: Row) => f.id))
    expect(ids.size).toBe(75)
  })
})
