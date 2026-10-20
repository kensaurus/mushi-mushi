/**
 * FILE: byok-cursor-models-routes.test.ts
 * PURPOSE: GET /v1/admin/byok/cursor/models (BL-090). A named Cursor key uses
 *          that account; no keyId uses the key the app would use. The secret
 *          never comes back in the response.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => {
  class CursorApiError extends Error {
    status: number
    constructor(status: number, _code: string, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    db: null as unknown,
    resolve: vi.fn(async () => 'crsr_resolved' as string | null),
    list: vi.fn(async (_opts: { apiKey: string }) => [{ id: 'grok-4.7', displayName: 'Grok 4.7' }]),
    CursorApiError,
  }
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  resolveOwnedProject: async () => ({ project: { id: P1, organization_id: ORG } }),
}))
vi.mock('../../supabase/functions/_shared/agent-adapters.ts', () => ({
  resolveCursorApiKey: () => state.resolve(),
}))
vi.mock('../../supabase/functions/_shared/cursor-cloud.ts', () => ({
  listCursorModelsV1: (opts: { apiKey: string }) => state.list(opts),
  CursorApiError: state.CursorApiError,
}))

let routes: typeof import('../../supabase/functions/api/routes/byok-cursor-models.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/byok-cursor-models.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const SHARED = '2000000a-0000-4000-8000-000000000000'
const OWN = '2000000b-0000-4000-8000-000000000000'
const OPENAI = '2000000c-0000-4000-8000-000000000000'
const EMPTY = '2000000d-0000-4000-8000-000000000000'
const PATH = '/v1/admin/byok/cursor/models'

type Res = {
  status: number
  body: { ok: boolean; data?: { models: unknown[] }; error?: { code: string; message?: string } }
}
type Handler = (c: unknown) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ path: string; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) {
    this.routes.push({ path, handlers: h })
  }
  async call(query: Record<string, string> = {}): Promise<Res> {
    const route = this.routes.find((r) => r.path === PATH)
    if (!route) throw new Error('route missing')
    const c = {
      req: {
        query: (k: string) => query[k],
        param: () => undefined,
        header: () => undefined,
        json: async () => ({}),
      },
      get: (k: string) => (k === 'userId' ? 'u1' : undefined),
      set: () => {},
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

function setup(): { app: FakeApp; db: FakeDb } {
  const db = makeFakeDb(
    {
      byok_keys: [
        {
          id: SHARED,
          provider_slug: 'cursor',
          project_id: null,
          organization_id: ORG,
          vault_secret_id: 'vault-shared',
        },
        {
          id: OWN,
          provider_slug: 'cursor',
          project_id: P1,
          organization_id: null,
          vault_secret_id: 'vault-own',
        },
        {
          id: OPENAI,
          provider_slug: 'openai',
          project_id: P1,
          organization_id: null,
          vault_secret_id: 'vault-openai',
        },
        {
          id: EMPTY,
          provider_slug: 'cursor',
          project_id: P1,
          organization_id: null,
          vault_secret_id: null,
        },
      ],
    },
    {
      rpc: (fn, args) => {
        if (fn !== 'vault_get_secret') return null
        if (args.secret_id === 'vault-shared') return 'crsr_shared'
        if (args.secret_id === 'vault-own') return 'crsr_own'
        return null
      },
    },
  )
  state.db = db
  state.resolve.mockReset()
  state.resolve.mockResolvedValue('crsr_resolved')
  state.list.mockClear()
  const app = new FakeApp()
  routes.registerByokCursorModelsRoutes(app as never)
  return { app, db }
}

describe('GET /v1/admin/byok/cursor/models', () => {
  it('lists models for the named Cursor key, not the key the app would otherwise use', async () => {
    const { app } = setup()
    const res = await app.call({ keyId: SHARED })
    expect(res.status).toBe(200)
    expect(res.body.data?.models).toEqual([{ id: 'grok-4.7', displayName: 'Grok 4.7' }])
    expect(state.list).toHaveBeenCalledWith({ apiKey: 'crsr_shared' })
    expect(JSON.stringify(res.body)).not.toContain('crsr_')
  })

  it('with no keyId, uses the key the app would use (Integrations, including a legacy key)', async () => {
    const { app } = setup()
    expect((await app.call()).status).toBe(200)
    expect(state.list).toHaveBeenCalledWith({ apiKey: 'crsr_resolved' })
    state.resolve.mockResolvedValue(null)
    const missing = await app.call()
    expect(missing.status).toBe(400)
    expect(missing.body.error?.code).toBe('NO_CURSOR_KEY')
  })

  it('refuses a bad id, a non-Cursor key, a key with no secret, and a key this app cannot use', async () => {
    const { app } = setup()
    expect((await app.call({ keyId: 'nope' })).body.error?.code).toBe('INVALID_KEY_ID')
    expect((await app.call({ keyId: OPENAI })).body.error?.code).toBe('NOT_CURSOR_KEY')
    expect((await app.call({ keyId: EMPTY })).body.error?.code).toBe('NO_CURSOR_KEY')
    expect((await app.call({ keyId: '2000000e-0000-4000-8000-000000000000' })).status).toBe(404)
  })

  it('reports a Cursor failure without calling it success', async () => {
    const { app } = setup()
    state.list.mockRejectedValue(new state.CursorApiError(401, 'unauthorized', 'bad key'))
    const res = await app.call({ keyId: OWN })
    expect(res.status).toBe(502)
    expect(res.body.error?.code).toBe('CURSOR_MODELS_FAILED')
    expect(res.body.error?.message).toContain('401')
  })
})
