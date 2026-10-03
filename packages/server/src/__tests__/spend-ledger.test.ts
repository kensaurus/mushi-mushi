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
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('reads past the server\'s 1,000-row cap instead of summing the first page as the whole month', async () => {
    const calls = Array.from({ length: 1_500 }, (_, i) => ({ project_id: P1, cost_usd: 0.01, created_at: `2026-10-0${1 + (i % 2)}T00:00:00Z` }))
    const base = seedLedger({ llm_invocations: calls })
    const db = makeFakeDb(base.tables as never, { autoId: true, maxRows: 1_000 })
    const r = await ledger.buildSpendLedger(db as never, { organizationId: ORG, projects: [{ id: P1, name: 'glot.it' }], now: NOW })
    expect(r.apps[0].mushiLlm).toMatchObject({ state: 'ok', usd: 15, calls: 1_500 })
  })

  it('treats a provider source whose last read failed as unknown, not $0', async () => {
    const db = seedLedger({ connector_snapshots: [{ connector_instance_id: 'llm1', project_id: P1, ok: false, error: '401', is_current: true, observed_at: '2026-10-03T03:35:00Z', snapshot: null }] })
    const r = await ledger.buildSpendLedger(db as never, { organizationId: ORG, projects: [{ id: P1, name: 'glot.it' }], now: NOW })
    expect(r.apps[0].providerLlm).toMatchObject({ state: 'error', usd: null })
  })
})

// ── routes ───────────────────────────────────────────────────────────────────

type Ctx = {
  req: { raw: Request; json: () => Promise<unknown>; param: (k: string) => string | undefined; query: () => undefined; header: (name: string) => string | undefined }
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
  /** `rawBody` sends a body as-is; `headers` overrides the request headers (e.g. a lying content-length). */
  async call(method: string, url: string, opts: { body?: unknown; rawBody?: string; headers?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...opts.vars }
      const text = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body))
      const raw = new Request(`https://api.test${url}`, { method, body: method === 'GET' || method === 'DELETE' ? undefined : text })
      const headers = new Map(Object.entries({ ...(text === undefined ? {} : { 'content-length': String(new TextEncoder().encode(text).byteLength) }), ...opts.headers }))
      const c: Ctx = {
        req: { raw, json: async () => opts.body, param: (k: string) => params[k], query: () => undefined, header: (name: string) => headers.get(name.toLowerCase()) },
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
  // The clock moves a minute per call, so each import is strictly newer than the one before.
  let tick = 0
  const now = () => new Date(NOW.getTime() + (tick++) * 60_000)
  routes.registerSpendLedgerRoutes(app as never, { getServiceClient: () => db as never, adminOrApiKeyRead: pass, jwtAuth: pass, now })
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
    expect(del.body.data).toMatchObject({ importId, rowsRemoved: 2, rowsRestored: 0, restoredFrom: 0 })
    expect(db.table('spend_ledger_entries')).toHaveLength(0)
    expect(db.table('spend_bill_imports')).toHaveLength(0)
  })
})

describe('re-imports and removals reconcile', () => {
  // Plain CSVs for one app: September 28 to 30, then a bill overlapping the 30th, then one for the 30th only.
  const A = 'date,service,cost\n2026-09-28,Functions,1\n2026-09-29,Functions,2\n2026-09-30,Functions,3'
  const B = 'date,service,cost\n2026-09-30,Functions,30\n2026-10-01,Functions,40'
  const C = 'date,service,cost\n2026-09-30,Functions,300'

  async function importBill(app: FakeApp, csvText: string): Promise<string> {
    const res = await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'vercel', projectId: P1, csv: csvText } })
    expect(res.status).toBe(200)
    return (res.body.data as { importId: string }).importId
  }

  /** day → [amount, owning import] for the app's Vercel rows. */
  function ledger(db: FakeDb): Record<string, [number, string]> {
    return Object.fromEntries(db.table('spend_ledger_entries')
      .filter((e) => e.project_id === P1 && e.vendor === 'vercel')
      .map((e) => [String(e.day), [Number(e.amount_usd), String(e.import_id)]]))
  }

  it('keeps each import\'s own rows', async () => {
    const db = seedLedger({ spend_ledger_entries: [] })
    const a = await importBill(harness(db), A)
    expect(db.table('spend_bill_import_rows').filter((r) => r.import_id === a)).toHaveLength(3)
  })

  it('removing the newer import hands the overlapping day back to the older one, which stays listed', async () => {
    const db = seedLedger({ spend_ledger_entries: [] })
    const app = harness(db)
    const a = await importBill(app, A)
    const b = await importBill(app, B)
    expect(ledger(db)).toEqual({ '2026-09-28': [1, a], '2026-09-29': [2, a], '2026-09-30': [30, b], '2026-10-01': [40, b] })

    const del = await app.call('DELETE', `/v1/admin/orgs/${ORG}/spend/imports/${b}`)
    expect(del.status).toBe(200)
    expect(del.body.data).toMatchObject({ rowsRemoved: 1, rowsRestored: 1, restoredFrom: 1 })
    expect(ledger(db)).toEqual({ '2026-09-28': [1, a], '2026-09-29': [2, a], '2026-09-30': [3, a] })

    const view = await app.call('GET', `/v1/admin/orgs/${ORG}/spend`)
    const data = view.body.data as { imports: Array<{ id: string; totalUsd: number }>; apps: Array<{ projectId: string; bills: { usd: number | null } }> }
    expect(data.imports.map((i) => [i.id, i.totalUsd])).toEqual([[a, 6]])
    expect(data.apps.find((x) => x.projectId === P1)?.bills.usd).toBe(6)
  })

  it('removing the older import leaves the days a later import replaced, and says nothing came back', async () => {
    const db = seedLedger({ spend_ledger_entries: [] })
    const app = harness(db)
    const a = await importBill(app, A)
    const b = await importBill(app, B)
    const del = await app.call('DELETE', `/v1/admin/orgs/${ORG}/spend/imports/${a}`)
    expect(del.body.data).toMatchObject({ rowsRemoved: 2, rowsRestored: 0, restoredFrom: 0 })
    expect(ledger(db)).toEqual({ '2026-09-30': [30, b], '2026-10-01': [40, b] })

    // An import whose every day a later one replaced removes nothing from the ledger.
    const c = await importBill(app, C)
    const d = await importBill(app, C)
    const delC = await app.call('DELETE', `/v1/admin/orgs/${ORG}/spend/imports/${c}`)
    expect(delC.body.data).toMatchObject({ rowsRemoved: 0, rowsRestored: 0 })
    expect(ledger(db)['2026-09-30']).toEqual([300, d])
  })

  it('falls back to the next newest import, not the oldest', async () => {
    const db = seedLedger({ spend_ledger_entries: [] })
    const app = harness(db)
    const a = await importBill(app, A)
    const b = await importBill(app, B)
    const c = await importBill(app, C)
    expect(ledger(db)['2026-09-30']).toEqual([300, c])
    await app.call('DELETE', `/v1/admin/orgs/${ORG}/spend/imports/${c}`)
    expect(ledger(db)['2026-09-30']).toEqual([30, b])
    await app.call('DELETE', `/v1/admin/orgs/${ORG}/spend/imports/${b}`)
    expect(ledger(db)).toEqual({ '2026-09-28': [1, a], '2026-09-29': [2, a], '2026-09-30': [3, a] })
  })

  it('a removal that fails half way is finished by trying again', async () => {
    const real = seedLedger({ spend_ledger_entries: [] })
    let failNextDelete = false
    const db = new Proxy(real, {
      get: (t, prop, r) => {
        if (prop !== 'from') return Reflect.get(t, prop, r)
        return (name: string) => {
          const q = t.from(name)
          if (name !== 'spend_ledger_entries' || !failNextDelete) return q
          q.delete = (() => {
            failNextDelete = false
            const failed = { data: null, error: { message: 'connection reset' } }
            const chain: Record<string, unknown> = new Proxy({}, { get: (_x, p) => (p === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(failed).then(ok) : () => chain) })
            return chain
          }) as typeof q.delete
          return q
        }
      },
    }) as FakeDb
    const app = harness(db)
    const a = await importBill(app, A)
    const b = await importBill(app, B)
    failNextDelete = true
    const first = await app.call('DELETE', `/v1/admin/orgs/${ORG}/spend/imports/${b}`)
    expect(first.status).toBe(500)
    // The overlapping day is already back with A; B still owns October 1 and is still listed.
    expect(ledger(real)).toEqual({ '2026-09-28': [1, a], '2026-09-29': [2, a], '2026-09-30': [3, a], '2026-10-01': [40, b] })
    expect(real.table('spend_bill_imports').map((i) => i.id)).toContain(b)
    const retry = await app.call('DELETE', `/v1/admin/orgs/${ORG}/spend/imports/${b}`)
    expect(retry.status).toBe(200)
    expect(retry.body.data).toMatchObject({ rowsRemoved: 1, rowsRestored: 0 })
    expect(ledger(real)).toEqual({ '2026-09-28': [1, a], '2026-09-29': [2, a], '2026-09-30': [3, a] })
    expect(real.table('spend_bill_imports').map((i) => i.id)).toEqual([a])
  })
})

describe('bill import size cap', () => {
  it('counts the CSV in bytes, not characters', async () => {
    // 1.8 million three-byte characters: under 5 million characters, over 5 MB.
    const csvText = `date,service,cost\n2026-10-01,${'€'.repeat(1_800_000)},1`
    expect(csvText.length).toBeLessThan(routes.MAX_BILL_CSV_BYTES)
    const db = seedLedger({ spend_ledger_entries: [] })
    const res = await harness(db).call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'vercel', projectId: P1, csv: csvText } })
    expect(res.status).toBe(413)
    expect(res.body.error?.code).toBe('PAYLOAD_TOO_LARGE')
    expect(db.table('spend_bill_imports')).toHaveLength(0)
  })

  it('refuses a declared length over the cap before reading the body, and a body that is not JSON', async () => {
    const app = harness(seedLedger())
    const big = await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { body: { vendor: 'vercel', projectId: P1, csv: VERCEL_FOCUS }, headers: { 'content-length': String(routes.MAX_IMPORT_BODY_BYTES + 1) } })
    expect(big.status).toBe(413)
    const bad = await app.call('POST', `/v1/admin/orgs/${ORG}/spend/imports`, { rawBody: '{"vendor": "vercel", "csv": ' })
    expect(bad.status).toBe(400)
    expect(bad.body.error?.code).toBe('VALIDATION_ERROR')
  })
})

describe('spend ledger RLS (read from the migration SQL; no Postgres in this suite)', () => {
  const migrationsDir = resolve(__dirname, '../../supabase/migrations')
  /** The last `create policy <name>` statement across the migrations, in apply order. */
  function latestPolicy(name: string): string {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    let found = ''
    for (const f of files) {
      // A Windows checkout may carry CRLF.
      const sql = readFileSync(resolve(migrationsDir, f), 'utf8').replace(/\r\n/g, '\n')
      const at = sql.lastIndexOf(`create policy ${name}\n`)
      if (at >= 0) found = sql.slice(at, sql.indexOf(';', at))
    }
    expect(found, `policy ${name}`).not.toBe('')
    return found.replace(/\s+/g, ' ')
  }

  it('ledger rows and each import\'s kept rows are visible to members of that app only', () => {
    for (const name of ['spend_ledger_entries_member_select', 'spend_bill_import_rows_member_select']) {
      const p = latestPolicy(name)
      expect(p).toContain('private.is_project_member(project_id)')
      expect(p).not.toContain('is_org_member')
    }
  })

  it('a one-app import follows that app; an app-column import follows the team', () => {
    expect(latestPolicy('spend_bill_imports_member_select')).toContain(
      'when project_id is null then (select private.is_org_member(organization_id)) else (select private.is_project_member(project_id)) end',
    )
  })
})

describe('imports listed under the ledger', () => {
  it('lists imports for the caller\'s apps and app-column imports, never another app\'s', async () => {
    const P3 = '1000000c-0000-4000-8000-000000000000'
    const imp = (id: string, projectId: string | null, at: string) => ({ id, organization_id: ORG, project_id: projectId, vendor: 'aws', filename: `${id}.csv`, format: 'generic', rows_read: 1, rows_imported: 1, rows_skipped: 0, total_usd: 1, period_start: null, period_end: null, created_at: at })
    const db = seedLedger({
      spend_bill_imports: [
        imp('mine', P1, '2026-10-01T00:00:00Z'),
        imp('hidden', P3, '2026-10-02T00:00:00Z'),
        imp('team', null, '2026-10-03T00:00:00Z'),
      ],
    })
    const r = await ledger.buildSpendLedger(db as never, { organizationId: ORG, projects: [{ id: P1, name: 'glot.it' }], now: NOW })
    expect(r.imports.map((i) => i.id)).toEqual(['team', 'mine'])
  })
})
