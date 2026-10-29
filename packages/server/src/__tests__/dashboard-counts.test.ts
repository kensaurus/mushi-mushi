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
    // NOT NULL in prod; the judge-eligible count also needs classifier output.
    reporter_token_hash: `rk1_${i}`,
    stage1_classification: { category: 'bug' },
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
      // The app's SDK key (report:write only) checked in a minute ago.
      project_api_keys: [{ id: 'k1', project_id: P, is_active: true, scopes: ['report:write'], last_seen_at: iso(60_000) }],
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
    // Critical 14d tile: open critical reports from the window. The fixed one
    // is done and the new one is older than 14 days, so neither counts.
    expect(body.data.criticalReports14d).toBe(0)
    // Plan flag: critical reports still waiting for triage, any age — what its link lists.
    expect(body.data.criticalUntriaged).toBe(1)
    expect(body.data.openPlan).toBe(true)
  })

  it('keeps Plan open for classified critical/high reports nobody has fixed (no false "All clear")', async () => {
    // glot.it 2026-10-16: Sentry imports the classifier had tagged sat at
    // `classified`, so the triage-only flag said all clear over them.
    seed([
      report(1, { severity: 'high', status: 'classified' }),
      report(2, { severity: 'critical', status: 'classified' }),
      report(3, { severity: 'low', status: 'classified' }),
    ])
    const { body } = await get('/v1/admin/inbox/stats')
    expect(body.data.criticalUntriaged).toBe(0)
    expect(body.data.urgentOpenReports).toBe(2)
    expect(body.data.openPlan).toBe(true)
    expect(body.data.openActions).toBeGreaterThanOrEqual(1)
    expect(body.data.topPriorityLabel).toBe(
      'Read each diagnosis, then dispatch a fix or close it as not a code bug.',
    )
  })

  it('does not tell you to close failing connections as not a code bug', async () => {
    // Four stages can be open at once. Act and Ops are the same red
    // integration counted as two items; the banner used to apply the Plan
    // hint to all of them.
    seed(
      [
        report(1, { severity: 'high', status: 'classified' }),
        report(2, { severity: 'critical', status: 'classified' }),
      ],
      [{ project_id: P, kind: 'github', last_status: 'down', last_at: iso(60_000), ok_count: 0, total_count: 3 }],
    )
    const { body } = await get('/v1/admin/inbox/stats')
    expect(body.data.openPlan).toBe(true)
    expect(body.data.openAct).toBe(true)
    expect(body.data.openOps).toBe(true)
    expect(body.data.openActions).toBe(3)
    expect(body.data.topPriorityLabel).toBe(
      'Read each diagnosis, then dispatch a fix or close it as not a code bug. 2 of these 3 are failing connections — reconnect them instead.',
    )
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

  it('draws the 14-day charts from the SQL rollup, past the 1,000-row cap', async () => {
    const today = new Date().toISOString().slice(0, 10)
    db = makeFakeDb(
      { reports: [], fix_attempts: [], llm_invocations: [], classification_evaluations: [], projects: [{ id: P, name: 'glot.it' }] },
      {
        maxRows: 1000,
        rpc: (fn) =>
          fn === 'dashboard_chart_rollup'
            ? {
                report_days: [{ day: today, total: 3, critical: 1, high: 0, medium: 2, low: 0, unscored: 0 }],
                llm_days: [{ day: today, calls: 1716, tokens: 9000, latency_ms: 120, failures: 4 }],
                components: [{ component: 'checkout', count: 3 }],
              }
            : fn === 'integration_health_rollup'
              ? []
              : null,
      },
    )
    const { body } = await get('/v1/admin/dashboard')
    const day = (rows: Array<{ day: string }>) => rows.find((r) => r.day === today)
    expect(day(body.data.reportsByDay)).toMatchObject({ total: 3, critical: 1, medium: 2 })
    expect(day(body.data.llmByDay)).toMatchObject({ calls: 1716, tokens: 9000, latencyMs: 120, failures: 4 })
    expect(body.data.counts.llmTokens14d).toBe(9000)
    expect(body.data.topComponents).toEqual([{ component: 'checkout', count: 3, draftedFixes: 0, mergedFixes: 0 }])
    expect(body.data.chartsSampled).toBe(false)
    const plan = body.data.pdcaStages.find((s: { id: string }) => s.id === 'plan')
    expect(plan.series[6]).toBe(3)
  })

  it('counts drafted fixes for the top area, not the inbox report total', async () => {
    const reports = [
      ...Array.from({ length: 95 }, (_, i) => report(i, { component: 'Checkout' })),
      report(200, { component: 'Checkout' }),
      report(201, { component: 'Checkout', status: 'fixed' }),
      report(202, { component: 'Billing' }),
    ]
    const failed = Array.from({ length: 95 }, (_, i) => ({
      id: `fa-${i}`,
      project_id: P,
      report_id: `r-${i}`,
      status: 'failed',
      created_at: iso(DAY),
    }))
    seed(reports, [], {
      fix_attempts: [
        ...failed,
        {
          id: 'fa-draft',
          project_id: P,
          report_id: 'r-200',
          status: 'completed',
          pr_url: 'https://github.com/acme/app/pull/7',
          pr_number: 7,
          pr_state: 'draft',
          merged_at: null,
          created_at: iso(DAY),
        },
        {
          id: 'fa-merged',
          project_id: P,
          report_id: 'r-201',
          status: 'completed',
          pr_url: 'https://github.com/acme/app/pull/8',
          pr_number: 8,
          pr_state: 'merged',
          merged_at: iso(60_000),
          created_at: iso(DAY),
        },
        {
          id: 'fa-other',
          project_id: P,
          report_id: 'r-202',
          status: 'completed',
          pr_url: 'https://github.com/acme/app/pull/9',
          pr_number: 9,
          pr_state: 'open',
          merged_at: null,
          created_at: iso(DAY),
        },
      ],
    })
    const realRpc = db.rpc.bind(db)
    ;(db as unknown as { rpc: unknown }).rpc = async (fn: string, args: Record<string, unknown>) =>
      fn === 'dashboard_chart_rollup'
        ? { data: { report_days: [], llm_days: [], components: [{ component: 'Checkout', count: 95 }] }, error: null }
        : realRpc(fn, args)
    const { body } = await get('/v1/admin/dashboard')
    expect(body.ok).toBe(true)
    expect(body.data.topComponents).toEqual([
      { component: 'Checkout', count: 95, draftedFixes: 1, mergedFixes: 1 },
    ])
  })

  it('says the charts are a sample when the rollup is missing and the row read hits the cap', async () => {
    seed([], [], {
      llm_invocations: Array.from({ length: 1200 }, (_, i) => ({
        id: `l-${i}`,
        project_id: P,
        status: 'success',
        latency_ms: 10,
        input_tokens: 1,
        output_tokens: 1,
        created_at: iso(i * 1000),
      })),
    })
    const realRpc = db.rpc.bind(db)
    ;(db as unknown as { rpc: unknown }).rpc = async (fn: string, args: Record<string, unknown>) =>
      fn === 'dashboard_chart_rollup'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
        : realRpc(fn, args)
    const { body } = await get('/v1/admin/dashboard')
    expect(body.ok).toBe(true)
    expect(body.data.chartsSampled).toBe(true)
  })

  it('answers a failed chart rollup with an error, not with an empty chart', async () => {
    const realRpc = db.rpc.bind(db)
    ;(db as unknown as { rpc: unknown }).rpc = async (fn: string, args: Record<string, unknown>) =>
      fn === 'dashboard_chart_rollup'
        ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
        : realRpc(fn, args)
    const { status, body } = await get('/v1/admin/dashboard')
    expect(status).toBeGreaterThanOrEqual(500)
    expect(body.ok).toBe(false)
  })

  it('counts the Check stage with the judge-eligible definition the inbox uses', async () => {
    seed([
      report(1, { status: 'classified', judge_evaluated_at: null, created_at: iso(30 * DAY) }),
      report(2, { status: 'fixing', judge_evaluated_at: null }),
      report(3, { status: 'classified' }),
      report(4, { status: 'new', judge_evaluated_at: null }),
      // A cron-filed notice the classifier never labelled: nothing to grade.
      report(5, { status: 'classified', judge_evaluated_at: null, reporter_token_hash: 'cron:library-modernizer', stage1_classification: null }),
    ])
    const { body } = await get('/v1/admin/dashboard')
    const check = body.data.pdcaStages.find((s: { id: string }) => s.id === 'check')
    expect(check.count).toBe(2)
  })
})
