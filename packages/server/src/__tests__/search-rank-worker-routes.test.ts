/**
 * FILE: search-rank-worker-routes.test.ts
 * PURPOSE: The search rank check end to end on an in-memory database: saving
 *          keywords keeps the history of those that stay, the worker stores
 *          the rank and a history row and only re-checks weekly, Check now is
 *          rate-limited.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000e-0000-4000-8000-000000000000'
const USER = '2000000e-0000-4000-8000-000000000000'
const state = vi.hoisted(() => ({ role: 'owner', rateLimited: false, triggers: 0 }))
let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ withSentry: (_n: string, h: unknown) => h }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({ ...db, from: db.from.bind(db), rpc: async () => (state.rateLimited ? { error: { message: 'rate_limit_exceeded' } } : { error: null }) }),
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    await next()
  }
  return { jwtAuth: pass, requireServiceRoleAuth: () => null }
})
vi.mock('../../supabase/functions/_shared/background.ts', () => ({ runInBackground: () => void state.triggers++ }))
vi.mock('../../supabase/functions/_shared/firecrawl.ts', () => ({ resolveFirecrawl: async () => ({ key: 'fc' }) }))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  userCanAccessProject: async () => ({ allowed: true, role: state.role }),
}))

let app: Hono
let worker: typeof import('../../supabase/functions/search-rank/index.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })[k] } }
  const { registerSearchRankRoutes } = await import('../../supabase/functions/api/routes/search-rank.ts')
  app = new Hono()
  registerSearchRankRoutes(app as never)
  ;(globalThis as { Deno?: unknown }).Deno = undefined
  worker = await import('../../supabase/functions/search-rank/index.ts')
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })[k] } }
})

beforeEach(() => {
  state.role = 'owner'
  state.rateLimited = false
  state.triggers = 0
  db = makeFakeDb({ search_rank_keywords: [], search_rank_history: [], site_watches: [{ project_id: P, base_url: 'https://tsumagoi.kensaur.us' }], site_audits: [] }, { autoId: true })
})

const PATH = `/v1/admin/projects/${P}/search-ranks`
async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

const search = (urls: string[]) =>
  (async () => new Response(JSON.stringify({ success: true, data: { web: urls.map((url) => ({ url })) } }), { status: 200 })) as unknown as typeof fetch

describe('search rank', () => {
  it('saves keywords against the watched site, keeps the ones that stay, and refuses bad input', async () => {
    expect((await call('PUT', PATH, { keywords: '嬬恋 車中泊 @JP\nTsumagoi camping' })).json.data).toEqual({ keywords: 2, added: 2, removed: 0 })
    expect(db.table('search_rank_keywords').map((k) => [k.query, k.country, k.target])).toEqual([
      ['嬬恋 車中泊', 'JP', 'tsumagoi.kensaur.us'],
      ['Tsumagoi camping', 'US', 'tsumagoi.kensaur.us'],
    ])
    const keptId = db.table('search_rank_keywords')[0].id
    expect((await call('PUT', PATH, { keywords: '嬬恋 車中泊 @JP\n嬬恋 キャンプ場 @JP' })).json.data).toEqual({ keywords: 2, added: 1, removed: 1 })
    expect(db.table('search_rank_keywords').find((k) => k.query === '嬬恋 車中泊')!.id).toBe(keptId)
    expect((await call('PUT', PATH, { keywords: 'x @ZZ' })).json.error.code).toBe('VALIDATION_ERROR')
    state.role = 'viewer'
    expect((await call('PUT', PATH, { keywords: 'a b' })).status).toBe(403)
  })

  it('the worker stores rank, leading hosts and history, then waits a week', async () => {
    await call('PUT', PATH, { keywords: '嬬恋 車中泊 @JP' })
    const now = new Date('2026-10-23T04:47:00Z')
    const r1 = await worker.runSearchRanks(db as never, { now: () => now, fetch: search(['https://carstay.jp/a', 'https://tsumagoi.kensaur.us/car-stay']), resolveKey: async () => 'fc' })
    expect(r1).toEqual({ checked: 1, failed: 0 })
    expect(db.table('search_rank_keywords')[0]).toMatchObject({ last_rank: 2, last_top: ['carstay.jp', 'tsumagoi.kensaur.us'], last_error: null })
    expect(db.table('search_rank_history')).toHaveLength(1)
    const r2 = await worker.runSearchRanks(db as never, { now: () => new Date(now.getTime() + 86_400_000), fetch: search([]), resolveKey: async () => 'fc' })
    expect(r2).toEqual({ checked: 0, failed: 0 })
    const got = await call('GET', PATH)
    expect(got.json.data.keywords[0]).toMatchObject({ query: '嬬恋 車中泊', last_rank: 2, history: [{ rank: 2 }] })
    expect(got.json.data.target).toBe('tsumagoi.kensaur.us')
  })

  it('Check now starts the worker for this app and is rate-limited', async () => {
    expect((await call('POST', `${PATH}/run`)).json).toEqual({ ok: true, data: { running: true } })
    expect(state.triggers).toBe(1)
    state.rateLimited = true
    expect((await call('POST', `${PATH}/run`)).status).toBe(429)
  })
})
