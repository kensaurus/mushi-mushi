/**
 * FILE: story-map-kickoff.test.ts
 * PURPOSE: map-from-live returns 202, and a failed story-mapper invoke
 *          marks the still-pending run failed instead of leaving it pending.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { log } from '../../supabase/functions/_shared/logger.ts'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '10000001-0000-4000-8000-000000000000'

let db: FakeDb
const jobs: Promise<unknown>[] = []

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/entitlements.ts', () => ({
  requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: () => {}, reportMessage: () => {} }))

type Handler = (c: Ctx, next?: () => Promise<void>) => Promise<unknown> | unknown
interface Res { body: { ok: boolean; data?: { runId: string; status: string } }; status: number }
interface Ctx {
  req: {
    param: (k: string) => string | undefined
    query: (k: string) => string | undefined
    header: (k: string) => string | undefined
    json: () => Promise<unknown>
    path: string
    method: string
  }
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
  async call(method: string, url: string, body?: unknown): Promise<Res> {
    const [path, qs] = url.split('?')
    const route = this.routes.find((r) => r.method === method && r.pattern.test(path!))
    if (!route) throw new Error(`no route ${method} ${url}`)
    const m = route.pattern.exec(path!)!
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? '')]))
    const query = new URLSearchParams(qs ?? '')
    const vars: Record<string, unknown> = { userId: 'user-a', authMethod: 'jwt' }
    const c: Ctx = {
      req: {
        param: (k) => params[k],
        query: (k) => query.get(k) ?? undefined,
        header: () => undefined,
        json: async () => body ?? {},
        path: path!,
        method,
      },
      get: (k) => vars[k],
      set: (k, v) => { vars[k] = v },
      json: (payload, status = 200) => ({ body: payload as Res['body'], status }),
    }
    let result: unknown
    const run = async (i: number): Promise<void> => {
      const handler = route.handlers[i]
      if (!handler) return
      if (i === route.handlers.length - 1) { result = await handler(c); return }
      const short = await handler(c, () => run(i + 1))
      if (result === undefined && short !== undefined) result = short
    }
    await run(0)
    return result as Res
  }
}

let app: FakeApp

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno = {
    env: {
      get: (name: string) => {
        if (name === 'SUPABASE_URL') return 'https://example.supabase.co'
        if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-service-key'
        return undefined
      },
    },
  }
  const { registerInventoryRoutes } = await import('../../supabase/functions/api/routes/inventory.ts')
  app = new FakeApp()
  registerInventoryRoutes(app as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime
  jobs.length = 0
})

afterAll(() => {
  delete (globalThis as { Deno?: unknown }).Deno
})

function seed(): void {
  db = makeFakeDb({
    projects: [{ id: P, owner_id: 'user-a', organization_id: null }],
    organization_members: [],
    project_members: [],
    project_settings: [],
    story_map_runs: [],
  }, { autoId: true })
}

function armBackground(): void {
  ;(globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime = {
    waitUntil: (p) => { jobs.push(p) },
  }
}

async function post(fetchImpl: () => Promise<Response>): Promise<Res> {
  seed()
  armBackground()
  vi.stubGlobal('fetch', vi.fn(fetchImpl))
  return app.call('POST', `/v1/admin/inventory/${P}/map-from-live`, { base_url: 'https://example.com' })
}

describe('map-from-live invoke', () => {
  it('marks the run failed when the invoke rejects', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const res = await post(async () => { throw new Error('network down') })
    expect(res.status).toBe(202)
    expect(res.body.data?.status).toBe('accepted')
    await Promise.all(jobs)
    const row = db.tables.story_map_runs[0]
    expect(row?.status).toBe('failed')
    expect(row?.error_message).toBe('network down')
    expect(typeof row?.finished_at).toBe('string')
    expect(warn.mock.calls.some((c) => c[0] === 'story-mapper invoke failed')).toBe(true)
    warn.mockRestore()
  })

  it('marks the run failed when the invoke returns non-2xx', async () => {
    const res = await post(async () => new Response('gateway timeout', { status: 504 }))
    expect(res.status).toBe(202)
    await Promise.all(jobs)
    expect(db.tables.story_map_runs[0]).toMatchObject({
      status: 'failed',
      error_message: 'story-mapper invoke HTTP 504',
    })
  })

  it('leaves the run pending when story-mapper accepts', async () => {
    const res = await post(async () => new Response('{}', { status: 202 }))
    expect(res.status).toBe(202)
    await Promise.all(jobs)
    expect(db.tables.story_map_runs[0]?.status).toBe('pending')
  })
})
