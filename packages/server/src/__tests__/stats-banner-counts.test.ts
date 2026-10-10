/**
 * Banner stats that fed the sidebar from capped row reads (console repair
 * group H, 2026-10-04), against the real route modules with PostgREST's
 * 1,000-row cap modelled:
 *
 *   costs/stats     `.limit(10000)` returned at most 1,000 rows, so spend and
 *                   call counts stopped at the 1,000th call; older all-time
 *                   spend was a second capped read.
 *   releases/stats  read every release row and every credit row unbounded.
 *   judge/stats     read up to 200 prompt rows to count them.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const P = '1000000c-0000-4000-8000-000000000000'
const USER = '2000000c-0000-4000-8000-000000000000'

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
vi.mock('../../supabase/functions/api/middleware/auth.ts', () => ({
  requireAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    await next()
  },
}))
vi.mock('../../supabase/functions/api/middleware/project.ts', () => ({
  requireProjectAccess: async (_c: unknown, next: () => Promise<void>) => next(),
}))
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
  const [{ registerCostsRoutes }, { registerReleasesRoutes }, { registerJudgeRoutes }] = await Promise.all([
    import('../../supabase/functions/api/routes/costs.ts'),
    import('../../supabase/functions/api/routes/releases.ts'),
    import('../../supabase/functions/api/routes/judge.ts'),
  ])
  app = new Hono()
  registerCostsRoutes(app as never)
  registerReleasesRoutes(app as never)
  registerJudgeRoutes(app as never)
})

const HOUR = 60 * 60 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

function invocation(i: number, p: Partial<Row> = {}): Row {
  return {
    id: `inv-${i}`,
    project_id: P,
    function_name: 'classify-report',
    stage: null,
    used_model: 'claude-sonnet-4-5',
    input_tokens: 100,
    output_tokens: 10,
    cost_usd: 0.01,
    created_at: iso(2 * HOUR + i * 1000),
    status: 'success',
    key_source: 'byok',
    ...p,
  }
}

async function get(path: string) {
  const res = await app.request(path)
  return { status: res.status, body: (await res.json()) as { ok: boolean; data: Record<string, any> } }
}

describe('costs/stats', () => {
  it('counts and sums every call in 30 days, past the 1,000-row page', async () => {
    db = makeFakeDb(
      {
        projects: [{ id: P, name: 'glot.it' }],
        project_settings: [{ project_id: P, byok_anthropic_key_ref: 'ref' }],
        llm_invocations: Array.from({ length: 2500 }, (_, i) => invocation(i)),
        llm_cost_usd: [],
      },
      { maxRows: 1000 },
    )
    const { body } = await get(`/v1/admin/costs/stats?project_id=${P}`)
    expect(body.data.calls30d).toBe(2500)
    expect(body.data.spend30dUsd).toBeCloseTo(25, 4)
    expect(body.data.totalSpendUsd).toBeCloseTo(25, 4)
  })

  it('adds older spend from the SQL sum plus the rows with no persisted cost', async () => {
    db = makeFakeDb(
      {
        projects: [{ id: P, name: 'glot.it' }],
        project_settings: [{ project_id: P, byok_anthropic_key_ref: 'ref' }],
        llm_invocations: [
          invocation(1),
          invocation(2, { created_at: iso(40 * 24 * HOUR), cost_usd: 1 }),
          invocation(3, { created_at: iso(40 * 24 * HOUR), cost_usd: null, used_model: 'unknown-model', input_tokens: 0, output_tokens: 0 }),
        ],
        llm_cost_usd: [],
      },
      {
        maxRows: 1000,
        rpc: (fn) => (fn === 'llm_spend_before' ? { persisted_usd: 1, ledger_usd: 0.5, unpriced_rows: 1 } : null),
      },
    )
    const { body } = await get(`/v1/admin/costs/stats?project_id=${P}`)
    // 0.01 in the window + 1 persisted + 0.5 ledger + 0 for the zero-token unpriced row.
    expect(body.data.totalSpendUsd).toBeCloseTo(1.51, 4)
    expect(db.rpcCalls.map((c) => c.fn)).toContain('llm_spend_before')
  })

  it('answers a failed read with an error instead of $0', async () => {
    db = makeFakeDb(
      { projects: [{ id: P, name: 'glot.it' }], llm_invocations: [invocation(1)] },
      { failRead: (t) => (t === 'llm_invocations' ? 'boom' : null) },
    )
    const { status, body } = await get(`/v1/admin/costs/stats?project_id=${P}`)
    expect(status).toBe(500)
    expect(body.ok).toBe(false)
  })
})

describe('releases/stats', () => {
  it('counts releases and credits exactly, past the 1,000-row cap, before release_stats_totals exists', async () => {
    const releases = Array.from({ length: 1200 }, (_, i) => ({
      id: `rel-${i}`,
      project_id: P,
      status: i < 2 ? 'draft' : 'published',
      fixed_report_ids: ['a'],
      credited_reporter_ids: i < 2 ? ['x', 'y'] : [],
      published_at: i < 2 ? null : iso(i * 1000),
      created_at: iso(i * 1000),
    }))
    const credits = Array.from({ length: 1100 }, (_, i) => ({
      id: `cr-${i}`,
      release_id: `rel-${i}`,
      notified_at: i % 2 === 0 ? iso(1000) : null,
    }))
    db = makeFakeDb(
      { releases, release_credits: credits, reports: [], support_tickets: [] },
      { maxRows: 1000 },
    )
    // Migration 20261010120000 not applied yet: PostgREST answers PGRST202.
    ;(db as unknown as { rpc: unknown }).rpc = async () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.release_stats_totals' },
    })
    const { body } = await get('/v1/admin/releases/stats')
    expect(body.data.totalReleases).toBe(1200)
    expect(body.data.draftCount).toBe(2)
    expect(body.data.publishedCount).toBe(1198)
    expect(body.data.totalFixesLinked).toBe(1200)
    expect(body.data.totalCredits).toBe(1100)
    expect(body.data.creditsNotified).toBe(550)
    expect(body.data.creditsPending).toBe(550)
    expect(body.data.topPriority).toBe('drafts_pending')
    expect(body.data.topPriorityLabel).toContain('4 contributors credited · 2 fixes linked')
  })
})

describe('releases/stats with release_stats_totals', () => {
  it('takes the array totals and credit counts from the SQL function, without paging releases', async () => {
    const releases = [
      { id: 'rel-0', project_id: P, status: 'draft', fixed_report_ids: ['a'], credited_reporter_ids: ['x'], published_at: null, created_at: iso(0) },
    ]
    db = makeFakeDb(
      { releases, release_credits: [], reports: [], support_tickets: [] },
      {
        rpc: (fn) =>
          fn === 'release_stats_totals'
            ? { total_fixes_linked: 7, total_contributors: 5, draft_fixes: 3, draft_contributors: 2, total_credits: 4, credits_notified: 1 }
            : null,
      },
    )
    const { body } = await get('/v1/admin/releases/stats')
    expect(db.rpcCalls.map((c) => c.fn)).toContain('release_stats_totals')
    expect(body.data.totalFixesLinked).toBe(7)
    expect(body.data.totalCredits).toBe(4)
    expect(body.data.creditsNotified).toBe(1)
    expect(body.data.creditsPending).toBe(3)
  })

  it('answers a failed SQL read with an error instead of zeros', async () => {
    db = makeFakeDb({ releases: [], release_credits: [], reports: [], support_tickets: [] })
    ;(db as unknown as { rpc: unknown }).rpc = async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } })
    const { status } = await get('/v1/admin/releases/stats')
    expect(status).toBe(500)
  })
})

describe('judge/stats', () => {
  it('counts prompt versions without reading them', async () => {
    db = makeFakeDb(
      {
        classification_evaluations: [],
        reports: [],
        prompt_versions: Array.from({ length: 250 }, (_, i) => ({ id: `pv-${i}`, project_id: P, is_active: i < 3 })),
      },
      { maxRows: 1000, rpc: () => [] },
    )
    const { body } = await get('/v1/admin/judge/stats')
    expect(body.data.promptVersionCount).toBe(250)
    expect(body.data.activePromptCount).toBe(3)
  })
})
