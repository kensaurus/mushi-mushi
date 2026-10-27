/**
 * `api` went over its upload budget again after the 2026-10-26 pipeline and
 * bug-fix batch, so the tester-marketplace group moved to `api-ext`. Its
 * paths are forwarded with wildcards where no other `api` route shares the
 * prefix, and exactly under /v1/tester/* where community.ts serves others.
 *
 * These tests read the forward list from api/index.ts, send real requests
 * through `proxyToFunction` into an api-ext app that registers the group,
 * and check every route the group registers is forwarded and nothing else
 * under /v1/tester/* is.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { proxyToFunction } from '../../supabase/functions/_shared/edge-proxy.ts'

let db: FakeDb
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'user-1')
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})

const fnSrc = (rel: string) => readFileSync(resolve(__dirname, '../../supabase/functions', rel), 'utf8')
const apiIndex = fnSrc('api/index.ts')
const extIndex = fnSrc('api-ext/index.ts')

/** The forwardToApiExt([...]) list that follows the tester-marketplace comment in api/index.ts. */
function testerForwardPatterns(): string[] {
  const start = apiIndex.indexOf('// tester-marketplace.ts (')
  expect(start, 'api/index.ts forwards the tester-marketplace group').toBeGreaterThan(-1)
  const block = apiIndex.slice(apiIndex.indexOf('forwardToApiExt([', start), apiIndex.indexOf(']);', start))
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** method + path of every route a route file registers. */
function routesOf(file: string): Array<{ method: string; path: string }> {
  return [...fnSrc(`api/routes/${file}.ts`).matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)]
    .map((m) => ({ method: m[1].toUpperCase(), path: m[2] }))
}

const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, 'x1')

/** An `api` app with only the forwards, and the `api-ext` app they reach. */
let api: Hono
let extHits: Array<{ path: string; forwardedBy: string | null }>

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerTesterMarketplaceRoutes } = await import('../../supabase/functions/api/routes/tester-marketplace.ts')
  const ext = new Hono().basePath('/api-ext')
  ext.use('*', async (c, next) => {
    extHits.push({ path: c.req.path, forwardedBy: c.req.header('x-mushi-forwarded-by') ?? null })
    await next()
  })
  registerTesterMarketplaceRoutes(ext as never)

  api = new Hono().basePath('/api')
  for (const p of testerForwardPatterns()) {
    api.all(p, (c) =>
      proxyToFunction(c.req.raw, 'api-ext', c.req.path.replace(/^\/api(?=\/)/, ''), {
        supabaseUrl: 'https://sb.test',
        // Supabase routes /functions/v1/<fn>/… to the function as /<fn>/…
        fetchImpl: ((url: string, init: RequestInit) =>
          ext.fetch(new Request(String(url).replace('https://sb.test/functions/v1', 'https://sb.test'), init))) as typeof fetch,
      }),
    )
  }
})

beforeEach(() => {
  extHits = []
  db = makeFakeDb({
    tester_leaderboard_30d_public: [{ public_handle: 'ana', points_30d: 120 }],
    mushi_testers: [],
  })
})

describe('tester-marketplace runs in api-ext', () => {
  it('api no longer registers the group; api-ext does', () => {
    expect(apiIndex).not.toContain('registerTesterMarketplaceRoutes(app)')
    expect(extIndex).toContain('registerTesterMarketplaceRoutes(app)')
  })

  it('a public route answers through the forward', async () => {
    const res = await api.request('/api/v1/public/marketplace/leaderboard')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ public_handle: 'ana', points_30d: 120 }])
    expect(extHits).toEqual([{ path: '/api-ext/v1/public/marketplace/leaderboard', forwardedBy: 'api' }])
  })

  it('a signed-in route answers through the forward', async () => {
    const res = await api.request('/api/v1/me/tester-status', { headers: { Authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, data: { isTester: false } })
  })

  it('every route the group registers is forwarded', async () => {
    const routes = routesOf('tester-marketplace')
    expect(routes.length).toBe(31)
    const probe = new Hono().basePath('/api')
    for (const p of testerForwardPatterns()) probe.all(p, (c) => c.text('forwarded'))
    for (const r of routes) {
      const res = await probe.request(`/api${concrete(r.path)}`, { method: r.method })
      expect(await res.text(), `${r.method} ${r.path}`).toBe('forwarded')
    }
  })

  it('community.ts routes under /v1/tester/* stay on api', async () => {
    const probe = new Hono().basePath('/api')
    for (const p of testerForwardPatterns()) probe.all(p, (c) => c.text('forwarded'))
    const community = routesOf('community').filter((r) => r.path.startsWith('/v1/tester/'))
    expect(community.length).toBeGreaterThan(0)
    for (const r of community) {
      const res = await probe.request(`/api${concrete(r.path)}`, { method: r.method })
      expect(res.status, `${r.method} ${r.path}`).toBe(404)
    }
  })
})
