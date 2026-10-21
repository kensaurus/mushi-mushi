/**
 * FILE: byok-review-followups-routes.test.ts
 * PURPOSE: The review follow-up routes (ADR 0032) through the real handlers
 *          on an in-memory database:
 *            - GET /v1/admin/byok/review-followups: settings, the keys the
 *              organization may use, a scoreboard over only the apps the
 *              caller can access;
 *            - PATCH: organization owners and admins only, the key must
 *              belong to the organization, model and limit validated;
 *            - GET /v1/admin/byok/cursor/models?keyId=: another app's key
 *              needs an organization owner or admin;
 *            - GET /v1/admin/byok/spend-down carries `reviewFollowups`, and
 *              a failed follow-up read shows null without failing the status.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({
  db: null as unknown,
  authMethod: 'jwt' as 'jwt' | 'apiKey',
  orgRole: 'owner' as string | null,
  accessible: [] as string[],
  listModels: null as null | ((apiKey: string) => Promise<unknown[]>),
  query: {} as Record<string, string>,
}))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/entitlements.ts', () => ({
  requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/project-access.ts', () => ({
  accessibleProjectIds: async () => state.accessible,
}))
vi.mock('../../supabase/functions/_shared/agent-adapters.ts', () => ({
  resolveCursorApiKey: async () => 'crsr_app',
}))
vi.mock('../../supabase/functions/_shared/cursor-cloud.ts', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    listCursorModelsV1: async ({ apiKey }: { apiKey: string }) => (state.listModels ? state.listModels(apiKey) : [{ id: 'grok-4.7' }]),
  }
})
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  resolveOwnedProject: async () => ({
    project: { id: P1, name: 'glot.it', organization_id: ORG, organization_role: state.orgRole },
  }),
  userCanAccessProject: async (_db: unknown, _user: string, projectId: string) => ({
    allowed: state.accessible.includes(projectId),
    role: state.accessible.includes(projectId) ? 'member' : null,
  }),
}))

let routes: typeof import('../../supabase/functions/api/routes/byok-review-followups.ts')
let spendDown: typeof import('../../supabase/functions/api/routes/byok-spend-down.ts')
let dbModule: typeof import('../../supabase/functions/_shared/review-followup-db.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/byok-review-followups.ts')
  spendDown = await import('../../supabase/functions/api/routes/byok-spend-down.ts')
  dbModule = await import('../../supabase/functions/_shared/review-followup-db.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const OTHER_ORG = '0000000b-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const P_FOREIGN = '1000000c-0000-4000-8000-000000000000'
const SHARED = '2000000a-0000-4000-8000-000000000000'
const HIROSE = '2000000b-0000-4000-8000-000000000000'
const FOREIGN_KEY = '2000000d-0000-4000-8000-000000000000'
const OPENAI = '2000000c-0000-4000-8000-000000000000'
const MINE_UNIVERSAL = '2000000e-0000-4000-8000-000000000000'
const OTHER_UNIVERSAL = '2000000f-0000-4000-8000-000000000000'

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown> | null; error?: { code: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handlers: h }) }
  patch(path: string, ...h: Handler[]) { this.routes.push({ method: 'PATCH', path, handlers: h }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handlers: h }) }
  async call(method: string, path: string, body?: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: state.authMethod, projectId: P1 }
    const c = {
      req: { json: async () => body ?? {}, param: () => undefined, header: () => undefined, query: (k: string) => state.query[k] },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

const now = new Date().toISOString()
const followup = (id: string, project: string, over: Record<string, unknown> = {}) => ({
  id,
  project_id: project,
  fix_attempt_id: `a-${id}`,
  status: 'completed',
  head_sha_before: 'a',
  head_sha_after: 'b',
  verdict_after: 'merge',
  dispatched_at: now,
  created_at: now,
  ...over,
})

function setup(opts: { failFollowups?: boolean } = {}): { db: FakeDb; app: FakeApp } {
  const db = makeFakeDb(
    {
      organizations: [
        { id: ORG, review_followup_enabled: true, review_followup_key_id: null, review_followup_model: null, review_followup_daily_limit: 30 },
        { id: OTHER_ORG, review_followup_enabled: true },
      ],
      projects: [
        { id: P1, name: 'glot.it', organization_id: ORG },
        { id: P2, name: 'yen-yen', organization_id: ORG },
        { id: P_FOREIGN, name: 'elsewhere', organization_id: OTHER_ORG },
      ],
      organization_members: [{ organization_id: ORG, user_id: 'u1', role: state.orgRole }],
      byok_keys: [
        { id: SHARED, provider_slug: 'cursor', project_id: null, organization_id: ORG, status: 'active', label: 'ayako', key_hint: '…a1', vault_secret_id: 'v-shared' },
        { id: HIROSE, provider_slug: 'cursor', project_id: P2, organization_id: null, status: 'active', label: 'hirose', key_hint: '…h1', vault_secret_id: 'v-hirose' },
        { id: FOREIGN_KEY, provider_slug: 'cursor', project_id: P_FOREIGN, organization_id: null, status: 'active', label: 'other', vault_secret_id: 'v-foreign' },
        { id: OPENAI, provider_slug: 'openai', project_id: P1, organization_id: null, status: 'active' },
        // Universal keys (ADR 0031): the caller's (u1) and another user's.
        { id: MINE_UNIVERSAL, provider_slug: 'cursor', project_id: null, organization_id: null, owner_user_id: 'u1', status: 'active', label: 'kenji', key_hint: '…k1', vault_secret_id: 'v-mine' },
        { id: OTHER_UNIVERSAL, provider_slug: 'cursor', project_id: null, organization_id: null, owner_user_id: 'u-other', status: 'active', label: 'someone', vault_secret_id: 'v-other' },
      ],
      fix_review_followups: [
        followup('f1', P1),
        followup('f2', P1, { verdict_after: 'fix_first' }),
        followup('f3', P2, { verdict_after: 'hold' }),
        followup('f4', P_FOREIGN),
      ],
      fix_dispatch_jobs: [],
    },
    {
      autoId: true,
      rpc: (fn, args) => (fn === 'vault_get_secret' ? `secret-for-${String(args.secret_id)}` : null),
      failRead: (t) => (opts.failFollowups && t === 'fix_review_followups' ? 'boom' : null),
    },
  )
  state.db = db
  const app = new FakeApp()
  routes.registerByokReviewFollowupRoutes(app as never)
  spendDown.registerByokSpendDownRoutes(app as never)
  return { db, app }
}

const PATH = '/v1/admin/byok/review-followups'

beforeEach(() => {
  state.authMethod = 'jwt'
  state.orgRole = 'owner'
  state.accessible = [P1, P2]
  state.listModels = null
  state.query = {}
  dbModule.clearCursorModelCache()
})

describe('GET review-followups', () => {
  it('settings, the organization keys (shared and app keys, Cursor only) and a scoped scoreboard', async () => {
    const { app } = setup()
    const res = await app.call('GET', PATH)
    expect(res.status).toBe(200)
    const data = res.body.data as Record<string, unknown>
    expect(data).toMatchObject({ available: true, canManage: true, settings: { enabled: true, keyId: null, model: null, dailyLimit: 30 } })
    const keys = data.keys as Array<{ id: string; scope: string; appName: string | null }>
    // The caller owns the organization, so their universal key serves it and is listed.
    expect(keys.map((k) => k.id).sort()).toEqual([SHARED, HIROSE, MINE_UNIVERSAL].sort())
    expect(keys.find((k) => k.id === MINE_UNIVERSAL)).toMatchObject({ scope: 'universal', mine: true })
    expect(keys.find((k) => k.id === HIROSE)).toMatchObject({ scope: 'project', appName: 'yen-yen' })
    expect(data.scoreboard).toMatchObject({ dispatched: 3, pushed: 3, verdictsAfter: { merge: 1, fix_first: 1, hold: 1 }, apps: 2 })
    expect((data.recent as unknown[]).length).toBe(3)
  })

  it('a caller who can access one app sees only its follow-ups, its keys and the shared ones', async () => {
    state.accessible = [P1]
    state.orgRole = 'member'
    const { app } = setup()
    const data = (await app.call('GET', PATH)).body.data as Record<string, unknown>
    expect(data.canManage).toBe(false)
    // HIROSE belongs to yen-yen (P2), which this member cannot open; a
    // member's universal key does not reach an organization they do not own.
    expect((data.keys as Array<{ id: string }>).map((k) => k.id)).toEqual([SHARED])
    expect(data.scoreboard).toMatchObject({ dispatched: 2, verdictsAfter: { merge: 1, fix_first: 1, hold: 0 }, apps: 1 })
  })
})

describe('PATCH review-followups', () => {
  it('turning on stamps enabled_at (off → on only) and clears the off reason', async () => {
    const { db, app } = setup()
    const org = db.table('organizations').find((o) => o.id === ORG)!
    Object.assign(org, { review_followup_enabled: false, review_followup_enabled_at: null, review_followup_off_reason: 'The Cursor key chosen for review follow-ups was deleted.' })
    const res = await app.call('PATCH', PATH, { enabled: true })
    expect(res.status).toBe(200)
    expect(typeof org.review_followup_enabled_at).toBe('string')
    expect(org.review_followup_off_reason).toBeNull()
    const first = org.review_followup_enabled_at
    // Already on: saving again keeps the original stamp.
    await app.call('PATCH', PATH, { enabled: true, dailyLimit: 10 })
    expect(org.review_followup_enabled_at).toBe(first)
    expect(res.body.data).toMatchObject({ settings: { enabled: true, offReason: null } })
  })

  it('an organization owner sets the key, model and daily limit', async () => {
    const { db, app } = setup()
    const res = await app.call('PATCH', PATH, { enabled: true, keyId: HIROSE, model: 'grok-4.7?reasoning_effort=xhigh', dailyLimit: 40 })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ settings: { enabled: true, keyId: HIROSE, model: 'grok-4.7?reasoning_effort=xhigh', dailyLimit: 40 } })
    expect(db.table('organizations').find((o) => o.id === ORG)).toMatchObject({ review_followup_key_id: HIROSE, review_followup_daily_limit: 40 })
  })

  it('members, viewers and API keys may not change it', async () => {
    state.orgRole = 'member'
    let { app } = setup()
    expect((await app.call('PATCH', PATH, { enabled: false })).body.error?.code).toBe('ORG_ADMIN_ONLY')
    state.orgRole = null
    ;({ app } = setup())
    expect((await app.call('PATCH', PATH, { enabled: false })).status).toBe(403)
  })

  it("accepts the owner's universal key; refuses a universal key of someone who does not own the organization", async () => {
    const { db, app } = setup()
    expect((await app.call('PATCH', PATH, { keyId: MINE_UNIVERSAL })).status).toBe(200)
    expect(db.table('organizations').find((o) => o.id === ORG)).toMatchObject({ review_followup_key_id: MINE_UNIVERSAL })
    expect((await app.call('PATCH', PATH, { keyId: OTHER_UNIVERSAL })).body.error?.code).toBe('KEY_NOT_ALLOWED')
    // An admin who is not an owner: their own universal key does not serve this organization.
    state.orgRole = 'admin'
    const second = setup()
    expect((await second.app.call('PATCH', PATH, { keyId: MINE_UNIVERSAL })).body.error?.code).toBe('KEY_NOT_ALLOWED')
  })

  it('refuses a key of another organization, a non-Cursor key, a bad model or limit', async () => {
    const { app } = setup()
    expect((await app.call('PATCH', PATH, { keyId: FOREIGN_KEY })).body.error?.code).toBe('KEY_NOT_ALLOWED')
    expect((await app.call('PATCH', PATH, { keyId: OPENAI })).body.error?.code).toBe('KEY_NOT_ALLOWED')
    expect((await app.call('PATCH', PATH, { keyId: 'nope' })).body.error?.code).toBe('INVALID_KEY_ID')
    expect((await app.call('PATCH', PATH, { model: 'bad id!' })).body.error?.code).toBe('INVALID_CURSOR_MODEL')
    expect((await app.call('PATCH', PATH, { dailyLimit: 0 })).status).toBe(400)
    expect((await app.call('PATCH', PATH, { dailyLimit: 201 })).status).toBe(400)
    expect((await app.call('PATCH', PATH, {})).status).toBe(400)
    // null clears the key and model.
    expect((await app.call('PATCH', PATH, { keyId: null, model: null })).status).toBe(200)
  })
})

describe('GET cursor/models', () => {
  const MODELS = '/v1/admin/byok/cursor/models'
  it('lists models for the shared key with the key\'s own secret', async () => {
    const seen: string[] = []
    state.listModels = async (k) => {
      seen.push(k)
      return [{ id: 'grok-4.7' }]
    }
    state.orgRole = 'member'
    state.query = { keyId: SHARED }
    const { app } = setup()
    const res = await app.call('GET', MODELS)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ models: [{ id: 'grok-4.7' }] })
    expect(seen).toEqual(['secret-for-v-shared'])
  })
  it("another app's key needs an organization owner or admin; another organization's key never", async () => {
    state.orgRole = 'member'
    state.query = { keyId: HIROSE }
    let { app } = setup()
    expect((await app.call('GET', MODELS)).status).toBe(404)
    state.orgRole = 'admin'
    ;({ app } = setup())
    expect((await app.call('GET', MODELS)).status).toBe(200)
    state.query = { keyId: FOREIGN_KEY }
    ;({ app } = setup())
    expect((await app.call('GET', MODELS)).status).toBe(404)
  })
  it('a Cursor error is a 502; no keyId uses the app key', async () => {
    state.listModels = async () => {
      throw new Error('down')
    }
    state.query = { keyId: SHARED }
    let { app } = setup()
    expect((await app.call('GET', MODELS)).body.error?.code).toBe('CURSOR_MODELS_FAILED')
    state.listModels = null
    state.query = {}
    ;({ app } = setup())
    expect((await app.call('GET', MODELS)).status).toBe(200)
  })
})

describe('GET spend-down carries the follow-up scoreboard', () => {
  it('scoped to the apps the caller can access', async () => {
    state.accessible = [P1, P2]
    const { app } = setup()
    const res = await app.call('GET', '/v1/admin/byok/spend-down')
    expect(res.status).toBe(200)
    expect((res.body.data as Record<string, unknown>).reviewFollowups).toMatchObject({
      days: 7,
      dispatched: 3,
      verdictsAfter: { merge: 1, fix_first: 1, hold: 1 },
      apps: 2,
    })
  })
  it('a project API key sees its own app only', async () => {
    state.authMethod = 'apiKey'
    const { app } = setup()
    const res = await app.call('GET', '/v1/admin/byok/spend-down')
    expect((res.body.data as Record<string, unknown>).reviewFollowups).toMatchObject({ dispatched: 2, apps: 1 })
  })
  it('a failed follow-up read shows null and the status still answers', async () => {
    const { app } = setup({ failFollowups: true })
    const res = await app.call('GET', '/v1/admin/byok/spend-down')
    expect(res.status).toBe(200)
    expect((res.body.data as Record<string, unknown>).reviewFollowups).toBeNull()
  })
})
