/**
 * Per-app spend ledger (gap #22): `_shared/spend-bill-csv.ts`,
 * `_shared/spend-ledger.ts` and `api/routes/spend-ledger.ts`.
 *
 *   - FOCUS (Vercel / AWS), AWS CUR and plain CSV bills are read; rows in
 *     another currency or with a non-ISO date are skipped and explained;
 *   - one row per (app, day, service, unit), so a re-import never double-counts;
 *   - CI minutes cost $0.006 each (the minutes already carry the macOS 10×);
 *   - a source that fails to read is `error` with no amount, never $0;
 *   - only owners and admins import, and only into their team's apps.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let csv: typeof import('../../supabase/functions/_shared/spend-bill-csv.ts')
let ledger: typeof import('../../supabase/functions/_shared/spend-ledger.ts')
let routes: typeof import('../../supabase/functions/api/routes/spend-ledger.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  csv = await import('../../supabase/functions/_shared/spend-bill-csv.ts')
  ledger = await import('../../supabase/functions/_shared/spend-ledger.ts')
  routes = await import('../../supabase/functions/api/routes/spend-ledger.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-03T12:00:00Z')

describe('parseCsvRecords', () => {
  it('reads quoted cells with commas, doubled quotes and newlines, CRLF and a BOM', () => {
    const rows = csv.parseCsvRecords('﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n1,2,3')
    expect(rows).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', 'two\nlines'], ['1', '2', '3']])
  })
})

describe('parseBillCsv', () => {
  it('reads a FOCUS export, skips other currencies and bad dates, and takes the app from Tags', () => {
    const text = [
      'BilledCost,BillingCurrency,ChargePeriodStart,ServiceName,ConsumedQuantity,ConsumedUnit,Tags',
      '12.50,USD,2026-10-01T00:00:00Z,Fast Data Transfer,250,GB,"{""ProjectName"":""glot-it""}"',
      '3.00,EUR,2026-10-01T00:00:00Z,Functions,10,GB-Hrs,{}',
      '1.00,USD,10/01/2026,Functions,1,GB-Hrs,{}',
    ].join('\n')
    const r = csv.parseBillCsv(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.bill.format).toBe('focus')
    expect(r.bill.rowsRead).toBe(3)
    expect(r.bill.rows).toEqual([{ day: '2026-10-01', service: 'Fast Data Transfer', unit: 'GB', amountUsd: 12.5, quantity: 250, app: 'glot-it' }])
    expect(r.bill.skipped).toBe(2)
    expect(r.bill.skipReasons).toEqual(['line 3: currency EUR is not USD', 'line 4: the date is not YYYY-MM-DD'])
  })

  it('reads an AWS Cost and Usage Report with its own column names', () => {
    const r = csv.parseBillCsv('lineItem/UsageStartDate,lineItem/UnblendedCost,product/ProductName,lineItem/UsageAmount,pricing/unit,resourceTags/user:app\n2026-09-30T00:00:00Z,"$1,204.10",Amazon Simple Storage Service,12,GB-Mo,yen-yen')
    expect(r.ok && r.bill.format).toBe('aws_cur')
    expect(r.ok && r.bill.rows[0]).toEqual({ day: '2026-09-30', service: 'Amazon Simple Storage Service', unit: 'GB-Mo', amountUsd: 1204.1, quantity: 12, app: 'yen-yen' })
  })

  it('reads a plain CSV and refuses one with no cost column', () => {
    const r = csv.parseBillCsv('date,service,cost\n2026-10-02,Edge Function Invocations,(2.00)')
    expect(r.ok && r.bill.format).toBe('generic')
    expect(r.ok && r.bill.rows[0].amountUsd).toBe(-2)
    const bad = csv.parseBillCsv('date,service\n2026-10-02,x')
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.error).toMatch(/date column and a cost column/)
  })

  it('rejects an impossible calendar date instead of rolling it over', () => {
    expect(csv.billDay('2026-02-30')).toBeNull()
    expect(csv.billDay('2026-10-01T23:30:00-02:00')).toBe('2026-10-02')
  })
})

describe('aggregateBill', () => {
  it('sums rows per app, day, service and unit, and counts rows naming no known app', () => {
    const rows = [
      { day: '2026-10-01', service: 'Egress', unit: 'GB', amountUsd: 1.25, quantity: 10, app: 'a' },
      { day: '2026-10-01', service: 'Egress', unit: 'GB', amountUsd: 0.75, quantity: 5, app: 'a' },
      { day: '2026-10-01', service: 'Egress', unit: 'GB', amountUsd: 4, quantity: 2, app: 'unknown' },
    ]
    const agg = csv.aggregateBill(rows, (app) => (app === 'a' ? P1 : null))
    expect(agg.entries).toEqual([{ projectId: P1, day: '2026-10-01', service: 'Egress', unit: 'GB', amountUsd: 2, quantity: 15 }])
    expect(agg.unmatched).toBe(1)
    expect(agg.unmatchedApps).toEqual(['unknown'])
    expect(agg.totalUsd).toBe(2)
    expect([agg.periodStart, agg.periodEnd]).toEqual(['2026-10-01', '2026-10-01'])
  })
})

function seedLedger(extra: Record<string, unknown[]> = {}): FakeDb {
  return makeFakeDb({
    organizations: [{ id: ORG, name: 'Kenji apps' }],
    projects: [
      { id: P1, name: 'glot.it', slug: 'glot-it', owner_id: 'owner', organization_id: ORG },
      { id: P2, name: 'yen-yen', slug: 'yen-yen', owner_id: 'owner', organization_id: ORG },
    ],
    organization_members: [
      { organization_id: ORG, user_id: 'owner', role: 'owner' },
      { organization_id: ORG, user_id: 'member', role: 'member' },
    ],
    project_members: [],
    llm_invocations: [
      { project_id: P1, cost_usd: 1.5, created_at: '2026-10-01T00:00:00Z' },
      { project_id: P1, cost_usd: '0.25', created_at: '2026-09-20T00:00:00Z' },
      { project_id: P1, cost_usd: 99, created_at: '2026-08-01T00:00:00Z' },
    ],
    ci_workflow_runs: [
      // 100 Linux minutes + a 5-minute macOS job (50 billable): 150 × $0.006.
      { project_id: P1, est_billable_minutes: 100, started_at: '2026-10-01T00:00:00Z' },
      { project_id: P1, est_billable_minutes: 50, started_at: '2026-10-02T00:00:00Z' },
    ],
    connector_instances: [{ id: 'llm1', organization_id: ORG, kind: 'llm_usage' }],
    connector_bindings: [{ connector_instance_id: 'llm1', project_id: P1, external_id: 'proj_abc' }],
    // One current snapshot per (instance, project): this project's spend and the provider org's total.
    connector_snapshots: [{ connector_instance_id: 'llm1', project_id: P1, ok: true, error: null, is_current: true, observed_at: '2026-10-03T03:35:00Z', snapshot: { facts: { perProject: { [P1]: 42.1 }, unattributedUsd: 7.5, totalUsd: 49.6 } } }],
    spend_ledger_entries: [
      { organization_id: ORG, project_id: P2, vendor: 'supabase', service: 'Egress', unit: 'GB', day: '2026-09-28', amount_usd: 9, quantity: 120 },
      { organization_id: ORG, project_id: P2, vendor: 'vercel', service: 'Functions', unit: '', day: '2026-09-28', amount_usd: 20, quantity: null },
      { organization_id: ORG, project_id: P2, vendor: 'vercel', service: 'Functions', unit: '', day: '2026-08-01', amount_usd: 500, quantity: null },
    ],
    spend_bill_imports: [],
    ...extra,
  } as never, { autoId: true })
}

describe('buildSpendLedger', () => {
  it('reads each app from its own snapshot of a shared provider source, never counting a spend twice', async () => {
    const db = seedLedger({
      connector_bindings: [
        { connector_instance_id: 'llm1', project_id: P1, external_id: 'proj_abc' },
        { connector_instance_id: 'llm1', project_id: P2, external_id: 'proj_def' },
      ],
      connector_snapshots: [
        { connector_instance_id: 'llm1', project_id: P1, ok: true, error: null, is_current: true, observed_at: '2026-10-03T03:35:00Z', snapshot: { facts: { perProject: { [P1]: 42.1 }, totalUsd: 49.6 } } },
        { connector_instance_id: 'llm1', project_id: P2, ok: true, error: null, is_current: true, observed_at: '2026-10-02T03:35:00Z', snapshot: { facts: { perProject: { [P2]: 5 }, totalUsd: 49.6 } } },
      ],
    })
    const r = await ledger.buildSpendLedger(db as never, { organizationId: ORG, projects: [{ id: P1, name: 'glot.it' }, { id: P2, name: 'yen-yen' }], now: NOW })
    expect(r.apps.find((a) => a.projectId === P1)?.providerLlm.usd).toBe(42.1)
    expect(r.apps.find((a) => a.projectId === P2)?.providerLlm).toMatchObject({ state: 'ok', usd: 5, detail: 'Provider cost report as of 2026-10-02.' })
    expect(r.totals.providerLlmUsd).toBe(47.1)
    expect(r.unattributedProviderUsd).toBe(2.5)
  })

  it('a bound app with no snapshot of its own yet is unknown, not $0', async () => {
    const db = seedLedger({ connector_bindings: [{ connector_instance_id: 'llm1', project_id: P2, external_id: 'proj_def' }] })
    const r = await ledger.buildSpendLedger(db as never, { organizationId: ORG, projects: [{ id: P2, name: 'yen-yen' }], now: NOW })
    expect(r.apps[0].providerLlm).toMatchObject({ state: 'error', usd: null })
    expect(r.apps[0].providerLlm.detail).toMatch(/Not read yet/)
  })

  it('combines Mushi AI, provider AI, CI minutes and imported bills per app over 30 days', async () => {
    const db = seedLedger()
    const r = await ledger.buildSpendLedger(db as never, { organizationId: ORG, projects: [{ id: P1, name: 'glot.it' }, { id: P2, name: 'yen-yen' }], now: NOW })
    const glot = r.apps.find((a) => a.projectId === P1)!
    expect(glot.mushiLlm).toMatchObject({ state: 'ok', usd: 1.75, calls: 2 })
    expect(glot.providerLlm).toMatchObject({ state: 'ok', usd: 42.1 })
    expect(glot.ci).toMatchObject({ state: 'ok', usd: 0.9, minutes: 150, runs: 2 })
    expect(glot.ci.detail).toMatch(/Estimated/)
    expect(glot.supabase.state).toBe('not_connected')
    expect(glot.totalUsd).toBe(44.75)
    const yen = r.apps.find((a) => a.projectId === P2)!
    expect(yen.providerLlm).toMatchObject({ state: 'not_connected', usd: null })
    expect(yen.ci.state).toBe('not_connected')
    expect(yen.supabase).toMatchObject({ state: 'ok', usd: 9, usage: [{ service: 'Egress', unit: 'GB', quantity: 120 }] })
    expect(yen.bills).toMatchObject({ state: 'ok', usd: 20, byVendor: [{ vendor: 'vercel', usd: 20 }] })
    expect(r.unattributedProviderUsd).toBe(7.5)
    expect(r.totals.totalUsd).toBe(73.75)
    expect(r.complete).toBe(true)
    expect(r.ciUsdPerLinuxMinute).toBe(0.006)
  })

  it('says not connected when the team has no AI provider source', async () => {
    const db = seedLedger({ connector_instances: [], connector_bindings: [], connector_snapshots: [] })
    const r = await ledger.buildSpendLedger(db as never, { organizationId: ORG, projects: [{ id: P1, name: 'glot.it' }], now: NOW })
    expect(r.apps[0].providerLlm.state).toBe('not_connected')
    expect(r.unattributedProviderUsd).toBeNull()
  })

  it('marks a failed read as an error with no amount, and the ledger as incomplete', async () => {
    const db = seedLedger()
    const failed = { data: null, error: { message: 'statement timeout' } }
    const chain: Record<string, unknown> = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(failed).then(ok) : () => chain) })
    const broken = new Proxy(db, { get: (t, prop, r) => (prop === 'from' ? (name: string) => (name === 'ci_workflow_runs' ? chain : t.from(name)) : Reflect.get(t, prop, r)) })
    const r = await ledger.buildSpendLedger(broken as never, { organizationId: ORG, projects: [{ id: P1, name: 'glot.it' }], now: NOW })
    expect(r.apps[0].ci).toMatchObject({ state: 'error', usd: null })
    expect(r.apps[0].complete).toBe(false)
    expect(r.complete).toBe(false)
    expect(r.apps[0].totalUsd).toBe(43.85)
  })

  it('treats a provider source whose last read failed as unknown, not $0', async () => {
    const db = seedLedger({ connector_snapshots: [{ connector_instance_id: 'llm1', project_id: P1, ok: false, error: '401', is_current: true, observed_at: '2026-10-03T03:35:00Z', snapshot: null }] })
    const r = await ledger.buildSpendLedger(db as never, { organizationId: ORG, projects: [{ id: P1, name: 'glot.it' }], now: NOW })
    expect(r.apps[0].providerLlm).toMatchObject({ state: 'error', usd: null })
  })
})

// ── routes ───────────────────────────────────────────────────────────────────

type Ctx = {
  req: { json: () => Promise<unknown>; param: (k: string) => string | undefined; query: () => undefined; header: () => undefined }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  json: (body: unknown, status?: number) => { body: unknown; status: number }
}
type Handler = (c: Ctx, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Res { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } }

class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(p: string, ...h: Handler[]) { this.add('GET', p, h) }
  post(p: string, ...h: Handler[]) { this.add('POST', p, h) }
  delete(p: string, ...h: Handler[]) { this.add('DELETE', p, h) }
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<Res> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...opts.vars }
      const c: Ctx = {
        req: { json: async () => opts.body, param: (k: string) => params[k], query: () => undefined, header: () => undefined },
        get: (k: string) => vars[k], set: (k: string, v: unknown) => { vars[k] = v },
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      let result: unknown
      const go = async (i: number): Promise<void> => {
        if (i === r.handlers.length - 1) { result = await r.handlers[i](c); return }
        const short = await r.handlers[i](c, () => go(i + 1))
        if (result === undefined && short !== undefined) result = short
      }
      await go(0)
      return result as Res
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

function harness(db: FakeDb) {
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  routes.registerSpendLedgerRoutes(app as never, { getServiceClient: () => db as never, adminOrApiKeyRead: pass, jwtAuth: pass, now: () => NOW })
  return app
}

const VERCEL_FOCUS = [
  'BilledCost,BillingCurrency,ChargePeriodStart,ServiceName,ConsumedQuantity,ConsumedUnit',
  '4.00,USD,2026-10-01T00:00:00Z,Functions,10,GB-Hrs',
  '1.00,USD,2026-10-01T00:00:00Z,Functions,2,GB-Hrs',
  '2.50,USD,2026-10-02T00:00:00Z,Fast Data Transfer,30,GB',
].join('\n')

describe('spend routes', () => {
  it('returns the ledger for the team', async () => {
    const res = await harness(seedLedger()).call('GET', `/v1/admin/orgs/${ORG}/spend`)
    expect(res.status).toBe(200)
    expect((res.body.data as { apps: unknown[] }).apps).toHaveLength(2)
  })

  it('imports a bill into one app, and a second import of the same bill overwrites instead of adding', async () => {
    const db = seedLedger({ spend_ledger_entries: [] })
    const app = harness(db)
    const first = await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'vercel', projectId: P1, filename: 'vercel-sept.csv', csv: VERCEL_FOCUS } })
    expect(first.status).toBe(200)
    expect(first.body.data).toMatchObject({ format: 'focus', rowsRead: 3, rowsImported: 3, rowsSkipped: 0, totalUsd: 7.5 })
    expect(db.table('spend_ledger_entries')).toHaveLength(2)
    await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'vercel', projectId: P1, csv: VERCEL_FOCUS } })
    const entries = db.table('spend_ledger_entries')
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.service === 'Functions')).toMatchObject({ amount_usd: 5, quantity: 12, project_id: P1, organization_id: ORG })
    expect(db.table('spend_bill_imports')).toHaveLength(2)
  })

  it('matches rows to apps by an app column, and refuses a bill that names none of them', async () => {
    const db = seedLedger({ spend_ledger_entries: [] })
    const app = harness(db)
    const ok = await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'aws', csv: 'date,service,cost,app\n2026-10-01,S3,3,yen-yen\n2026-10-01,S3,2,other-app' } })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ rowsImported: 1, rowsSkipped: 1, unmatchedApps: ['other-app'] })
    expect(db.table('spend_ledger_entries')[0]).toMatchObject({ project_id: P2, vendor: 'aws', amount_usd: 3 })
    const none = await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'aws', csv: 'date,service,cost\n2026-10-01,S3,3' } })
    expect(none.status).toBe(400)
    expect(none.body.error?.code).toBe('NOTHING_IMPORTED')
  })

  it('only owners and admins import, only into the team\'s apps, and a bad file is a 400', async () => {
    const app = harness(seedLedger())
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'vercel', projectId: P1, csv: VERCEL_FOCUS }, vars: { userId: 'member' } })).status).toBe(403)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'vercel', projectId: '9000000a-0000-4000-8000-000000000000', csv: VERCEL_FOCUS } })).status).toBe(404)
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'gcp', projectId: P1, csv: VERCEL_FOCUS } })).body.error?.code).toBe('VALIDATION_ERROR')
    expect((await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'vercel', projectId: P1, csv: 'foo,bar\n1,2' } })).body.error?.code).toBe('VALIDATION_ERROR')
  })

  it('removes an import and its rows', async () => {
    const db = seedLedger({ spend_ledger_entries: [] })
    const app = harness(db)
    const imp = await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'vercel', projectId: P1, csv: VERCEL_FOCUS } })
    const importId = (imp.body.data as { importId: string }).importId
    expect((await app.call('DELETE', `/v1/admin/orgs/${ORG}/spend/imports/${importId}`, { vars: { userId: 'member' } })).status).toBe(403)
    const del = await app.call('DELETE', `/v1/admin/orgs/${ORG}/spend/imports/${importId}`)
    expect(del.status).toBe(200)
    expect(db.table('spend_ledger_entries')).toHaveLength(0)
    expect(db.table('spend_bill_imports')).toHaveLength(0)
  })
})
