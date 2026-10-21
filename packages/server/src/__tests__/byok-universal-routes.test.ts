/**
 * FILE: byok-universal-routes.test.ts
 * PURPOSE: The key routes with universal keys (ADR 0031), through the real
 *          handlers on an in-memory database:
 *            - POST /v1/admin/byok/keys defaults to universal for a console
 *              user who owns the app's organization, and to the app for API
 *              keys (CLI, MCP) and non-owners;
 *            - PATCH /v1/admin/byok/keys/:keyId/scope moves a key between
 *              app, organization and universal, and audits each move as
 *              `rescoped`;
 *            - only a universal key's owner changes it;
 *            - the list labels each key's scope.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const ORG_MUSHI = '7a7b7991-0000-4000-8000-000000000002'
const ORG_OTHER = '0c0c0c0c-0000-4000-8000-000000000003'
const OWNER = 'aaaaaaaa-0000-4000-8000-00000000000a'
const OTHER_OWNER = 'bbbbbbbb-0000-4000-8000-00000000000b'
const P_MUSHI = '10000000-0000-4000-8000-000000000002'
const P_OTHER = '10000000-0000-4000-8000-000000000003'
const OWN_KEY = '20000000-0000-4000-8000-000000000001'
const COLLEAGUE_APP_KEY = '20000000-0000-4000-8000-000000000005'
const COLLEAGUE_ORG_KEY = '20000000-0000-4000-8000-000000000006'
const COLLEAGUE = 'cccccccc-0000-4000-8000-00000000000c'
const MY_UNIVERSAL = '20000000-0000-4000-8000-000000000002'
const THEIR_UNIVERSAL = '20000000-0000-4000-8000-000000000003'

const state = vi.hoisted(() => ({
  db: null as unknown,
  userId: '',
  authMethod: 'jwt' as 'jwt' | 'apiKey',
  project: null as null | Record<string, unknown>,
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', state.userId)
    c.set('authMethod', state.authMethod)
    if (state.authMethod === 'apiKey') c.set('projectId', String(state.project?.id))
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/entitlements.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveOwnedProject: async () => ({ project: state.project, explicit: true }),
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerSettingsResearchRoutes } = await import('../../supabase/functions/api/routes/settings-research.ts')
  app = new Hono()
  registerSettingsResearchRoutes(app as never)
})

const mushiProject = { id: P_MUSHI, name: 'mushi-mushi', organization_id: ORG_MUSHI, organization_role: 'owner' }
const otherProject = { id: P_OTHER, name: 'other', organization_id: ORG_OTHER, organization_role: 'admin' }

const row = (
  id: string,
  owner: { project_id?: string; organization_id?: string; owner_user_id?: string },
  createdBy: string | null = OWNER,
) => ({
  id,
  created_by: createdBy,
  provider_slug: 'anthropic',
  project_id: owner.project_id ?? null,
  organization_id: owner.organization_id ?? null,
  owner_user_id: owner.owner_user_id ?? null,
  vault_secret_id: `vault-${id}`,
  key_hint: '…abcd',
  label: null,
  priority: 100,
  status: 'active',
  test_status: 'ok',
  cooldown_until: null,
  base_url: null,
  created_at: '2026-10-21T00:00:00Z',
})

let db: FakeDb
beforeEach(() => {
  state.userId = OWNER
  state.authMethod = 'jwt'
  state.project = mushiProject
  db = makeFakeDb(
    {
      projects: [
        { id: P_MUSHI, organization_id: ORG_MUSHI, name: 'mushi-mushi' },
        { id: P_OTHER, organization_id: ORG_OTHER, name: 'other' },
      ],
      organizations: [
        { id: ORG_MUSHI, name: 'mushi' },
        { id: ORG_OTHER, name: 'other' },
      ],
      organization_members: [
        { organization_id: ORG_MUSHI, user_id: OWNER, role: 'owner' },
        { organization_id: ORG_OTHER, user_id: OTHER_OWNER, role: 'owner' },
        { organization_id: ORG_OTHER, user_id: OWNER, role: 'admin' },
      ],
      project_settings: [{ project_id: P_MUSHI }, { project_id: P_OTHER }],
      byok_keys: [
        row(OWN_KEY, { project_id: P_MUSHI }),
        row(MY_UNIVERSAL, { owner_user_id: OWNER }),
        row(THEIR_UNIVERSAL, { owner_user_id: OTHER_OWNER }, OTHER_OWNER),
        // Added by a colleague: never theirs to take over as universal.
        row(COLLEAGUE_APP_KEY, { project_id: P_MUSHI }, COLLEAGUE),
        row(COLLEAGUE_ORG_KEY, { organization_id: ORG_MUSHI }, COLLEAGUE),
      ],
      byok_audit_log: [],
      integration_health_history: [],
    },
    {
      autoId: true,
      rpc: (fn, args) =>
        fn === 'vault_store_secret' ? '30000000-0000-4000-8000-000000000009' : fn === 'vault_get_secret' ? `stored-${String(args.secret_id)}` : null,
    },
  )
  state.db = db
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }))
})

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: res.status, body: (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
}

const keyRow = (id: string) => db.table('byok_keys').find((k: Record<string, unknown>) => k.id === id) as Record<string, unknown>
const SEEDED = [OWN_KEY, MY_UNIVERSAL, THEIR_UNIVERSAL, COLLEAGUE_APP_KEY, COLLEAGUE_ORG_KEY]
const newest = () => db.table('byok_keys').find((k: Record<string, unknown>) => !SEEDED.includes(String(k.id))) as Record<string, unknown>
const NEW_KEY = { provider: 'firecrawl', key: 'fc-FAKE-universal-0001' }

describe('POST /v1/admin/byok/keys scope', () => {
  it('omitted, the API adds the key to this app, for console users too (the console sends universal itself)', async () => {
    const res = await call('POST', '/v1/admin/byok/keys', NEW_KEY)
    expect(res.status).toBe(200)
    expect(res.body.data?.scope).toBe('project')
    expect(newest()).toMatchObject({ project_id: P_MUSHI, organization_id: null })
  })

  it('a console owner who asks for universal gets a key for all their apps', async () => {
    const res = await call('POST', '/v1/admin/byok/keys', { ...NEW_KEY, scope: 'universal' })
    expect(res.status).toBe(200)
    expect(res.body.data?.scope).toBe('universal')
    expect(newest()).toMatchObject({ project_id: null, organization_id: null, owner_user_id: OWNER })
    const added = db.table('byok_audit_log').find((r: Record<string, unknown>) => r.action === 'added') as Record<string, unknown>
    expect(added.meta).toMatchObject({ scope: 'universal' })
  })

  it('an API key (CLI, MCP) keeps the app default', async () => {
    state.authMethod = 'apiKey'
    const res = await call('POST', '/v1/admin/byok/keys', NEW_KEY)
    expect(res.status).toBe(200)
    expect(res.body.data?.scope).toBe('project')
    expect(newest()).toMatchObject({ project_id: P_MUSHI, organization_id: null })
    expect(newest().owner_user_id ?? null).toBeNull()
  })

  it('an API key cannot add a universal key', async () => {
    state.authMethod = 'apiKey'
    const res = await call('POST', '/v1/admin/byok/keys', { ...NEW_KEY, scope: 'universal' })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('UNIVERSAL_KEY_CONSOLE_ONLY')
    expect(newest()).toBeUndefined()
  })

  it('an admin who does not own the organization cannot ask for universal', async () => {
    state.project = otherProject
    expect((await call('POST', '/v1/admin/byok/keys', NEW_KEY)).body.data?.scope).toBe('project')
    const res = await call('POST', '/v1/admin/byok/keys', { ...NEW_KEY, key: 'fc-FAKE-universal-0002', scope: 'universal' })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('UNIVERSAL_KEY_NEEDS_OWNER')
  })

  it('refuses an unknown scope', async () => {
    const res = await call('POST', '/v1/admin/byok/keys', { ...NEW_KEY, scope: 'everyone' })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /v1/admin/byok/keys/:keyId/scope', () => {
  it('moves an app key to universal, and back, auditing each move as rescoped', async () => {
    let res = await call('PATCH', `/v1/admin/byok/keys/${OWN_KEY}/scope`, { scope: 'universal' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ scope: 'universal', from: 'project' })
    expect(keyRow(OWN_KEY)).toMatchObject({ project_id: null, organization_id: null, owner_user_id: OWNER })

    res = await call('PATCH', `/v1/admin/byok/keys/${OWN_KEY}/scope`, { scope: 'organization' })
    expect(res.body.data).toMatchObject({ scope: 'organization', from: 'universal' })
    expect(keyRow(OWN_KEY)).toMatchObject({ project_id: null, organization_id: ORG_MUSHI, owner_user_id: null })

    res = await call('PATCH', `/v1/admin/byok/keys/${OWN_KEY}/scope`, { scope: 'project' })
    expect(res.body.data).toMatchObject({ scope: 'project', from: 'organization' })
    expect(keyRow(OWN_KEY)).toMatchObject({ project_id: P_MUSHI, organization_id: null, owner_user_id: null })

    const audits = db.table('byok_audit_log').filter((r: Record<string, unknown>) => r.action === 'rescoped')
    expect(audits.map((r: Record<string, unknown>) => r.meta)).toEqual([
      { key_id: OWN_KEY, from: 'project', to: 'universal' },
      { key_id: OWN_KEY, from: 'universal', to: 'organization' },
      { key_id: OWN_KEY, from: 'organization', to: 'project' },
    ])
    expect(audits.every((r: Record<string, unknown>) => r.actor_user_id === OWNER && r.project_id === P_MUSHI)).toBe(true)
  })

  it('POST stays an alias (ADR 0023 consoles)', async () => {
    const res = await call('POST', `/v1/admin/byok/keys/${OWN_KEY}/scope`, { scope: 'organization' })
    expect(res.status).toBe(200)
    expect(keyRow(OWN_KEY).organization_id).toBe(ORG_MUSHI)
  })

  it("only the owner moves a universal key; a co-admin gets UNIVERSAL_KEY_OWNER_ONLY", async () => {
    state.project = otherProject
    const res = await call('PATCH', `/v1/admin/byok/keys/${THEIR_UNIVERSAL}/scope`, { scope: 'project' })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('UNIVERSAL_KEY_OWNER_ONLY')
    expect(keyRow(THEIR_UNIVERSAL).owner_user_id).toBe(OTHER_OWNER)
  })

  it('moving to universal needs an owner of this organization', async () => {
    state.project = otherProject
    db.table('byok_keys').push(row('20000000-0000-4000-8000-000000000004', { project_id: P_OTHER }))
    const res = await call('PATCH', '/v1/admin/byok/keys/20000000-0000-4000-8000-000000000004/scope', { scope: 'universal' })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('UNIVERSAL_KEY_NEEDS_OWNER')
  })

  it('API keys never change where a key is used', async () => {
    state.authMethod = 'apiKey'
    const res = await call('PATCH', `/v1/admin/byok/keys/${OWN_KEY}/scope`, { scope: 'universal' })
    expect(res.status).toBe(403)
    expect(keyRow(OWN_KEY).project_id).toBe(P_MUSHI)
    expect(db.table('byok_audit_log').some((r: Record<string, unknown>) => r.action === 'rescoped')).toBe(false)
  })
})

describe('moving someone else\'s key to universal (takeover guard)', () => {
  it("a colleague's app key cannot become my universal key", async () => {
    const res = await call('PATCH', `/v1/admin/byok/keys/${COLLEAGUE_APP_KEY}/scope`, { scope: 'universal' })
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('UNIVERSAL_KEY_NOT_YOURS')
    expect(keyRow(COLLEAGUE_APP_KEY)).toMatchObject({ project_id: P_MUSHI, owner_user_id: null })
  })

  it("a colleague's organization key cannot become my universal key", async () => {
    const res = await call('PATCH', `/v1/admin/byok/keys/${COLLEAGUE_ORG_KEY}/scope`, { scope: 'universal' })
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('UNIVERSAL_KEY_NOT_YOURS')
    expect(keyRow(COLLEAGUE_ORG_KEY)).toMatchObject({ organization_id: ORG_MUSHI, owner_user_id: null })
    expect(db.table('byok_audit_log').some((r: Record<string, unknown>) => r.action === 'rescoped')).toBe(false)
  })

  it("a colleague's key can still move between this app and this organization", async () => {
    const res = await call('PATCH', `/v1/admin/byok/keys/${COLLEAGUE_ORG_KEY}/scope`, { scope: 'project' })
    expect(res.status).toBe(200)
    expect(keyRow(COLLEAGUE_ORG_KEY)).toMatchObject({ project_id: P_MUSHI, organization_id: null })
  })
})

describe('GET /v1/admin/byok/credits', () => {
  it("never decrypts another owner's universal key", async () => {
    state.project = otherProject
    const res = await call('GET', '/v1/admin/byok/credits')
    expect(res.status).toBe(200)
    const keys = res.body.data?.keys as Array<{ id: string; credits: { kind: string } }>
    expect(keys.find((k) => k.id === THEIR_UNIVERSAL)?.credits.kind).toBe('unavailable')
    expect(db.rpcCalls.some((c) => c.fn === 'vault_get_secret' && c.args.secret_id === `vault-${THEIR_UNIVERSAL}`)).toBe(false)
  })

  it('reads the balance of my own universal key', async () => {
    await call('GET', '/v1/admin/byok/credits')
    expect(db.rpcCalls.some((c) => c.fn === 'vault_get_secret' && c.args.secret_id === `vault-${MY_UNIVERSAL}`)).toBe(true)
  })
})

describe('before migration 20261021090000 (no owner_user_id column)', () => {
  /** Every byok_keys read or write naming owner_user_id answers 42703, as PostgREST does. */
  function dropOwnerColumn() {
    const real = db as unknown as { from: (t: string) => Record<string, unknown> }
    const from = real.from.bind(real)
    const missing = { data: null, error: { code: '42703', message: 'column byok_keys.owner_user_id does not exist' } }
    ;(real as { from: unknown }).from = (table: string) => {
      const b = from(table)
      if (table !== 'byok_keys') return b
      let broken = false
      const wrapped: Record<string, unknown> = new Proxy(b, {
        get(target, prop) {
          if (prop === 'then' && broken) return (resolveFn: (v: unknown) => void) => resolveFn(missing)
          const v = (target as Record<string | symbol, unknown>)[prop]
          if (typeof v !== 'function') return v
          return (...args: unknown[]) => {
            if (args.some((a) => (typeof a === 'string' && a.includes('owner_user_id')) || (a && typeof a === 'object' && 'owner_user_id' in (a as object)))) broken = true
            if (broken && (prop === 'maybeSingle' || prop === 'single')) return Promise.resolve(missing)
            const out = (v as (...a: unknown[]) => unknown).apply(target, args)
            return out === target ? wrapped : out
          }
        },
      })
      return wrapped
    }
  }

  it('the key list still answers, without universal keys', async () => {
    dropOwnerColumn()
    const res = await call('GET', '/v1/admin/byok/keys')
    expect(res.status).toBe(200)
    const keys = res.body.data?.keys as Array<Record<string, unknown>>
    expect(keys.map((k) => k.id).sort()).toEqual([OWN_KEY, COLLEAGUE_APP_KEY, COLLEAGUE_ORG_KEY].sort())
    expect(res.body.data?.universal ?? null).toBeNull()
  })

  it('moves between app and organization still work; universal says it is not available yet', async () => {
    dropOwnerColumn()
    expect((await call('PATCH', `/v1/admin/byok/keys/${OWN_KEY}/scope`, { scope: 'organization' })).status).toBe(200)
    expect(keyRow(OWN_KEY).organization_id).toBe(ORG_MUSHI)
    const res = await call('PATCH', `/v1/admin/byok/keys/${OWN_KEY}/scope`, { scope: 'universal' })
    expect(res.status).toBe(503)
    expect(res.body.error?.code).toBe('UNIVERSAL_KEYS_UNAVAILABLE')
  })

  it('per-key writes still work', async () => {
    dropOwnerColumn()
    expect((await call('PATCH', `/v1/admin/byok/keys/${OWN_KEY}`, { label: 'still works' })).status).toBe(200)
    expect(keyRow(OWN_KEY).label).toBe('still works')
  })
})

describe('per-key writes on a universal key', () => {
  it("another owner's universal key is read-only here", async () => {
    state.project = otherProject
    const res = await call('PATCH', `/v1/admin/byok/keys/${THEIR_UNIVERSAL}`, { status: 'disabled' })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('UNIVERSAL_KEY_OWNER_ONLY')
    expect(keyRow(THEIR_UNIVERSAL).status).toBe('active')
  })

  it('its owner can change it from any app', async () => {
    const res = await call('PATCH', `/v1/admin/byok/keys/${MY_UNIVERSAL}`, { label: 'all my apps' })
    expect(res.status).toBe(200)
    expect(keyRow(MY_UNIVERSAL).label).toBe('all my apps')
  })
})

describe('GET /v1/admin/byok/keys', () => {
  it('labels each scope and says whether a universal key serves this app', async () => {
    state.project = otherProject
    const res = await call('GET', '/v1/admin/byok/keys')
    expect(res.status).toBe(200)
    const keys = res.body.data?.keys as Array<Record<string, unknown>>
    const byId = new Map(keys.map((k) => [k.id, k]))
    // Another owner's key serves this app (they own its organization), read-only for us.
    expect(byId.get(THEIR_UNIVERSAL)).toMatchObject({ scope: 'universal', ownedByMe: false, servesThisApp: true })
    // Our own universal key is listed so we can manage it, but it does not serve an org we only administer.
    expect(byId.get(MY_UNIVERSAL)).toMatchObject({ scope: 'universal', ownedByMe: true, servesThisApp: false })
    // Never another app's key, and never who owns a universal key.
    expect(byId.has(OWN_KEY)).toBe(false)
    expect(keys.every((k) => !('owner_user_id' in k))).toBe(true)
    expect(res.body.data?.universal).toMatchObject({ canAdd: false, organizationCount: 1, appCount: 1 })
  })

  it('an owner may add universal keys here', async () => {
    const res = await call('GET', '/v1/admin/byok/keys')
    expect(res.body.data?.universal).toMatchObject({ canAdd: true })
    const keys = res.body.data?.keys as Array<Record<string, unknown>>
    // App keys, then the organization key, then universal ones.
    expect(keys.map((k) => k.scope)).toEqual(['project', 'project', 'organization', 'universal'])
  })
})
