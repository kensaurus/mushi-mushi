/**
 * Dashboard family counts (api/routes/dashboard.ts) against the real route
 * module, with PostgREST's 1,000-row cap modelled.
 *
 * Pinned (console repair group H, 2026-10-04):
 *   #285  counts were `.length` of row reads capped at 500 / 100 / 2000;
 *         they are exact counts now.
 *   #174  the triage backlog counted new|queued older than 1h inside 14 days
 *         while its link lists every report in the `new` bucket, any age.
 *   perf  /v1/admin/dashboard read the OLDEST 2000 health rows, so "latest
 *         status" was stale; all three routes now share the health rollup.
 *   truth a failed read answers with an error, never with a 0.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const P = '1000000b-0000-4000-8000-000000000000'
const USER = '2000000b-0000-4000-8000-000000000000'

let db: FakeDb

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
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass, getOrgIdFromContext: () => null }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    callerProjectIds: async () => [P],
    scopedOwnedProjectIds: async () => [P],
    resolveOwnedProject: async () => ({ project: { id: P, name: 'glot.it', owner_id: USER, organization_role: 'owner' } }),
  }
})

let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerDashboardRoutes } = await import('../../supabase/functions/api/routes/dashboard.ts')
  app = new Hono()
  registerDashboardRoutes(app as never)
})

const DAY = 24 * 60 * 60 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

function report(i: number, p: Partial<Row>): Row {
  return {
    id: `r-${i}`,
    project_id: P,
    status: 'classified',
    severity: 'medium',
    component: null,
    summary: `Report ${i}`,
    description: null,
    created_at: iso(DAY),
    judge_evaluated_at: '2026-10-01T00:00:00Z',
    ...p,
  }
}

function seed(reports: Row[], health: Row[] = [], extra: Record<string, Row[]> = {}) {
  db = makeFakeDb(
    {
      reports,
      fix_attempts: [],
      llm_invocations: [],
      classification_evaluations: [],
      project_api_keys: [{ id: 'k1', project_id: P, is_active: true, last_seen_at: iso(60_000) }],
      projects: [{ id: P, name: 'glot.it' }],
      ...extra,
    },
    {
      maxRows: 1000,
      rpc: (fn) => (fn === 'integration_health_rollup' ? health : null),
    },
  )
}

async function get(path: string): Promise<{ status: number; body: { ok: boolean; data: Record<string, any> } }> {
  const res = await app.request(path)
  return { status: res.status, body: await res.json() }
}

beforeEach(() => seed([]))

describe('dashboard/stats', () => {
  it('counts every report in 14 days exactly, past the old 500-row read', async () => {
    seed(Array.from({ length: 1200 }, (_, i) => report(i, { created_at: iso(DAY + i * 1000) })))
    const { body } = await get('/v1/admin/dashboard/stats')
    expect(body.data.reports14d).toBe(1200)
  })

  it('counts the triage backlog as the reports /reports?status=new lists, any age', async () => {
    seed([
      report(1, { status: 'new', created_at: iso(60_000) }), // 1 minute old: was hidden by the 1h grace
      report(2, { status: 'queued', created_at: iso(40 * DAY) }), // older than the window: was dropped
      report(3, { status: 'pending', created_at: iso(DAY) }), // legacy spelling: was not counted
      report(4, { status: 'classified', created_at: iso(DAY) }),
    ])
    const { body } = await get('/v1/admin/dashboard/stats')
    expect(body.data.openBacklog).toBe(3)
    expect(body.data.topPriority).toBe('backlog')
    expect(body.data.topPriorityTo).toContain('status=new')
  })

  it('counts integration issues from the shared rollup, a down probe included', async () => {
    seed([report(1, {})], [
      { project_id: P, kind: 'claude_code_agent', last_status: 'down', last_at: iso(60_000), ok_count: 0, total_count: 5 },
      { project_id: P, kind: 'github', last_status: 'ok', last_at: iso(60_000), ok_count: 5, total_count: 5 },
    ])
    const { body } = await get('/v1/admin/dashboard/stats')
    expect(body.data.integrationIssues).toBe(1)
  })

  it('answers a failed read with an error, not with a zero', async () => {
    seed([report(1, {})])
    ;(db as unknown as { rpc: unknown }).rpc = async () => ({ data: null, error: { code: 'XX000', message: 'boom' } })
    const { status, body } = await get('/v1/admin/dashboard/stats')
    expect(status).toBeGreaterThanOrEqual(500)
    expect(body.ok).toBe(false)
  })
})

describe('inbox/stats', () => {
  it('raises the Act flag for a down probe and keeps critical intake apart from critical triage', async () => {
    seed(
      [
        report(1, { severity: 'critical', status: 'fixed', created_at: iso(DAY) }),
        report(2, { severity: 'critical', status: 'new', created_at: iso(30 * DAY) }),
      ],
      [{ project_id: P, kind: 'github', last_status: 'down', last_at: iso(60_000), ok_count: 0, total_count: 3 }],
    )
    const { body } = await get('/v1/admin/inbox/stats')
    expect(body.data.integrationRed).toBe(1)
    expect(body.data.openAct).toBe(true)
    // Intake tile: critical reports received in 14 days, any status.
    expect(body.data.criticalReports14d).toBe(1)
    // Plan flag: critical reports still waiting for triage, any age — what its link lists.
    expect(body.data.criticalUntriaged).toBe(1)
    expect(body.data.openPlan).toBe(true)
  })
})

describe('/v1/admin/dashboard', () => {
  it('reads exact counts, the shared backlog, and the latest health per kind', async () => {
    seed(
      [
        ...Array.from({ length: 1100 }, (_, i) => report(i, { created_at: iso(DAY + i * 1000) })),
        report(5000, { status: 'new', created_at: iso(20 * DAY) }),
      ],
      [{ project_id: P, kind: 'github', last_status: 'down', last_at: iso(60_000), ok_count: 90, total_count: 100 }],
    )
    const { body } = await get('/v1/admin/dashboard')
    expect(body.data.counts.reports14d).toBe(1100)
    expect(body.data.counts.openBacklog).toBe(1)
    const plan = body.data.pdcaStages.find((s: { id: string }) => s.id === 'plan')
    expect(plan.count).toBe(1)
    expect(plan.cta.to).toBe('/reports?status=new')
    expect(plan.countLabel).toBe('report waiting to triage')
    expect(body.data.integrations).toEqual([
      expect.objectContaining({ kind: 'github', lastStatus: 'down', severity: 'red', uptime: 0.9 }),
    ])
    const act = body.data.pdcaStages.find((s: { id: string }) => s.id === 'act')
    expect(act.tone).toBe('urgent')
  })

  it('counts the Check stage with the judge-eligible definition the inbox uses', async () => {
    seed([
      report(1, { status: 'classified', judge_evaluated_at: null, created_at: iso(30 * DAY) }),
      report(2, { status: 'fixing', judge_evaluated_at: null }),
      report(3, { status: 'classified' }),
      report(4, { status: 'new', judge_evaluated_at: null }),
    ])
    const { body } = await get('/v1/admin/dashboard')
    const check = body.data.pdcaStages.find((s: { id: string }) => s.id === 'check')
    expect(check.count).toBe(2)
  })
})
