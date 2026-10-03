/**
 * Store reviews become reports (gap #23): `_shared/store-review-intake.ts`
 * and `api/routes/store-review-intake.ts`.
 *
 *   - off by default; per project opt-in;
 *   - reads App Store and Google Play reviews through the project's bound
 *     store connectors (Vault keys), with no network in this suite;
 *   - each review is filed at most once (store_review_items);
 *   - only reviews at or under the threshold (default 2 stars) and at most
 *     30 days old become reports, with source 'store_review';
 *   - a store error is that store's line, never a silent "no reviews".
 */
import { generateKeyPairSync } from 'node:crypto'
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

let intake: typeof import('../../supabase/functions/_shared/store-review-intake.ts')
let routes: typeof import('../../supabase/functions/api/routes/store-review-intake.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  intake = await import('../../supabase/functions/_shared/store-review-intake.ts')
  routes = await import('../../supabase/functions/api/routes/store-review-intake.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const APPLE_ID = '6761582648'
const PKG = 'com.example.glot'
const NOW = new Date('2026-10-03T12:00:00Z')
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const SECRETS: Record<string, string> = {
  asc: JSON.stringify({ keyId: 'ABC123', issuerId: 'iss', privateKey: ec }),
  play: JSON.stringify({ client_email: 'mushi@example.iam.gserviceaccount.com', private_key: rsa }),
}

const ascReview = (id: string, rating: number, createdDate = '2026-10-02T08:00:00Z') => ({
  type: 'customerReviews', id, attributes: { rating, title: `Title ${id}`, body: `It crashes on launch (${id})`, reviewerNickname: 'Real Person', createdDate, territory: 'JPN' },
})

function seed(over: Record<string, unknown[]> = {}, settings: Record<string, unknown> = {}): FakeDb {
  return makeFakeDb({
    organizations: [{ id: ORG, name: 'A' }],
    projects: [{ id: P1, name: 'glot.it', owner_id: 'owner', organization_id: ORG }],
    organization_members: [{ organization_id: ORG, user_id: 'owner', role: 'owner' }],
    project_members: [],
    project_settings: [{ project_id: P1, store_review_intake_enabled: true, store_review_max_rating: 2, ...settings }],
    connector_instances: [
      { id: 'asc1', organization_id: ORG, kind: 'app_store_connect', project_id: null, read_credential_ref: 'vault://asc', config: {} },
      { id: 'play1', organization_id: ORG, kind: 'play_console', project_id: P1, read_credential_ref: 'vault://play', config: { package: PKG } },
    ],
    connector_bindings: [{ connector_instance_id: 'asc1', project_id: P1, external_id: APPLE_ID, role: 'ios' }],
    store_review_items: [],
    reports: [],
    ...over,
  } as never, {
    uniques: { store_review_items: ['project_id', 'store', 'review_id'] },
    rpc: (fn, args) => (fn === 'vault_get_secret' ? SECRETS[String(args.secret_id)] ?? null : null),
  })
}

interface Route { status: number; body: unknown }

function fakeStores(opts: { asc?: Route; play?: Route } = {}) {
  const calls: string[] = []
  const fetch = async (url: string): Promise<Response> => {
    calls.push(url)
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'ya29.token' })
    if (url.includes(`/v1/apps/${APPLE_ID}/customerReviews`)) {
      const r = opts.asc ?? { status: 200, body: { data: [ascReview('r1', 1), ascReview('r2', 2), ascReview('r5', 5), ascReview('old', 1, '2026-07-01T00:00:00Z')] } }
      return Response.json(r.body, { status: r.status })
    }
    if (url.includes(`/applications/${PKG}/reviews`)) {
      const r = opts.play ?? {
        status: 200,
        body: { reviews: [{ reviewId: 'gp1', authorName: 'Someone', comments: [{ userComment: { text: 'Login loops forever', starRating: 1, lastModified: { seconds: String(Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000)) }, appVersionName: '2.3.1', device: 'Pixel 8', reviewerLanguage: 'en' } }, { developerComment: { text: 'Sorry!' } }] }] },
      }
      return Response.json(r.body, { status: r.status })
    }
    return new Response('not found', { status: 404 })
  }
  return { fetch, calls }
}

function deps(f = fakeStores()) {
  const classify = vi.fn()
  return { deps: { fetch: f.fetch, now: () => NOW, classify }, classify, calls: f.calls }
}

describe('parsers', () => {
  it('reads App Store reviews without the reviewer name', () => {
    const r = intake.parseAppStoreReviews({ data: [ascReview('r1', 1), { id: '', attributes: {} }] })
    expect(r).toEqual([{ store: 'app_store', reviewId: 'r1', rating: 1, title: 'Title r1', body: 'It crashes on launch (r1)', territory: 'JPN', language: null, appVersion: null, device: null, createdAt: '2026-10-02T08:00:00Z' }])
    expect(JSON.stringify(r)).not.toContain('Real Person')
  })

  it('reads the user comment of a Play review, never the developer reply', () => {
    const r = intake.parsePlayReviews({ reviews: [{ reviewId: 'gp1', comments: [{ developerComment: { text: 'reply' } }, { userComment: { text: 'Broken', starRating: 2, lastModified: { seconds: '1790000000' }, appVersionName: '1.0' } }] }, { reviewId: 'gp2', comments: [] }] })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ store: 'play', reviewId: 'gp1', rating: 2, body: 'Broken', appVersion: '1.0', createdAt: new Date(1790000000 * 1000).toISOString() })
  })
})

describe('shouldFile and the report row', () => {
  const review = { store: 'app_store' as const, reviewId: 'r1', rating: 1, title: 'Crash', body: 'Crashes', territory: 'JPN', language: null, appVersion: null, device: null, createdAt: '2026-10-02T00:00:00Z' }
  it('files at or under the threshold, recent, with text', () => {
    expect(intake.shouldFile(review, 2, NOW)).toBe(true)
    expect(intake.shouldFile({ ...review, rating: 3 }, 2, NOW)).toBe(false)
    expect(intake.shouldFile({ ...review, rating: 5 }, 5, NOW)).toBe(true)
    expect(intake.shouldFile({ ...review, createdAt: '2026-08-01T00:00:00Z' }, 2, NOW)).toBe(false)
    expect(intake.shouldFile({ ...review, title: '', body: '' }, 2, NOW)).toBe(false)
    expect(intake.shouldFile({ ...review, rating: null }, 5, NOW)).toBe(false)
  })

  it('is a store_review report with a severity from the stars', () => {
    const row = intake.buildStoreReviewReport(P1, review, NOW)
    expect(row).toMatchObject({ project_id: P1, source: 'store_review', severity: 'high', status: 'new', category: 'other', user_category: 'store_review', title: '1-star App Store review: Crash' })
    expect(row.description).toBe('Crash\n\nCrashes\n\n(1-star App Store review, JPN, 2026-10-02)')
    expect(row.custom_metadata).toMatchObject({ store: 'app_store', reviewId: 'r1', rating: 1 })
    expect(intake.reviewSeverity(2)).toBe('medium')
    expect(intake.reviewSeverity(4)).toBe('low')
  })
})

describe('runStoreReviewIntake', () => {
  it('files new low-star reviews from both stores once, and remembers every review it saw', async () => {
    const db = seed()
    const { deps: d, classify } = deps()
    const r = await intake.runStoreReviewIntake(db as never, P1, d)
    expect(r.status).toBe('ok')
    expect(r.filed).toBe(3)
    expect(r.stores.map((s) => [s.store, s.fetched, s.newReviews, s.filed])).toEqual([['app_store', 4, 4, 2], ['play', 1, 1, 1]])
    const reports = db.table('reports')
    expect(reports.map((x) => x.source)).toEqual(['store_review', 'store_review', 'store_review'])
    expect(reports.map((x) => (x.custom_metadata as { reviewId: string }).reviewId).sort()).toEqual(['gp1', 'r1', 'r2'])
    const items = db.table('store_review_items')
    expect(items).toHaveLength(5)
    expect(items.find((i) => i.review_id === 'r5')).toMatchObject({ rating: 5 })
    expect(items.find((i) => i.review_id === 'r5')?.report_id).toBeUndefined()
    expect(items.find((i) => i.review_id === 'old')?.report_id).toBeUndefined()
    expect(items.find((i) => i.review_id === 'r1')?.report_id).toBe(reports.find((x) => (x.custom_metadata as { reviewId: string }).reviewId === 'r1')?.id)
    expect(classify).toHaveBeenCalledTimes(3)
    expect(db.table('project_settings')[0]).toMatchObject({ store_review_last_status: 'ok', store_review_last_error: null })

    const again = await intake.runStoreReviewIntake(db as never, P1, deps().deps)
    expect(again.filed).toBe(0)
    expect(db.table('reports')).toHaveLength(3)
  })

  it('does nothing when the project has not switched it on', async () => {
    const db = seed({}, { store_review_intake_enabled: false })
    const { deps: d, calls } = deps()
    expect((await intake.runStoreReviewIntake(db as never, P1, d)).status).toBe('disabled')
    expect(calls).toHaveLength(0)
  })

  it('says not connected when no store is bound to the app', async () => {
    const db = seed({ connector_instances: [], connector_bindings: [] })
    const r = await intake.runStoreReviewIntake(db as never, P1, deps().deps)
    expect(r.status).toBe('not_connected')
    expect(db.table('project_settings')[0]).toMatchObject({ store_review_last_status: 'not_connected' })
  })

  it('a store that refuses the key is that store\'s error line; the other store still files', async () => {
    const db = seed()
    const r = await intake.runStoreReviewIntake(db as never, P1, deps(fakeStores({ asc: { status: 401, body: {} } })).deps)
    expect(r.status).toBe('partial')
    expect(r.stores[0]).toMatchObject({ store: 'app_store', status: 'error' })
    expect(r.stores[0].detail).toMatch(/rejected the credential/)
    expect(r.filed).toBe(1)
    expect(String(db.table('project_settings')[0].store_review_last_error)).toMatch(/App Store 6761582648/)
  })

  it('files at most 25 per store per run and leaves the rest for the next run', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ascReview(`m${i}`, 1))
    const db = seed({ connector_instances: [{ id: 'asc1', organization_id: ORG, kind: 'app_store_connect', project_id: null, read_credential_ref: 'vault://asc', config: {} }] })
    const f = fakeStores({ asc: { status: 200, body: { data: many } } })
    const first = await intake.runStoreReviewIntake(db as never, P1, deps(f).deps)
    expect(first.filed).toBe(intake.MAX_FILED_PER_STORE_RUN)
    expect(db.table('store_review_items')).toHaveLength(25)
    const second = await intake.runStoreReviewIntake(db as never, P1, deps(f).deps)
    expect(second.filed).toBe(5)
  })

  it('releases the claim when the report cannot be created, so the next run retries', async () => {
    const db = seed({ connector_instances: [{ id: 'asc1', organization_id: ORG, kind: 'app_store_connect', project_id: null, read_credential_ref: 'vault://asc', config: {} }] })
    const failing = new Proxy(db, {
      get: (t, prop, r) => (prop === 'from'
        ? (name: string) => (name === 'reports' ? { insert: async () => ({ error: { message: 'check violation' } }) } : t.from(name))
        : Reflect.get(t, prop, r)),
    })
    const r = await intake.runStoreReviewIntake(failing as never, P1, deps(fakeStores({ asc: { status: 200, body: { data: [ascReview('r1', 1)] } } })).deps)
    expect(r.status).toBe('failed')
    expect(db.table('store_review_items')).toHaveLength(0)
  })

  it('ignores a Play package configured on an instance that belongs to another app', async () => {
    const db = seed({
      connector_instances: [{ id: 'play1', organization_id: ORG, kind: 'play_console', project_id: '2000000a-0000-4000-8000-000000000000', read_credential_ref: 'vault://play', config: { package: PKG } }],
      connector_bindings: [{ connector_instance_id: 'play1', project_id: P1, external_id: 'not a package', role: 'android' }],
    })
    const sources = await intake.loadStoreSources(db as never, P1, { fetch: fakeStores().fetch, now: () => NOW })
    expect(sources).toEqual([])
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
interface Res { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }

class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(p: string, ...h: Handler[]) { this.add('GET', p, h) }
  put(p: string, ...h: Handler[]) { this.add('PUT', p, h) }
  post(p: string, ...h: Handler[]) { this.add('POST', p, h) }
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
  routes.registerStoreReviewIntakeRoutes(app as never, { getServiceClient: () => db as never, adminOrApiKeyRead: pass, adminOrApiKeyWrite: pass, jwtAuth: pass, intake: deps().deps })
  return app
}

describe('store review routes', () => {
  it('is off by default and shows the bound stores', async () => {
    const db = seed({}, { store_review_intake_enabled: false, store_review_max_rating: 2 })
    const res = await harness(db).call('GET', `/v1/admin/projects/${P1}/store/reviews`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      settings: { enabled: false, maxRating: 2, lastPulledAt: null },
      sources: [{ store: 'app_store', appId: APPLE_ID, connected: true }, { store: 'play', appId: PKG, connected: true }],
      recent: [],
    })
  })

  it('refuses a pull while off, then switches on, pulls, and rate-limits a second pull', async () => {
    const db = seed({}, { store_review_intake_enabled: false })
    const app = harness(db)
    expect((await app.call('POST', `/v1/admin/projects/${P1}/store/reviews/pull`)).body.error?.code).toBe('INTAKE_OFF')
    const on = await app.call('PUT', `/v1/admin/projects/${P1}/store/reviews/settings`, { body: { enabled: true, maxRating: 1 } })
    expect(on.body.data).toMatchObject({ enabled: true, maxRating: 1 })
    const pull = await app.call('POST', `/v1/admin/projects/${P1}/store/reviews/pull`)
    expect(pull.status).toBe(200)
    // Threshold 1: only the 1-star App Store review and the 1-star Play review are filed.
    expect(pull.body.data).toMatchObject({ status: 'ok', filed: 2 })
    expect((await app.call('POST', `/v1/admin/projects/${P1}/store/reviews/pull`)).status).toBe(429)
  })

  it('validates the threshold and hides other teams\' projects', async () => {
    const app = harness(seed())
    expect((await app.call('PUT', `/v1/admin/projects/${P1}/store/reviews/settings`, { body: { enabled: true, maxRating: 9 } })).status).toBe(400)
    expect((await app.call('GET', '/v1/admin/projects/not-a-uuid/store/reviews')).status).toBe(404)
  })
})
