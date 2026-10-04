/**
 * FILE: data-governance-role.test.ts
 * PURPOSE: Retention windows, legal hold and residency pins decide what the
 *          nightly sweep deletes and where data lives. Only org owners and
 *          admins (or a project's direct owner) may change them, and the GET
 *          routes tell the console which rows the caller can manage. Drives
 *          the real handlers in api/routes/admin-ops.ts on an in-memory db.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = vi.fn()
  logger.child = () => logger
  return logger
})
const state = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/ee-gate.ts', () => ({
  requireEeLicense: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))

let routes: typeof import('../../supabase/functions/api/routes/admin-ops.ts')
let governance: typeof import('../../supabase/functions/_shared/data-governance-role.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  routes = await import('../../supabase/functions/api/routes/admin-ops.ts')
  governance = await import('../../supabase/functions/_shared/data-governance-role.ts')
})

const PROJECT = '1000000a-0000-4000-8000-000000000000'
const ORG = '5000000a-0000-4000-8000-000000000000'
const OWNER = 'user-owner'
const ADMIN = 'user-admin'
const MEMBER = 'user-member'
const VIEWER = 'user-viewer'
const STRANGER = 'user-stranger'

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({
      method,
      keys,
      handlers,
      pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)' })}$`),
    })
  }
  get(path: string, ...h: Handler[]) { this.add('GET', path, h) }
  post(path: string, ...h: Handler[]) { this.add('POST', path, h) }
  put(path: string, ...h: Handler[]) { this.add('PUT', path, h) }
  patch(path: string, ...h: Handler[]) { this.add('PATCH', path, h) }
  delete(path: string, ...h: Handler[]) { this.add('DELETE', path, h) }
  use() {}
  route() {}
  async call(method: string, url: string, opts: { user: string; body?: unknown }): Promise<Res> {
    for (const r of this.routes) {
      if (r.method !== method) continue
      const m = r.pattern.exec(url)
      if (!m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: opts.user, authMethod: 'jwt' }
      const c = {
        req: {
          param: (k: string) => params[k],
          query: () => undefined,
          header: () => undefined,
          json: async () => opts.body ?? {},
        },
        get: (k: string) => vars[k],
        set: (k: string, v: unknown) => { vars[k] = v },
        header: () => {},
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      return (await r.handlers[r.handlers.length - 1](c)) as Res
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

function setup(): { db: FakeDb; app: FakeApp } {
  const db = makeFakeDb({
    projects: [{ id: PROJECT, name: 'Glot', slug: 'glot', owner_id: OWNER, organization_id: ORG, data_residency_region: null, created_at: '2026-01-01' }],
    organization_members: [
      { organization_id: ORG, user_id: OWNER, role: 'owner' },
      { organization_id: ORG, user_id: ADMIN, role: 'admin' },
      { organization_id: ORG, user_id: MEMBER, role: 'member' },
      { organization_id: ORG, user_id: VIEWER, role: 'viewer' },
    ],
    project_members: [],
    project_retention_policies: [
      { project_id: PROJECT, reports_retention_days: 90, audit_retention_days: 730, llm_traces_retention_days: 90, byok_audit_retention_days: 365, legal_hold: true },
    ],
    audit_logs: [],
  }, { uniques: { project_retention_policies: ['project_id'] } })
  state.db = db
  const app = new FakeApp()
  routes.registerAdminOpsRoutes(app as never)
  return { db, app }
}

describe('canManageDataGovernance', () => {
  it('allows owners and admins only', () => {
    expect(governance.canManageDataGovernance('owner')).toBe(true)
    expect(governance.canManageDataGovernance('admin')).toBe(true)
    expect(governance.canManageDataGovernance('member')).toBe(false)
    expect(governance.canManageDataGovernance('viewer')).toBe(false)
    expect(governance.canManageDataGovernance(null)).toBe(false)
  })
})

describe('PUT /v1/admin/compliance/retention/:projectId', () => {
  const url = `/v1/admin/compliance/retention/${PROJECT}`
  const holdOf = (db: FakeDb) => db.table('project_retention_policies')[0]?.legal_hold

  it('lets an owner and an admin lift a legal hold', async () => {
    for (const user of [OWNER, ADMIN]) {
      const { app, db } = setup()
      const res = await app.call('PUT', url, { user, body: { legal_hold: false } })
      expect(res.status, user).toBe(200)
      expect(holdOf(db), user).toBe(false)
    }
  })

  it('refuses members and viewers with a plain reason, and changes nothing', async () => {
    for (const user of [MEMBER, VIEWER]) {
      const { app, db } = setup()
      const res = await app.call('PUT', url, { user, body: { legal_hold: false, reports_retention_days: 1 } })
      expect(res.status, user).toBe(403)
      expect(res.body.error?.message).toMatch(/owners and admins can change retention/)
      expect(holdOf(db), user).toBe(true)
    }
  })

  it('refuses a stranger', async () => {
    const { app } = setup()
    expect((await app.call('PUT', url, { user: STRANGER, body: { legal_hold: false } })).status).toBe(403)
  })
})

describe('PUT /v1/admin/residency/:projectId', () => {
  const url = `/v1/admin/residency/${PROJECT}`
  const regionOf = (db: FakeDb) => db.table('projects')[0]?.data_residency_region

  it('lets an admin pin the region', async () => {
    const { app, db } = setup()
    const res = await app.call('PUT', url, { user: ADMIN, body: { region: 'eu' } })
    expect(res.status).toBe(200)
    expect(regionOf(db)).toBe('eu')
  })

  it('refuses a member or viewer, leaving the project unpinned', async () => {
    for (const user of [MEMBER, VIEWER]) {
      const { app, db } = setup()
      const res = await app.call('PUT', url, { user, body: { region: 'eu' } })
      expect(res.status, user).toBe(403)
      expect(regionOf(db), user).toBeNull()
    }
  })
})

describe('GET routes report can_manage per row', () => {
  it('retention policies', async () => {
    const { app } = setup()
    const owner = await app.call('GET', '/v1/admin/compliance/retention', { user: OWNER })
    const viewer = await app.call('GET', '/v1/admin/compliance/retention', { user: VIEWER })
    expect((owner.body.data?.policies as Array<{ can_manage: boolean }>)[0]?.can_manage).toBe(true)
    expect((viewer.body.data?.policies as Array<{ can_manage: boolean }>)[0]?.can_manage).toBe(false)
  })

  it('residency projects', async () => {
    const { app } = setup()
    const admin = await app.call('GET', '/v1/admin/residency', { user: ADMIN })
    const member = await app.call('GET', '/v1/admin/residency', { user: MEMBER })
    expect((admin.body.data?.projects as Array<{ can_manage: boolean }>)[0]?.can_manage).toBe(true)
    expect((member.body.data?.projects as Array<{ can_manage: boolean }>)[0]?.can_manage).toBe(false)
  })
})
