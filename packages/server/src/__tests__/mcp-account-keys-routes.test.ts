/**
 * Account keys have no project, so no project's Keys page lists them (ADR
 * 0026). GET /v1/admin/mcp/account-keys lists the signed-in user's own active
 * account keys — all-projects or limited, with the limited projects' names —
 * and DELETE revokes one. Nobody else's key is listed or revocable.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let routes: typeof import('../../supabase/functions/api/routes/mcp-admin.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  routes = await import('../../supabase/functions/api/routes/mcp-admin.ts')
})

const ME = 'me'
const P_MINE = '1000000a-0000-4000-8000-000000000000'
const P_GONE = '1000000e-0000-4000-8000-000000000000'
const K_ALL = '4000000a-0000-4000-8000-000000000000'
const K_LIMITED = '4000000b-0000-4000-8000-000000000000'
const K_OTHERS = '4000000c-0000-4000-8000-000000000000'
const K_PROJECT = '4000000d-0000-4000-8000-000000000000'

function seed(): FakeDb {
  const key = (over: Record<string, unknown>) => ({
    key_prefix: 'mushi_abcdef', label: 'mcp-oauth-account', scopes: ['mcp:read'], is_active: true,
    is_org_scoped: true, allowed_project_ids: null, created_at: '2026-10-12T00:00:00Z', last_seen_at: null, ...over,
  })
  return makeFakeDb({
    projects: [{ id: P_MINE, name: 'glot.it', owner_id: ME, organization_id: null }],
    organization_members: [],
    project_members: [],
    project_api_keys: [
      key({ id: K_ALL, owner_user_id: ME }),
      // P_GONE: the user lost access since — its name must not leak.
      key({ id: K_LIMITED, owner_user_id: ME, label: 'mcp-oauth-selected', allowed_project_ids: [P_MINE, P_GONE] }),
      key({ id: K_OTHERS, owner_user_id: 'someone-else' }),
      key({ id: K_PROJECT, owner_user_id: ME, is_org_scoped: false, project_id: P_MINE }),
    ],
  })
}

type Handler = (c: unknown, next?: () => Promise<void>) => unknown
class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(p: string, ...h: Handler[]) { this.add('GET', p, h) }
  post(p: string, ...h: Handler[]) { this.add('POST', p, h) }
  put(p: string, ...h: Handler[]) { this.add('PUT', p, h) }
  patch(p: string, ...h: Handler[]) { this.add('PATCH', p, h) }
  delete(p: string, ...h: Handler[]) { this.add('DELETE', p, h) }
  async call(method: string, url: string, headers: Record<string, string> = {}) {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: ME, authMethod: 'jwt' }
      const c = {
        req: { param: (k: string) => params[k], query: () => undefined, header: (k: string) => headers[k.toLowerCase()], json: async () => ({}) },
        get: (k: string) => vars[k],
        set: (k: string, v: unknown) => { vars[k] = v },
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      return (await r.handlers[r.handlers.length - 1](c)) as { status: number; body: { ok: boolean; data?: { keys: Array<Record<string, unknown>> }; error?: { code: string } } }
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

function app() {
  const a = new FakeApp()
  routes.registerMcpAdminRoutes(a as never)
  return a
}

describe('GET /v1/admin/mcp/account-keys', () => {
  it('lists only my active account keys, naming the projects a limited key still reaches', async () => {
    state.db = seed()
    const res = await app().call('GET', '/v1/admin/mcp/account-keys')
    expect(res.status).toBe(200)
    const keys = res.body.data!.keys
    expect(keys.map((k) => k.id).sort()).toEqual([K_ALL, K_LIMITED].sort())
    expect(keys.find((k) => k.id === K_ALL)).toMatchObject({ all_projects: true, projects: [] })
    expect(keys.find((k) => k.id === K_LIMITED)).toMatchObject({ all_projects: false, projects: [{ id: P_MINE, name: 'glot.it' }] })
  })
})

describe('GET /v1/admin/mcp/account-keys across teams', () => {
  it('names a limited key\'s projects in every team, whichever team the console has selected', async () => {
    state.db = seed()
    const db = state.db as FakeDb
    const ORG_A = '5000000a-0000-4000-8000-000000000000'
    const ORG_B = '5000000b-0000-4000-8000-000000000000'
    const P_TEAM_B = '1000000b-0000-4000-8000-000000000000'
    db.table('organization_members').push({ organization_id: ORG_A, user_id: ME, role: 'owner' }, { organization_id: ORG_B, user_id: ME, role: 'member' })
    db.table('projects').push({ id: P_TEAM_B, name: 'yen-yen', owner_id: 'someone-else', organization_id: ORG_B })
    db.table('project_api_keys').find((k) => k.id === K_LIMITED)!.allowed_project_ids = [P_MINE, P_TEAM_B]
    const res = await app().call('GET', '/v1/admin/mcp/account-keys', { 'x-mushi-org-id': ORG_A })
    expect(res.body.data!.keys.find((k) => k.id === K_LIMITED)!.projects).toEqual([
      { id: P_MINE, name: 'glot.it' },
      { id: P_TEAM_B, name: 'yen-yen' },
    ])
  })
})

describe('DELETE /v1/admin/mcp/account-keys/:keyId', () => {
  it('revokes my account key', async () => {
    state.db = seed()
    const res = await app().call('DELETE', `/v1/admin/mcp/account-keys/${K_LIMITED}`)
    expect(res.status).toBe(200)
    const row = (state.db as FakeDb).table('project_api_keys').find((k) => k.id === K_LIMITED)!
    expect(row.is_active).toBe(false)
    expect(typeof row.revoked_at).toBe('string')
  })

  it('cannot revoke someone else\'s key, a project key, or a bad id', async () => {
    state.db = seed()
    for (const id of [K_OTHERS, K_PROJECT, 'nope']) {
      const res = await app().call('DELETE', `/v1/admin/mcp/account-keys/${id}`)
      expect(res.status, id).toBe(404)
    }
    expect((state.db as FakeDb).table('project_api_keys').every((k) => k.is_active === true)).toBe(true)
  })
})
