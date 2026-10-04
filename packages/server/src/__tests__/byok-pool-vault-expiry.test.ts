/**
 * FILE: byok-pool-vault-expiry.test.ts
 * PURPOSE: Leftover key bugs found after the BYOK fixes, against the real
 *          route module mounted on Hono.
 *
 *   V1  Removing a pool key called vault_delete_secret({ secret_id }), but
 *       that function takes a secret NAME. PostgREST had no such signature,
 *       so every removed pool key left its secret in Vault. Pool rows keep
 *       the id, so they now call vault_delete_secret_by_id.
 *   E1  An optional "expires on" date for a key (Supabase tokens have one
 *       that no API returns): validated, stored in byok_keys.expires_at,
 *       listed back, and editable on an existing key.
 *   S1  PUT /v1/admin/integrations/platform/sentry stored sentry_dsn without
 *       the Sentry-host check PATCH /v1/admin/settings applies.
 *
 * No real Vault, network or key: every value is an obvious fake.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { parseByokExpiry } from '../../supabase/functions/_shared/byok-expiry.ts'
import { validatePlatformBody } from '../../supabase/functions/_shared/integration-validation.ts'

const P = '1000000b-0000-4000-8000-000000000000'
const USER = '2000000b-0000-4000-8000-000000000000'
const KEY_ID = '3000000b-0000-4000-8000-000000000001'

let db: FakeDb
let vault: Record<string, string>

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/entitlements.ts', () => ({
  requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    resolveOwnedProject: async () => ({ project: { id: P, owner_id: USER, role: 'owner' } }),
  }
})

let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerSettingsResearchRoutes } = await import(
    '../../supabase/functions/api/routes/settings-research.ts'
  )
  app = new Hono()
  registerSettingsResearchRoutes(app as never)
})

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))

beforeEach(() => {
  vault = {}
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const POOL_ROW = {
  id: KEY_ID,
  project_id: P,
  provider_slug: 'supabase',
  vault_secret_id: '4000000b-0000-4000-8000-0000000000aa',
  key_hint: 'sbp_FAKE…0001',
  label: null,
  priority: 100,
  status: 'active',
  test_status: 'ok',
  created_at: '2026-09-01T00:00:00Z',
}

function seed(pool: Array<Record<string, unknown>> = []) {
  db = makeFakeDb(
    { project_settings: [{ project_id: P }], byok_keys: pool },
    {
      autoId: true,
      rpc: (fn, args) => {
        if (fn === 'vault_get_secret') return vault[String(args.secret_id)] ?? null
        if (fn === 'vault_store_secret') {
          const id = `5000000b-0000-4000-8000-00000000000${Object.keys(vault).length + 1}`
          vault[id] = String(args.secret_value)
          return id
        }
        if (fn === 'vault_delete_secret_by_id') {
          delete vault[String(args.secret_id)]
          return 1
        }
        return null
      },
    },
  )
}

const rpc = (fn: string) => db.rpcCalls.filter((c) => c.fn === fn)

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('V1: removing a pool key deletes its Vault secret by id', () => {
  it('calls vault_delete_secret_by_id with the stored secret id', async () => {
    seed([POOL_ROW])
    vault[POOL_ROW.vault_secret_id] = 'sbp_FAKE-0001'

    const { status } = await call('DELETE', `/v1/admin/byok/keys/${KEY_ID}`)

    expect(status).toBe(200)
    expect(db.tables.byok_keys).toHaveLength(0)
    expect(rpc('vault_delete_secret_by_id')).toEqual([
      { fn: 'vault_delete_secret_by_id', args: { secret_id: POOL_ROW.vault_secret_id } },
    ])
    expect(rpc('vault_delete_secret')).toHaveLength(0)
    expect(vault[POOL_ROW.vault_secret_id]).toBeUndefined()
  })
})

describe('E1: key expiry dates', () => {
  const NOW = Date.parse('2026-10-04T00:00:00Z')

  it('parses a date, an ISO time, and empty values', () => {
    expect(parseByokExpiry('2027-01-31', NOW)).toEqual({ ok: true, value: '2027-01-31T23:59:59.000Z' })
    expect(parseByokExpiry('2026-12-01T10:00:00Z', NOW)).toEqual({
      ok: true,
      value: '2026-12-01T10:00:00.000Z',
    })
    expect(parseByokExpiry('', NOW)).toEqual({ ok: true, value: null })
    expect(parseByokExpiry(null, NOW)).toEqual({ ok: true, value: null })
    expect(parseByokExpiry(undefined, NOW)).toEqual({ ok: true, value: null })
  })

  it('refuses past, impossible, far-future and non-date values with a sentence', () => {
    expect(parseByokExpiry('2026-10-01', NOW)).toMatchObject({ ok: false, message: /already passed/ })
    expect(parseByokExpiry('2027-02-30', NOW)).toMatchObject({ ok: false, message: /not a real date/ })
    expect(parseByokExpiry('2099-01-01', NOW)).toMatchObject({ ok: false, message: /within 10 years/ })
    expect(parseByokExpiry('soon', NOW)).toMatchObject({ ok: false, message: /2027-01-31/ })
    expect(parseByokExpiry(42, NOW)).toMatchObject({ ok: false })
  })

  it('POST stores expires_at when given and returns it', async () => {
    seed()
    const { status, json } = await call('POST', '/v1/admin/byok/keys', {
      provider: 'firecrawl',
      key: 'fc-FAKE-expiring-0009',
      expiresAt: '2030-06-30',
    })
    expect(status).toBe(200)
    expect(json.data.expires_at).toBe('2030-06-30T23:59:59.000Z')
    expect(json.data.expiryWarning).toBeUndefined()
    expect(db.tables.byok_keys[0].expires_at).toBe('2030-06-30T23:59:59.000Z')
  })

  it('POST refuses a bad expiry before writing anything to Vault', async () => {
    seed()
    const { status, json } = await call('POST', '/v1/admin/byok/keys', {
      provider: 'firecrawl',
      key: 'fc-FAKE-expiring-0009',
      expiresAt: '2001-01-01',
    })
    expect(status).toBe(400)
    expect(json.error.code).toBe('VALIDATION_ERROR')
    expect(json.error.message).toMatch(/already passed/)
    expect(rpc('vault_store_secret')).toHaveLength(0)
  })

  it('GET lists each pool key with its expiry (null when unknown)', async () => {
    seed([
      { ...POOL_ROW, expires_at: '2030-01-01T00:00:00.000Z' },
      { ...POOL_ROW, id: '3000000b-0000-4000-8000-000000000002', provider_slug: 'firecrawl' },
    ])
    const { json } = await call('GET', '/v1/admin/byok/keys')
    const byId = Object.fromEntries(
      (json.data.keys as Array<{ id: string; expires_at: string | null }>).map((k) => [k.id, k.expires_at]),
    )
    expect(byId[KEY_ID]).toBe('2030-01-01T00:00:00.000Z')
    expect(byId['3000000b-0000-4000-8000-000000000002']).toBeNull()
  })

  it('PUT …/expiry sets and clears the date on an existing key', async () => {
    seed([POOL_ROW])
    const set = await call('PUT', `/v1/admin/byok/keys/${KEY_ID}/expiry`, { expiresAt: '2030-03-01' })
    expect(set.status).toBe(200)
    expect(db.tables.byok_keys[0].expires_at).toBe('2030-03-01T23:59:59.000Z')

    const cleared = await call('PUT', `/v1/admin/byok/keys/${KEY_ID}/expiry`, { expiresAt: null })
    expect(cleared.status).toBe(200)
    expect(db.tables.byok_keys[0].expires_at).toBeNull()

    const bad = await call('PUT', `/v1/admin/byok/keys/${KEY_ID}/expiry`, { expiresAt: 'later' })
    expect(bad.status).toBe(400)
  })

  it('PUT …/expiry on another project’s or a missing key is a 404', async () => {
    seed([])
    const { status } = await call('PUT', `/v1/admin/byok/keys/${KEY_ID}/expiry`, { expiresAt: '2030-03-01' })
    expect(status).toBe(404)
  })
})

describe('S1: integration settings validate sentry_dsn', () => {
  it('rejects a DSN that is not on a Sentry host', () => {
    expect(validatePlatformBody({ sentry_dsn: 'https://k@evil.example.com/1' })).toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(validatePlatformBody({ sentry_dsn: 'not a dsn' })).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('accepts a Sentry DSN and a clear', () => {
    expect(validatePlatformBody({ sentry_dsn: 'https://k@o1.ingest.us.sentry.io/2' })).toBeNull()
    expect(validatePlatformBody({ sentry_dsn: '' })).toBeNull()
    expect(validatePlatformBody({ sentry_dsn: null })).toBeNull()
  })
})
