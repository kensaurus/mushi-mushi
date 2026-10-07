/**
 * FILE: project-groups.test.ts
 * PURPOSE: Plan 021 project groups, driven through the real handlers on an
 *          in-memory database: members read, only owners/admins write, a
 *          project from another organization (or hidden from the caller) is
 *          refused, removing members never drops a project the caller cannot
 *          see, and the portfolio's ?group= filter narrows to one group.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const ORG = '0a000000-0000-4000-8000-000000000000'
const P1 = '1a000000-0000-4000-8000-000000000000'
const P2 = '1b000000-0000-4000-8000-000000000000'
const HIDDEN = '1c000000-0000-4000-8000-000000000000'
const FOREIGN = '1d000000-0000-4000-8000-000000000000'

const state = vi.hoisted(() => ({ db: null as unknown, user: 'owner-1', visible: [] as string[] }))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/api/routes/portfolio.ts', () => ({
  portfolioAccess: async () => ({ ok: true, orgId: ORG, orgName: 'Acme', projectIds: state.visible }),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) =>
    c.json({ ok: false, error: { code, message } }, status),
}))

let routes: typeof import('../../supabase/functions/api/routes/project-groups.ts')
let shared: typeof import('../../supabase/functions/_shared/project-groups.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/project-groups.ts')
  shared = await import('../../supabase/functions/_shared/project-groups.ts')
})

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
type Handler = (c: unknown) => Promise<unknown>

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  private add(method: string) {
    return (path: string, ...handlers: Handler[]) => this.routes.push({ method, path, handler: handlers[handlers.length - 1] })
  }
  get = this.add('GET')
  post = this.add('POST')
  patch = this.add('PATCH')
  put = this.add('PUT')
  delete = this.add('DELETE')
  async call(method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: state.user, authMethod: 'jwt' }
    const c = {
      req: { json: async () => body, param: (k: string) => params[k], query: () => undefined },
      get: (k: string) => vars[k],
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

const BASE = '/v1/admin/orgs/:orgId/project-groups'

function setup(): { db: FakeDb; app: FakeApp } {
  const db = makeFakeDb(
    {
      organization_members: [
        { organization_id: ORG, user_id: 'owner-1', role: 'owner' },
        { organization_id: ORG, user_id: 'viewer-1', role: 'viewer' },
      ],
      project_groups: [],
      project_group_members: [],
    },
    { autoId: true, uniques: { project_groups: ['organization_id', 'slug'] } },
  )
  state.db = db
  state.user = 'owner-1'
  state.visible = [P1, P2]
  const app = new FakeApp()
  routes.registerProjectGroupRoutes(app as never)
  return { db, app }
}

describe('project groups', () => {
  it('lets an owner create a group with a slug, and refuses a duplicate name', async () => {
    const { db, app } = setup()
    const res = await app.call('POST', BASE, { orgId: ORG }, { name: 'Kensaurus apps', color: 'brand' })
    expect(res.status).toBe(201)
    expect(db.table('project_groups')[0]).toMatchObject({ organization_id: ORG, slug: 'kensaurus-apps', color: 'brand' })
    const again = await app.call('POST', BASE, { orgId: ORG }, { name: 'Kensaurus  Apps!' })
    expect(again.status).toBe(409)
  })

  it('refuses writes from a viewer', async () => {
    const { db, app } = setup()
    state.user = 'viewer-1'
    const res = await app.call('POST', BASE, { orgId: ORG }, { name: 'Mine' })
    expect(res.status).toBe(403)
    expect(db.table('project_groups')).toHaveLength(0)
  })

  it('adds visible projects, refuses foreign ones, and never removes a project hidden from the caller', async () => {
    const { db, app } = setup()
    const created = await app.call('POST', BASE, { orgId: ORG }, { name: 'Apps' })
    const gid = (created.body.data?.group as { id: string }).id
    db.table('project_group_members').push({ group_id: gid, project_id: HIDDEN, organization_id: ORG })

    const foreign = await app.call('PUT', `${BASE}/:gid/projects`, { orgId: ORG, gid }, { project_ids: [P1, FOREIGN] })
    expect(foreign.status).toBe(400)

    const ok = await app.call('PUT', `${BASE}/:gid/projects`, { orgId: ORG, gid }, { project_ids: [P1, P2] })
    expect(ok.status).toBe(200)
    expect(db.table('project_group_members').map((m) => m.project_id).sort()).toEqual([P1, P2, HIDDEN].sort())

    const listed = await app.call('GET', BASE, { orgId: ORG })
    const groups = listed.body.data?.groups as Array<{ project_ids: string[] }>
    expect(groups[0].project_ids.sort()).toEqual([P1, P2].sort())

    const narrowed = await shared.filterToGroup(db as never, ORG, [P1, P2], 'apps')
    expect(narrowed).toEqual({ ok: true, projectIds: [P1, P2] })
    const missing = await shared.filterToGroup(db as never, ORG, [P1, P2], 'nope')
    expect(missing).toEqual({ ok: false, error: 'not_found' })
  })

  it('slugs names safely', () => {
    expect(routes.groupSlug('Client work — 2026')).toBe('client-work-2026')
    expect(routes.groupSlug('!!!')).toBe('group')
  })
})
