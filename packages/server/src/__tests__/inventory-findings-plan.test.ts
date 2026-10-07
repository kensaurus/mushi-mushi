/**
 * ADR 0018 (gap #32): `GET /v1/admin/inventory/:projectId/findings` answers on
 * every plan; the rest of `/v1/admin/inventory` keeps `inventory_v2`.
 *
 * `requireFeature` is replaced by a stand-in that refuses with 402, the way it
 * does on the free and indie plans, so a route that still mounts it answers
 * 402 here and the findings read must answer 200.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

let db: FakeDb
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/entitlements.ts', async (orig) => ({
  ...(await orig<typeof import('../../supabase/functions/_shared/entitlements.ts')>()),
  requireFeature: (flag: string) => async (c: { json: (b: unknown, s: number) => unknown }) =>
    c.json({ ok: false, error: { code: 'feature_not_in_plan', flag } }, 402),
}))

type Handler = (c: Ctx, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Res { body: { ok: boolean; data?: { runs: Array<{ gate: string }>; findings: Array<{ rule_id: string; file_path: string | null }> }; error?: { code: string } }; status: number }
interface Ctx {
  req: { param: (k: string) => string | undefined; query: (k: string) => string | undefined; header: (k: string) => string | undefined; path: string; method: string }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  json: (body: unknown, status?: number) => Res
}

class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, h: Handler[]) {
    const keys: string[] = []
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)' })}$`)
    this.routes.push({ method, pattern, keys, handlers: h })
  }
  get(path: string, ...h: Handler[]) { this.add('GET', path, h) }
  post(path: string, ...h: Handler[]) { this.add('POST', path, h) }
  patch(path: string, ...h: Handler[]) { this.add('PATCH', path, h) }
  put(path: string, ...h: Handler[]) { this.add('PUT', path, h) }
  delete(path: string, ...h: Handler[]) { this.add('DELETE', path, h) }
  async call(method: string, url: string): Promise<Res> {
    const [path, qs] = url.split('?')
    const route = this.routes.find((r) => r.method === method && r.pattern.test(path))
    if (!route) throw new Error(`no route ${method} ${url}`)
    const m = route.pattern.exec(path)!
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    const query = new URLSearchParams(qs ?? '')
    const vars: Record<string, unknown> = { userId: 'user-a', authMethod: 'jwt' }
    const c: Ctx = {
      req: { param: (k) => params[k], query: (k) => query.get(k) ?? undefined, header: () => undefined, path, method },
      get: (k) => vars[k],
      set: (k, v) => { vars[k] = v },
      json: (body, status = 200) => ({ body: body as Res['body'], status }),
    }
    let result: unknown
    const run = async (i: number): Promise<void> => {
      if (i === route.handlers.length - 1) { result = await route.handlers[i](c); return }
      const short = await route.handlers[i](c, () => run(i + 1))
      if (result === undefined && short !== undefined) result = short
    }
    await run(0)
    return result as Res
  }
}

const P = '10000001-0000-4000-8000-000000000000'
let app: FakeApp

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  const { registerInventoryRoutes } = await import('../../supabase/functions/api/routes/inventory.ts')
  app = new FakeApp()
  registerInventoryRoutes(app as never)
})

function seed() {
  db = makeFakeDb({
    projects: [{ id: P, owner_id: 'user-a', organization_id: null }],
    organization_members: [],
    project_members: [],
    gate_runs: [{ id: 'run-1', project_id: P, gate: 'radar', status: 'warn', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:00:00Z' }],
    gate_findings: [{ id: 'f-1', gate_run_id: 'run-1', severity: 'warn', rule_id: 'spend_cap_unset', message: 'No monthly AI budget', file_path: null, created_at: '2026-10-02T00:00:00Z' }],
  })
}

describe('inventory findings on a plan without inventory_v2', () => {
  it('lists gate findings, filtered by gate', async () => {
    seed()
    const res = await app.call('GET', `/v1/admin/inventory/${P}/findings?gate=radar`)
    expect(res.status).toBe(200)
    expect(res.body.data?.runs.map((r) => r.gate)).toEqual(['radar'])
    expect(res.body.data?.findings.map((f) => f.rule_id)).toEqual(['spend_cap_unset'])
  })

  it('keeps every check when one check fills the newest 50 runs', async () => {
    // glot.it, 2026-10-07: the schema scanner's runs hid design drift's 82 findings.
    const schemaRuns = Array.from({ length: 60 }, (_, i) => ({
      id: `schema-${i}`, project_id: P, gate: 'schema_drift', status: 'warn',
      started_at: `2026-10-06T${String(10 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}:00Z`,
      completed_at: null,
    }))
    db = makeFakeDb({
      projects: [{ id: P, owner_id: 'user-a', organization_id: null }],
      organization_members: [],
      project_members: [],
      gate_runs: [
        ...schemaRuns,
        { id: 'design-1', project_id: P, gate: 'design_drift', status: 'warn', summary: { phase: 'scan' }, started_at: '2026-10-05T00:00:00Z', completed_at: '2026-10-05T00:01:00Z' },
      ],
      gate_findings: [
        { id: 'f-d', gate_run_id: 'design-1', severity: 'warn', rule_id: 'off_token_color', message: '#fff', file_path: 'a.css', created_at: '2026-10-05T00:01:00Z' },
        { id: 'f-old', gate_run_id: 'schema-0', severity: 'warn', rule_id: 'schema-drift-table-modified', message: 'old', file_path: null, created_at: '2026-10-06T10:00:00Z' },
        { id: 'f-new', gate_run_id: 'schema-59', severity: 'warn', rule_id: 'schema-drift-table-modified', message: 'new', file_path: null, created_at: '2026-10-06T19:50:00Z' },
      ],
    })
    const res = await app.call('GET', `/v1/admin/inventory/${P}/findings`)
    expect(res.status).toBe(200)
    expect(res.body.data?.runs.map((r) => r.gate)).toContain('design_drift')
    // Only each check's newest run contributes findings.
    expect(res.body.data?.findings.map((f) => f.rule_id).sort()).toEqual(['off_token_color', 'schema-drift-table-modified'])
    expect(res.body.data?.findings.find((f) => f.rule_id === 'schema-drift-table-modified')).toMatchObject({ file_path: null })
  })

  it('still refuses a project the caller cannot reach', async () => {
    seed()
    const res = await app.call('GET', `/v1/admin/inventory/20000002-0000-4000-8000-000000000000/findings`)
    expect(res.status).toBe(403)
  })

  it('keeps every other inventory route on the plan gate', async () => {
    seed()
    for (const [method, path] of [
      ['GET', `/v1/admin/inventory/${P}`],
      ['GET', `/v1/admin/inventory/${P}/diff?from=a&to=b`],
      ['POST', `/v1/admin/inventory/${P}/gates/run`],
    ] as const) {
      const res = await app.call(method, path)
      expect(res.status, `${method} ${path}`).toBe(402)
    }
  })
})

describe('GET /v1/admin/inventory/stats openFindings', () => {
  type Stats = { openFindings: number; topPriority: string }
  const base = () => ({
    projects: [{ id: P, name: 'glot.it', owner_id: 'user-a', organization_id: null, created_at: '2026-01-01T00:00:00Z' }],
    organization_members: [],
    project_members: [],
    inventories: [{ id: 'inv-1', project_id: P, is_current: true, commit_sha: 'abc', ingested_at: '2026-05-04T00:00:00Z' }],
  })

  it('counts only the open findings of each gate’s newest run', async () => {
    // glot.it, 2026-10-07: 747 findings ever recorded vs about 105 in the latest runs.
    const oldFindings = Array.from({ length: 40 }, (_, i) => ({
      id: `old-${i}`, gate_run_id: 'crawl-old', project_id: P, severity: 'error', allowlisted: false, rule_id: 'crawl-fetch-failed', message: 'x',
    }))
    db = makeFakeDb({
      ...base(),
      gate_runs: [
        { id: 'crawl-old', project_id: P, gate: 'crawl', status: 'fail', started_at: '2026-05-03T00:00:00Z' },
        { id: 'crawl-new', project_id: P, gate: 'crawl', status: 'fail', started_at: '2026-05-04T00:00:00Z' },
        { id: 'radar-1', project_id: P, gate: 'radar', status: 'warn', started_at: '2026-10-07T00:00:00Z' },
        { id: 'radar-run', project_id: P, gate: 'radar', status: 'running', started_at: '2026-10-07T01:00:00Z' },
      ],
      gate_findings: [
        ...oldFindings,
        { id: 'n-1', gate_run_id: 'crawl-new', project_id: P, severity: 'error', allowlisted: false, rule_id: 'crawl-fetch-failed', message: 'x' },
        { id: 'n-2', gate_run_id: 'crawl-new', project_id: P, severity: 'info', allowlisted: false, rule_id: 'crawl-missing-in-app', message: 'x' },
        { id: 'n-dismissed', gate_run_id: 'crawl-new', project_id: P, severity: 'error', allowlisted: true, rule_id: 'crawl-fetch-failed', message: 'x' },
        { id: 'r-1', gate_run_id: 'radar-1', project_id: P, severity: 'warn', allowlisted: false, rule_id: 'spend_cap_unset', message: 'x' },
        { id: 'r-running', gate_run_id: 'radar-run', project_id: P, severity: 'warn', allowlisted: false, rule_id: 'spend_cap_unset', message: 'x' },
      ],
    })
    const res = await app.call('GET', '/v1/admin/inventory/stats') as unknown as { status: number; body: { ok: boolean; data: Stats } }
    expect(res.status).toBe(200)
    expect(res.body.data.openFindings).toBe(3)
    expect(res.body.data.topPriority).toBe('open_findings')
  })

  it('a failed findings read is an error, never "no open findings"', async () => {
    db = makeFakeDb(
      { ...base(), gate_runs: [{ id: 'radar-1', project_id: P, gate: 'radar', status: 'warn', started_at: '2026-10-07T00:00:00Z' }] },
      { failRead: (t) => (t === 'gate_findings' ? 'boom' : null) },
    )
    const res = await app.call('GET', '/v1/admin/inventory/stats') as unknown as { status: number; body: { ok: boolean } }
    expect(res.status).toBe(500)
    expect(res.body.ok).toBe(false)
  })
})

describe('GATED_ROUTES', () => {
  it('names the findings read as the one exception under /v1/admin/inventory', async () => {
    const { GATED_ROUTES } = await import('../../supabase/functions/_shared/entitlements.ts')
    const inv = GATED_ROUTES.find((r) => r.prefix === '/v1/admin/inventory')
    expect(inv?.flag).toBe('inventory_v2')
    expect(inv?.except).toEqual(['/v1/admin/inventory/:projectId/findings'])
  })
})
