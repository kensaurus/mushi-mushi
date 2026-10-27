/**
 * FILE: ci-bill-routes.test.ts
 * PURPOSE: GET and POST /v1/admin/ci/bill (api/routes/ci-bill.ts) through the
 *          real handlers on an in-memory database:
 *            - GET reads the bill of the owners the scoped projects' repos
 *              belong to, never another owner's or organization's rows;
 *              says how to connect when there is none, and that the
 *              migration is pending before it is applied; the agent PR
 *              share comes from the recorded jobs on private repos;
 *            - POST (the CLI push) stores rows as source 'cli', refuses an
 *              owner the project does not use, items outside the month,
 *              viewers, and a key of another project; updates the sync
 *              status and the held span.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) =>
    c.json({ ok: false, error: { code, message } }, status),
  callerProjectIds: async () => [],
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))

let routes: typeof import('../../supabase/functions/api/routes/ci-bill.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/ci-bill.ts')
})

const NOW = new Date('2026-10-27T09:00:00Z')
const ORG = '0000000a-0000-4000-8000-000000000000'
const ORG2 = '0000000b-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const P3 = '1000000c-0000-4000-8000-000000000000'

type Res = { status: number; body: { ok: boolean; data?: any; error?: { code: string; message: string } } }
type Handler = (c: unknown) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handler: h[h.length - 1] }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handler: h[h.length - 1] }) }
  async call(method: string, path: string, opts: { body?: unknown; query?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'jwt', ...opts.vars }
    const c = {
      req: { json: async () => opts.body ?? {}, query: (k: string) => opts.query?.[k], param: () => undefined, header: () => undefined },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      header: () => {},
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

interface Setup { db: FakeDb; app: FakeApp; role: { value: string | null }; rate: { allowed: boolean } }

const billRow = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  organization_id: ORG,
  owner: 'acme',
  day: '2026-10-20',
  repo: 'acme/app',
  sku: 'Actions Linux',
  unit: 'Minutes',
  quantity: 100,
  gross_usd: 0.6,
  discount_usd: 0,
  net_usd: 0.6,
  source: 'api',
  ...over,
})

function setup(seed: Record<string, Array<Record<string, unknown>>> = {}, opts: { failRead?: (t: string) => { code: string; message: string } | null } = {}): Setup {
  const db = makeFakeDb(
    {
      projects: [
        { id: P1, organization_id: ORG },
        { id: P2, organization_id: ORG },
        { id: P3, organization_id: ORG2 },
      ],
      project_repos: [
        { project_id: P1, repo_url: 'https://github.com/Acme/app' },
        { project_id: P2, repo_url: 'https://github.com/other/site' },
        { project_id: P3, repo_url: 'https://github.com/acme/elsewhere' },
      ],
      ...seed,
    },
    { failRead: opts.failRead, rpcError: (fn) => (fn === 'ci_cost_facts' ? { code: 'PGRST202', message: 'Could not find the function' } : null) },
  )
  const role = { value: 'member' as string | null }
  const rate = { allowed: true }
  const app = new FakeApp()
  routes.registerCiBillRoutes(app as never, {
    getServiceClient: () => db as never,
    adminOrApiKeyRead: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    adminOrApiKeyWrite: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    claimRateLimit: async () => ({ allowed: rate.allowed, retryAfterSec: 60 }) as never,
    callerProjectIds: async () => [P1, P2],
    callerCanAccessProject: async (_c: unknown, _db: unknown, _u: string, pid: string) => ({ allowed: role.value != null && pid !== P3, role: role.value }) as never,
    now: () => NOW,
  })
  return { db, app, role, rate }
}

const job = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  project_id: P1,
  repo: 'Acme/app',
  run_id: 1,
  workflow_name: 'CI',
  job_name: 'test',
  event: 'pull_request',
  head_branch: 'feature/x',
  pr_number: 4,
  status: 'completed',
  started_at: '2026-10-26T00:00:00Z',
  duration_seconds: 590,
  runner_kind: 'github_hosted',
  runner_labels: ['ubuntu-latest'],
  runner_name: 'GitHub Actions 3',
  runner_group_name: 'GitHub Actions',
  steps: [],
  gh_created_at: '2026-10-26T00:00:00Z',
  ...over,
})

describe('GET /v1/admin/ci/bill', () => {
  it('reads the bill of the owners the scoped repos belong to, within their organizations', async () => {
    const s = setup({
      ci_billing_sync: [
        { organization_id: ORG, owner: 'acme', owner_type: 'User', last_ok_at: '2026-10-27T02:00:00Z', last_attempt_at: '2026-10-27T02:00:00Z', last_error: null, last_source: 'api', covered_from: '2026-08-01' },
        { organization_id: ORG, owner: 'stranger', owner_type: 'User', last_ok_at: '2026-10-27T02:00:00Z', last_attempt_at: null, last_error: null, last_source: 'api', covered_from: '2026-08-01' },
      ],
      ci_billing_daily: [
        billRow({}),
        billRow({ repo: 'acme/docs', day: '2026-10-21', gross_usd: 1, discount_usd: 1, net_usd: 0 }),
        billRow({ owner: 'stranger', repo: 'stranger/x', net_usd: 50, gross_usd: 50 }),
        billRow({ organization_id: ORG2, net_usd: 70, gross_usd: 70 }),
      ],
      ci_collector_state: [{ project_id: P1, permissions: { 'Acme/app': { jobs: 'ok', runners: 'ok', visibility: 'private' } } }],
      ci_jobs: [job({}), job({ id: crypto.randomUUID(), run_id: 2, head_branch: 'cursor/mushi-fix-1', pr_number: 5, duration_seconds: 1190 })],
    })
    const res = await s.app.call('GET', '/v1/admin/ci/bill', { query: { project_id: P1, days: '30' } })
    expect(res.status).toBe(200)
    const bill = res.body.data
    expect(bill.available).toBe(true)
    expect(bill.totals.netUsd).toBe(0.6)
    expect(bill.totals.grossUsd).toBe(1.6)
    expect(bill.byRepo.map((r: { repo: string }) => r.repo)).toEqual(['acme/app', 'acme/docs'])
    expect(bill.owners.map((o: { owner: string }) => o.owner)).toEqual(['acme'])
    expect(bill.agentShare).toMatchObject({ provenance: 'estimated', billedMinutes: 30, agentBilledMinutes: 20 })
  })

  it('says how to connect when there is no bill, and that the update is pending before the migration', async () => {
    const empty = await setup().app.call('GET', '/v1/admin/ci/bill', { query: {} })
    expect(empty.status).toBe(200)
    expect(empty.body.data.available).toBe(false)
    expect(empty.body.data.unavailableReason).toContain('mushi runner bill --push')

    const pending = await setup({}, { failRead: (t) => (t === 'ci_billing_sync' ? { code: '42P01', message: 'relation does not exist' } : null) }).app.call('GET', '/v1/admin/ci/bill', { query: {} })
    expect(pending.status).toBe(200)
    expect(pending.body.data.unavailableReason).toContain('20261027091500_ci_billing_real_bill')
  })

  it('refuses a project the caller cannot read, and answers 500 on a failed read rather than an empty bill', async () => {
    expect((await setup().app.call('GET', '/v1/admin/ci/bill', { query: { project_id: P3 } })).status).toBe(403)
    expect((await setup().app.call('GET', '/v1/admin/ci/bill', { query: { project_id: 'nope' } })).status).toBe(400)
    const broken = await setup({}, { failRead: (t) => (t === 'ci_billing_daily' ? { code: 'XX000', message: 'boom' } : null) }).app.call('GET', '/v1/admin/ci/bill', { query: {} })
    expect(broken.status).toBe(500)
  })
})

describe('POST /v1/admin/ci/bill', () => {
  const items = [
    { date: '2026-10-01T00:47:27Z', product: 'actions', sku: 'Actions Linux', quantity: 10, unitType: 'Minutes', grossAmount: 0.06, discountAmount: 0, netAmount: 0.06, repositoryName: 'app' },
    { date: '2026-10-01T05:00:00Z', product: 'actions', sku: 'Actions Linux', quantity: 5, unitType: 'Minutes', grossAmount: 0.03, discountAmount: 0, netAmount: 0.03, repositoryName: 'app' },
    { date: '2026-10-02T00:00:00Z', product: 'copilot', sku: 'Copilot Premium Request', quantity: 1, unitType: 'requests', grossAmount: 0.04, discountAmount: 0, netAmount: 0.04 },
  ]
  const push = (s: Setup, body: Record<string, unknown>, vars: Record<string, unknown> = {}) =>
    s.app.call('POST', '/v1/admin/ci/bill', { body: { projectId: P1, owner: 'acme', ownerType: 'User', year: 2026, month: 10, items, ...body }, vars })

  it('stores the month as source cli under the bound owner spelling and records the sync', async () => {
    const s = setup()
    const res = await push(s, {})
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ owner: 'Acme', month: '2026-10', rows: 1, skipped: 1, netUsd: 0.09, coveredFrom: '2026-10-01' })
    expect(s.db.table('ci_billing_daily')).toEqual([
      expect.objectContaining({ organization_id: ORG, owner: 'Acme', day: '2026-10-01', repo: 'Acme/app', quantity: 15, net_usd: 0.09, source: 'cli' }),
    ])
    expect(s.db.table('ci_billing_sync')[0]).toMatchObject({ organization_id: ORG, owner: 'Acme', owner_type: 'User', last_source: 'cli', last_error: null, covered_from: '2026-10-01' })
    // Pushing again replaces the rows rather than adding to them.
    await push(s, {})
    expect(s.db.table('ci_billing_daily')).toHaveLength(1)
  })

  it('refuses an owner the project does not use, items outside the month, viewers, a foreign key and a bad body', async () => {
    expect((await push(setup(), { owner: 'stranger' })).body.error?.code).toBe('OWNER_NOT_BOUND')
    expect((await push(setup(), { month: 9 })).body.error?.code).toBe('VALIDATION_ERROR')
    const viewer = setup()
    viewer.role.value = 'viewer'
    expect((await push(viewer, {})).status).toBe(403)
    expect((await push(setup(), {}, { projectId: P2, authMethod: 'apiKey' })).status).toBe(403)
    expect((await push(setup(), { owner: '-bad-' })).status).toBe(400)
    expect((await push(setup(), { extra: 1 })).status).toBe(400)
    const limited = setup()
    limited.rate.allowed = false
    expect((await push(limited, {})).status).toBe(429)
    expect((await push(setup(), { projectId: undefined })).body.error?.code).toBe('PROJECT_REQUIRED')
  })
})
