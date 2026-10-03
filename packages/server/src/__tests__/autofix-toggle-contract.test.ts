/**
 * FILE: autofix-toggle-contract.test.ts
 * PURPOSE: The GET /v1/admin/projects/:id/autofix and POST .../autofix/toggle
 *          contract, driven through the real handlers (api/routes/autofix.ts)
 *          on an in-memory database: owner/admin-only toggling (in both
 *          directions, for console sessions and API keys alike), `can_toggle`
 *          for the console switch, bad-body validation, upsert semantics for
 *          legacy projects without a project_settings row, and the audit write.
 *
 *          It used to test an in-memory class it defined itself, so it passed
 *          whatever the route did (a member could turn autofix on).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = vi.fn()
  logger.child = () => logger
  return logger as { warn: ReturnType<typeof vi.fn>; child: () => unknown }
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))

let routes: typeof import('../../supabase/functions/api/routes/autofix.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  routes = await import('../../supabase/functions/api/routes/autofix.ts')
})

const PROJECT = '1000000a-0000-4000-8000-000000000000'
const OTHER = '1000000b-0000-4000-8000-000000000000'
const ORG = '5000000a-0000-4000-8000-000000000000'
const OWNER = 'user-owner'
const ADMIN = 'user-admin'
const MEMBER = 'user-member'
const VIEWER = 'user-viewer'
const STRANGER = 'user-stranger'

type Res = { status: number; body: { ok: boolean; data?: { autofix_enabled?: boolean; can_toggle?: boolean }; error?: { code: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(path: string, ...handlers: Handler[]) { this.add('GET', path, handlers) }
  post(path: string, ...handlers: Handler[]) { this.add('POST', path, handlers) }
  async call(method: string, url: string, opts: { user?: string; vars?: Record<string, unknown>; body?: unknown; rawBody?: string } = {}): Promise<Res> {
    for (const r of this.routes) {
      if (r.method !== method) continue
      const m = r.pattern.exec(url)
      if (!m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const ctxVars: Record<string, unknown> = { userId: opts.user ?? OWNER, authMethod: 'jwt', ...opts.vars }
      const c = {
        req: {
          param: (k: string) => params[k],
          query: () => undefined,
          header: () => undefined,
          json: async () => {
            if (opts.rawBody !== undefined) return JSON.parse(opts.rawBody)
            return opts.body
          },
        },
        get: (k: string) => ctxVars[k],
        set: (k: string, v: unknown) => { ctxVars[k] = v },
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      return (await r.handlers[r.handlers.length - 1](c)) as Res
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

function setup(opts: { settings?: boolean | null; logAudit?: (...args: unknown[]) => Promise<void> } = {}) {
  const db = makeFakeDb({
    projects: [
      { id: PROJECT, owner_id: OWNER, organization_id: ORG },
      { id: OTHER, owner_id: OWNER, organization_id: ORG },
    ],
    organization_members: [
      { organization_id: ORG, user_id: ADMIN, role: 'admin' },
      { organization_id: ORG, user_id: MEMBER, role: 'member' },
      { organization_id: ORG, user_id: VIEWER, role: 'viewer' },
    ],
    project_members: [],
    project_settings: opts.settings === undefined || opts.settings === null ? [] : [{ project_id: PROJECT, autofix_enabled: opts.settings }],
    audit_logs: [],
  }, { uniques: { project_settings: ['project_id'] } })
  const audits: unknown[][] = []
  const logAudit = opts.logAudit ?? (async (...args: unknown[]) => { audits.push(args) })
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  routes.registerAutofixRoutes(app as never, {
    getServiceClient: () => db as never,
    adminOrApiKeyRead: pass,
    adminOrApiKeyWrite: pass,
    logAudit: logAudit as never,
  })
  return { db, app, audits }
}

const settingOf = (db: FakeDb) => (db.table('project_settings').find((r) => r.project_id === PROJECT)?.autofix_enabled ?? null)

describe('GET /v1/admin/projects/:id/autofix', () => {
  it('returns the flag to a member, with can_toggle false', async () => {
    const { app } = setup({ settings: true })
    const res = await app.call('GET', `/v1/admin/projects/${PROJECT}/autofix`, { user: MEMBER })
    expect(res).toMatchObject({ status: 200, body: { ok: true, data: { autofix_enabled: true, can_toggle: false } } })
  })

  it('returns can_toggle true to an owner and an admin', async () => {
    const { app } = setup({ settings: false })
    for (const user of [OWNER, ADMIN]) {
      const res = await app.call('GET', `/v1/admin/projects/${PROJECT}/autofix`, { user })
      expect(res.body.data, user).toEqual({ autofix_enabled: false, can_toggle: true })
    }
  })

  it('defaults to off when no project_settings row exists', async () => {
    const { app } = setup()
    const res = await app.call('GET', `/v1/admin/projects/${PROJECT}/autofix`, { user: VIEWER })
    expect(res.body.data).toEqual({ autofix_enabled: false, can_toggle: false })
  })

  it('is a 404 for a stranger and for a key bound to another project', async () => {
    const { app } = setup({ settings: true })
    expect((await app.call('GET', `/v1/admin/projects/${PROJECT}/autofix`, { user: STRANGER })).status).toBe(404)
    const bound = await app.call('GET', `/v1/admin/projects/${PROJECT}/autofix`, { vars: { authMethod: 'apiKey', projectId: OTHER } })
    expect(bound.status).toBe(404)
  })
})

describe('POST /v1/admin/projects/:id/autofix/toggle', () => {
  const url = `/v1/admin/projects/${PROJECT}/autofix/toggle`

  it('lets an owner turn autofix on, and an admin turn it off again', async () => {
    const { app, db } = setup()
    expect((await app.call('POST', url, { user: OWNER, body: { enabled: true } })).body).toEqual({ ok: true, data: { autofix_enabled: true } })
    expect(settingOf(db)).toBe(true)
    expect((await app.call('POST', url, { user: ADMIN, body: { enabled: false } })).body).toEqual({ ok: true, data: { autofix_enabled: false } })
    expect(settingOf(db)).toBe(false)
  })

  it('refuses a member and a viewer in both directions, writing nothing', async () => {
    const { app, db, audits } = setup({ settings: false })
    for (const user of [MEMBER, VIEWER]) {
      for (const enabled of [true, false]) {
        const res = await app.call('POST', url, { user, body: { enabled } })
        expect(res.status, `${user} ${enabled}`).toBe(403)
        expect(res.body.error?.code).toBe('FORBIDDEN')
      }
    }
    expect(settingOf(db)).toBe(false)
    expect(audits).toHaveLength(0)
  })

  it('refuses a member\'s API key the same way (a key acts with its owner\'s role)', async () => {
    const { app, db } = setup({ settings: false })
    const res = await app.call('POST', url, { user: MEMBER, vars: { authMethod: 'apiKey', projectId: PROJECT }, body: { enabled: true } })
    expect(res.status).toBe(403)
    expect(settingOf(db)).toBe(false)
  })

  it('accepts an owner\'s API key and records it as via api_key', async () => {
    const { app, audits } = setup()
    const res = await app.call('POST', url, { user: OWNER, vars: { authMethod: 'apiKey', projectId: PROJECT }, body: { enabled: true } })
    expect(res.status).toBe(200)
    expect(audits).toHaveLength(1)
    expect(audits[0][3]).toBe('settings.updated')
    expect(audits[0][6]).toEqual({ action: 'autofix.toggle', enabled: true, via: 'api_key' })
  })

  it('is a 404 for a stranger and for a key bound to another project', async () => {
    const { app } = setup()
    expect((await app.call('POST', url, { user: STRANGER, body: { enabled: false } })).status).toBe(404)
    expect((await app.call('POST', url, { vars: { authMethod: 'apiKey', projectId: OTHER }, body: { enabled: true } })).status).toBe(404)
  })

  it('checks the role before the body, so a member learns nothing about its shape', async () => {
    const { app } = setup()
    expect((await app.call('POST', url, { user: MEMBER, body: {} })).status).toBe(403)
  })

  it('answers 400 for a missing, non-boolean or unparseable body, never "off"', async () => {
    const { app, db } = setup({ settings: true })
    for (const body of [{}, { enabled: 'yes' }, { enabled: 1 }, null]) {
      const res = await app.call('POST', url, { user: OWNER, body })
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error?.code).toBe('BAD_BODY')
    }
    expect((await app.call('POST', url, { user: OWNER, rawBody: '{not json' })).status).toBe(400)
    expect(settingOf(db)).toBe(true)
  })

  it('upserts for a legacy project with no project_settings row', async () => {
    const { app, db } = setup()
    expect(db.table('project_settings')).toHaveLength(0)
    await app.call('POST', url, { user: OWNER, body: { enabled: true } })
    expect(db.table('project_settings')).toEqual([{ project_id: PROJECT, autofix_enabled: true }])
  })

  it('rejects a non-uuid project id', async () => {
    const { app } = setup()
    expect((await app.call('POST', '/v1/admin/projects/not-a-uuid/autofix/toggle', { body: { enabled: true } })).status).toBe(400)
  })

  it('logs a failed audit write with the project, user and channel, and still answers 200', async () => {
    fakeLog.warn.mockClear()
    const { app, db } = setup({ logAudit: async () => { throw new Error('audit insert timed out') } })
    const res = await app.call('POST', url, { user: ADMIN, body: { enabled: true } })
    expect(res.status).toBe(200)
    expect(settingOf(db)).toBe(true)
    expect(fakeLog.warn).toHaveBeenCalledWith('autofix toggle audit write failed', expect.objectContaining({
      projectId: PROJECT, userId: ADMIN, via: 'console', err: 'audit insert timed out',
    }))
  })
})
