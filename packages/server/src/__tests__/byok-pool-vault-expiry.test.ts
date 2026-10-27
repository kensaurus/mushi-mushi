/**
 * FILE: byok-pool-vault-expiry.test.ts
 * PURPOSE: Leftover key bugs found after the BYOK fixes, against the real
 *          route module mounted on Hono.
 *
 *   V1  Removing a pool key called vault_delete_secret({ secret_id }), but
 *       that function takes a secret NAME. PostgREST had no such signature,
 *       so every removed pool key left its secret in Vault. Pool rows keep
 *       the id, so they now call vault_delete_secret_if_unused (migration
 *       20261021051628), which keeps a secret something else still uses:
 *       on live data a pool row shared its secret with the project's legacy
 *       byok_<provider>_key_ref, which the resolver uses (review 2026-10-21).
 *   E1  An optional "expires on" date for a key (Supabase tokens have one
 *       that no API returns): validated, stored in byok_keys.expires_at,
 *       listed back, and editable on an existing key.
 *   S1  PUT /v1/admin/integrations/platform/sentry stored sentry_dsn without
 *       the Sentry-host check PATCH /v1/admin/settings applies.
 *
 * No real Vault, network or key: every value is an obvious fake.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
        if (fn === 'vault_delete_secret_if_unused') {
          // Mirrors private.vault_secret_in_use: any byok_keys row, or any
          // *_ref column holding the bare id or vault://<id>, keeps it.
          const id = String(args.secret_id)
          const refs = new Set([id, `vault://${id}`])
          const inUse =
            db.table('byok_keys').some((k: Record<string, unknown>) => k.vault_secret_id === id) ||
            [...db.table('project_settings'), ...db.table('organization_integration_settings')].some((row: Record<string, unknown>) =>
              Object.entries(row).some(([col, v]) => col.endsWith('_ref') && refs.has(String(v))),
            )
          if (inUse) return 0
          delete vault[id]
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

describe('V1: removing a pool key deletes its Vault secret by id, unless something else uses it', () => {
  it('calls vault_delete_secret_if_unused with the stored secret id', async () => {
    seed([POOL_ROW])
    vault[POOL_ROW.vault_secret_id] = 'sbp_FAKE-0001'

    const { status } = await call('DELETE', `/v1/admin/byok/keys/${KEY_ID}`)

    expect(status).toBe(200)
    expect(db.tables.byok_keys).toHaveLength(0)
    expect(rpc('vault_delete_secret_if_unused')).toEqual([
      { fn: 'vault_delete_secret_if_unused', args: { secret_id: POOL_ROW.vault_secret_id } },
    ])
    // Never the unchecked delete.
    expect(rpc('vault_delete_secret_by_id')).toHaveLength(0)
    expect(rpc('vault_delete_secret')).toHaveLength(0)
    expect(vault[POOL_ROW.vault_secret_id]).toBeUndefined()
  })

  it("keeps a secret the project's legacy key ref still points at (yen-yen, 2026-10-21)", async () => {
    seed([POOL_ROW])
    vault[POOL_ROW.vault_secret_id] = 'sbp_FAKE-0001'
    ;(db.table('project_settings')[0] as Record<string, unknown>).byok_anthropic_key_ref = `vault://${POOL_ROW.vault_secret_id}`

    const { status } = await call('DELETE', `/v1/admin/byok/keys/${KEY_ID}`)

    expect(status).toBe(200)
    expect(db.tables.byok_keys).toHaveLength(0)
    expect(rpc('vault_delete_secret_by_id')).toHaveLength(0)
    expect(vault[POOL_ROW.vault_secret_id]).toBe('sbp_FAKE-0001')
  })
})

describe('private.vault_secret_in_use (migration 20261021051628)', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20261021051628_byok_keys_universal_scope.sql'),
    'utf-8',
  )
  const fn = (name: string) => sql.slice(sql.indexOf(`create or replace function ${name}(`), sql.indexOf('$$;', sql.indexOf(`create or replace function ${name}(`)))

  it('counts byok_keys rows and every *_ref column of project_settings and organization_integration_settings, bare or vault://', () => {
    const helper = fn('private.vault_secret_in_use')
    expect(helper).toContain('from public.byok_keys k where k.vault_secret_id = p_secret_id')
    expect(helper).toContain("c.table_name in ('project_settings', 'organization_integration_settings')")
    expect(helper).toContain("c.column_name like '%\\_ref' escape '\\'")
    expect(helper).toContain("using p_secret_id::text, 'vault://' || p_secret_id::text")
    expect(helper).toContain('security definer')
    expect(helper).toContain("set search_path = ''")
  })

  it('the trigger and the route RPC both ask it before deleting, and the trigger only warns on a missing privilege', () => {
    expect(fn('public.vault_delete_secret_if_unused')).toContain('private.vault_secret_in_use(secret_id)')
    const trigger = fn('private.byok_keys_delete_vault_secret')
    expect(trigger).toContain('not private.vault_secret_in_use(old.vault_secret_id)')
    expect(trigger).toContain('exception when insufficient_privilege then')
    expect(trigger).toContain('raise warning')
    expect(sql).toContain('grant execute on function public.vault_delete_secret_if_unused(uuid) to service_role;')
    expect(sql).toContain('revoke all on function private.vault_secret_in_use(uuid) from public, anon, authenticated;')
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

describe('K1: settings stats count keys like the console rows', () => {
  it('counts a superseded legacy key as needing attention and an expiring key separately', async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    db = makeFakeDb(
      {
        project_settings: [
          {
            project_id: P,
            byok_anthropic_key_ref: `vault://mushi/byok/${P}/anthropic`,
            byok_anthropic_test_status: 'ok',
          },
        ],
        byok_keys: [
          { ...POOL_ROW, provider_slug: 'anthropic' },
          { ...POOL_ROW, id: '3000000b-0000-4000-8000-000000000003', provider_slug: 'openai', expires_at: soon },
          {
            ...POOL_ROW,
            id: '3000000b-0000-4000-8000-000000000004',
            provider_slug: 'cursor',
            status: 'disabled',
          },
        ],
      },
      { autoId: true },
    )
    const { status, json } = await call('GET', '/v1/admin/settings/stats')
    expect(status).toBe(200)
    expect(json.data).toMatchObject({
      byokKeysPassing: 1,
      byokKeysFailing: 1, // the old anthropic key, replaced by the pooled one
      byokKeysExpiring: 1,
      byokKeysUntested: 0,
      byokKeysConfigured: 3, // the turned-off cursor key is not counted
      byokAnthropicConfigured: true,
      byokOpenaiConfigured: true,
    })
  })

  it('counts a quota key whose cooldown has ended as working', async () => {
    db = makeFakeDb(
      {
        project_settings: [{ project_id: P }],
        byok_keys: [
          {
            ...POOL_ROW,
            status: 'quota_exhausted',
            test_status: 'error_quota',
            cooldown_until: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      },
      { autoId: true },
    )
    const { json } = await call('GET', '/v1/admin/settings/stats')
    expect(json.data).toMatchObject({ byokKeysPassing: 1, byokKeysFailing: 0 })
  })
})

describe('settings stats tell Slack "saved" apart from "can send"', () => {
  it('a channel id alone is saved but cannot post', async () => {
    seed()
    Object.assign(db.table('project_settings')[0], { slack_channel_id: 'C123' })
    const { status, json } = await call('GET', '/v1/admin/settings/stats')
    expect(status).toBe(200)
    expect(json.data).toMatchObject({ slackConfigured: true, slackCanPost: false })
  })

  it('a webhook, or a bot plus a channel, can post', async () => {
    seed()
    Object.assign(db.table('project_settings')[0], {
      slack_webhook_url: 'https://hooks.slack.com/services/T/B/x',
    })
    const webhook = await call('GET', '/v1/admin/settings/stats')
    expect(webhook.json.data).toMatchObject({ slackConfigured: true, slackCanPost: true })

    seed()
    Object.assign(db.table('project_settings')[0], {
      slack_channel_id: 'C123',
      slack_bot_token_ref: 'vault://bot',
    })
    const bot = await call('GET', '/v1/admin/settings/stats')
    expect(bot.json.data).toMatchObject({ slackConfigured: true, slackCanPost: true })
  })

  it('a bot token without a channel cannot post', async () => {
    seed()
    Object.assign(db.table('project_settings')[0], { slack_bot_token_ref: 'vault://bot' })
    const { json } = await call('GET', '/v1/admin/settings/stats')
    expect(json.data).toMatchObject({ slackConfigured: true, slackCanPost: false })
  })
})
