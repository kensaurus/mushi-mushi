/**
 * FILE: byok-legacy-routes.test.ts
 * PURPOSE: Settings → AI keys, against the real route module mounted on Hono.
 *
 *   B1  The console lists a legacy row for every provider in
 *       `_shared/byok.ts` LEGACY_REF_COL and offers Delete / Test on it.
 *       Deleting the legacy Firecrawl key returned 400 BAD_PROVIDER because
 *       the generic `/v1/admin/byok/:provider` handlers (anthropic + openai
 *       only) were registered before the dedicated Firecrawl / Browserbase
 *       ones, and Hono runs the first match. These requests go through the
 *       real registration order, so a regression in order fails here.
 *   B2  The same key could be pooled twice, and a pooled copy of the legacy
 *       key left the legacy credential behind.
 *   I2/I3  The pool route normalizes pastes and rejects wrong-provider keys.
 *   BL-098  Removing a legacy key called vault_delete_secret by name and
 *       destroyed a Vault secret a pooled key still referenced. These tests
 *       check call order and errors only: the routes clear the legacy columns
 *       first, then call vault_delete_secret_by_name_if_unused, and never fall
 *       back. Whether that RPC keeps a shared secret is
 *       vault-delete-secret-by-name-if-unused.runtime.test.ts.
 *
 * No real Vault, network or key: every value is an obvious fake.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const USER = '2000000a-0000-4000-8000-000000000000'

let db: FakeDb
/** Vault contents by secret name or id, read through vault_get_secret. */
let vault: Record<string, string>
/** When set, the safe delete RPC throws instead of returning an error row. */
let throwVaultDelete = false
/** Legacy ref columns as they were at the moment the safe delete RPC ran. */
let refsAtDelete: Record<string, unknown>

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
  throwVaultDelete = false
  refsAtDelete = {}
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function seed(
  settings: Record<string, unknown>,
  pool: Array<Record<string, unknown>> = [],
  opts?: { failSafeDelete?: boolean },
) {
  db = makeFakeDb(
    { project_settings: [{ project_id: P, ...settings }], byok_keys: pool },
    {
      autoId: true,
      rpcError: (fn) =>
        opts?.failSafeDelete && fn === 'vault_delete_secret_by_name_if_unused'
          ? { code: 'PGRST202', message: 'function not found' }
          : null,
      rpc: (fn, args) => {
        if (fn === 'vault_get_secret') return vault[String(args.secret_id)] ?? null
        if (fn === 'vault_store_secret') {
          const id = `id-${Object.keys(vault).length + 1}`
          vault[id] = String(args.secret_value)
          vault[String(args.secret_name)] = String(args.secret_value)
          return id
        }
        if (fn === 'vault_delete_secret_by_name_if_unused') {
          if (throwVaultDelete) throw new Error('vault rpc down')
          const row = (db.tables.project_settings[0] ?? {}) as Record<string, unknown>
          refsAtDelete = {
            byok_anthropic_key_ref: row.byok_anthropic_key_ref,
            byok_openai_key_ref: row.byok_openai_key_ref,
            byok_openai_base_url: row.byok_openai_base_url,
            byok_firecrawl_key_ref: row.byok_firecrawl_key_ref,
            byok_browserbase_key_ref: row.byok_browserbase_key_ref,
          }
          // Call order only. Preservation is the database test of the migration,
          // not this stub: it drops whatever name the route passed.
          delete vault[String(args.secret_name ?? '')]
          return 1
        }
        if (fn === 'vault_delete_secret') {
          delete vault[String(args.secret_name)]
          return 1
        }
        return null
      },
    },
  )
}

const settingsRow = () => db.tables.project_settings[0]
const rpc = (fn: string) => db.rpcCalls.filter((call) => call.fn === fn)

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

const LEGACY_FIRECRAWL = {
  byok_firecrawl_key_ref: `vault://mushi/byok/${P}/firecrawl`,
  byok_firecrawl_key_hint: 'fc-FAKE…0001',
  byok_firecrawl_test_status: 'error_network',
  byok_firecrawl_tested_at: '2026-10-01T00:00:00Z',
  byok_firecrawl_key_added_at: '2026-09-01T00:00:00Z',
}

describe('B1: legacy routes reach every legacy provider', () => {
  it('DELETE /v1/admin/byok/firecrawl clears the legacy columns and deletes the Vault secret', async () => {
    seed(LEGACY_FIRECRAWL)
    vault[`mushi/byok/${P}/firecrawl`] = 'fc-FAKE-legacy-0001'

    const { status, json } = await call('DELETE', '/v1/admin/byok/firecrawl')

    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    expect(settingsRow().byok_firecrawl_key_ref).toBeNull()
    expect(settingsRow().byok_firecrawl_key_hint).toBeNull()
    expect(settingsRow().byok_firecrawl_test_status).toBeNull()
    expect(refsAtDelete.byok_firecrawl_key_ref).toBeNull()
    expect(rpc('vault_delete_secret_by_name_if_unused')).toEqual([
      { fn: 'vault_delete_secret_by_name_if_unused', args: { secret_name: `mushi/byok/${P}/firecrawl` } },
    ])
    expect(rpc('vault_delete_secret')).toHaveLength(0)
  })

  it('DELETE /v1/admin/byok/browserbase and anthropic both work', async () => {
    seed({
      byok_browserbase_key_ref: `vault://mushi/byok/${P}/browserbase`,
      byok_anthropic_key_ref: `vault://mushi/byok/${P}/anthropic`,
      byok_anthropic_test_status: 'ok',
    })
    expect((await call('DELETE', '/v1/admin/byok/browserbase')).status).toBe(200)
    expect((await call('DELETE', '/v1/admin/byok/anthropic')).status).toBe(200)
    expect(settingsRow().byok_browserbase_key_ref).toBeNull()
    expect(settingsRow().byok_anthropic_key_ref).toBeNull()
    expect(settingsRow().byok_anthropic_test_status).toBeNull()
  })

  it('POST /v1/admin/byok/firecrawl/test probes the stored key', async () => {
    seed(LEGACY_FIRECRAWL)
    vault[`mushi/byok/${P}/firecrawl`] = 'fc-FAKE-legacy-0001'

    const { status, json } = await call('POST', '/v1/admin/byok/firecrawl/test')

    expect(status).toBe(200)
    expect(json.data.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.firecrawl.dev')
    expect(settingsRow().byok_firecrawl_test_status).toBe('ok')
  })

  it('POST /v1/admin/byok/browserbase/test probes Browserbase', async () => {
    seed({ byok_browserbase_key_ref: `vault://mushi/byok/${P}/browserbase` })
    vault[`mushi/byok/${P}/browserbase`] = 'bb_FAKE_legacy_0001'

    const { status, json } = await call('POST', '/v1/admin/byok/browserbase/test')

    expect(status).toBe(200)
    expect(json.data.status).toBe('ok')
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.browserbase.com')
  })

  it('a domains-only Firecrawl settings save reaches its own handler (no key required)', async () => {
    seed({})
    const { status, json } = await call('PUT', '/v1/admin/byok/firecrawl', {
      allowedDomains: ['Docs.Example.com'],
      maxPagesPerCall: 7,
    })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    expect(settingsRow().firecrawl_allowed_domains).toEqual(['docs.example.com'])
    expect(settingsRow().firecrawl_max_pages_per_call).toBe(7)
  })

  it('an unknown provider is still a 400, with a sentence instead of a bare code', async () => {
    seed({})
    const { status, json } = await call('DELETE', '/v1/admin/byok/cursor')
    expect(status).toBe(400)
    expect(json.error.code).toBe('BAD_PROVIDER')
    expect(json.error.message).toMatch(/no single-key slot for "cursor"/)
    expect(json.error.message).toContain('anthropic, openai, firecrawl, browserbase')
  })

  it('the legacy PUT stores a normalized key', async () => {
    seed({})
    const { status } = await call('PUT', '/v1/admin/byok/anthropic', {
      key: 'export ANTHROPIC_API_KEY="sk-ant-FAKE-0000-0001"\n',
    })
    expect(status).toBe(200)
    expect(rpc('vault_store_secret')[0].args.secret_value).toBe('sk-ant-FAKE-0000-0001')
  })
})

describe('B2 + I2/I3: POST /v1/admin/byok/keys', () => {
  const POOL_ROW = {
    id: '3000000a-0000-4000-8000-000000000001',
    project_id: P,
    provider_slug: 'firecrawl',
    vault_secret_id: 'pool-secret-1',
    key_hint: 'fc-FAKE-pool…0002',
    label: null,
    priority: 100,
    status: 'active',
    test_status: 'ok',
  }

  it('refuses a key that is already pooled, before touching Vault', async () => {
    seed({}, [POOL_ROW])
    vault['pool-secret-1'] = 'fc-FAKE-pool-0002'

    const { status, json } = await call('POST', '/v1/admin/byok/keys', {
      provider: 'firecrawl',
      key: '  fc-FAKE-pool-0002\n',
    })

    expect(status).toBe(409)
    expect(json.error).toEqual({
      code: 'DUPLICATE_KEY',
      message: 'This key is already saved (fc-FAKE-pool…0002).',
    })
    expect(rpc('vault_store_secret')).toHaveLength(0)
    expect(JSON.stringify(json)).not.toContain('fc-FAKE-pool-0002')
  })

  it('matches a disabled pooled key too', async () => {
    seed({}, [{ ...POOL_ROW, status: 'disabled' }])
    vault['pool-secret-1'] = 'fc-FAKE-pool-0002'
    const { status } = await call('POST', '/v1/admin/byok/keys', {
      provider: 'firecrawl',
      key: 'FIRECRAWL_API_KEY=fc-FAKE-pool-0002',
    })
    expect(status).toBe(409)
  })

  it('pooling the legacy key retires the legacy credential once the probe passes', async () => {
    seed(LEGACY_FIRECRAWL)
    vault[`mushi/byok/${P}/firecrawl`] = 'fc-FAKE-legacy-0001'

    const { status, json } = await call('POST', '/v1/admin/byok/keys', {
      provider: 'firecrawl',
      key: 'fc-FAKE-legacy-0001',
    })

    expect(status).toBe(200)
    expect(json.data.validation.status).toBe('ok')
    expect(json.data.legacyRetired).toBe(true)
    expect(json.data.legacySuperseded).toBe(false)
    expect(settingsRow().byok_firecrawl_key_ref).toBeNull()
    expect(db.tables.byok_keys).toHaveLength(1)
    expect(refsAtDelete.byok_firecrawl_key_ref).toBeNull()
    expect(rpc('vault_delete_secret_by_name_if_unused').map((c) => c.args.secret_name)).toEqual([
      `mushi/byok/${P}/firecrawl`,
    ])
    expect(rpc('vault_delete_secret')).toHaveLength(0)
  })

  it('keeps the legacy credential when the pooled copy fails its probe', async () => {
    seed(LEGACY_FIRECRAWL)
    vault[`mushi/byok/${P}/firecrawl`] = 'fc-FAKE-legacy-0001'
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 401 }))

    const { json } = await call('POST', '/v1/admin/byok/keys', {
      provider: 'firecrawl',
      key: 'fc-FAKE-legacy-0001',
    })

    expect(json.data.legacyRetired).toBe(false)
    expect(settingsRow().byok_firecrawl_key_ref).toBe(LEGACY_FIRECRAWL.byok_firecrawl_key_ref)
  })

  it('a different working key flags the legacy key as superseded without deleting it', async () => {
    seed(LEGACY_FIRECRAWL)
    vault[`mushi/byok/${P}/firecrawl`] = 'fc-FAKE-legacy-0001'

    const { json } = await call('POST', '/v1/admin/byok/keys', {
      provider: 'firecrawl',
      key: 'fc-FAKE-other-0003',
    })

    expect(json.data.legacyRetired).toBe(false)
    expect(json.data.legacySuperseded).toBe(true)
    expect(settingsRow().byok_firecrawl_key_ref).toBe(LEGACY_FIRECRAWL.byok_firecrawl_key_ref)
    expect(rpc('vault_delete_secret')).toHaveLength(0)
    expect(rpc('vault_delete_secret_by_name_if_unused')).toHaveLength(0)
  })

  it('a pooled key test reports legacySuperseded when a legacy key is still stored', async () => {
    seed(LEGACY_FIRECRAWL, [POOL_ROW])
    vault['pool-secret-1'] = 'fc-FAKE-pool-0002'
    const { json } = await call('POST', `/v1/admin/byok/keys/${POOL_ROW.id}/test`)
    expect(json.data.validation.status).toBe('ok')
    expect(json.data.legacySuperseded).toBe(true)
  })

  it('stores the normalized paste, not what was typed', async () => {
    seed({})
    const { status } = await call('POST', '/v1/admin/byok/keys', {
      provider: 'openai',
      key: 'OPENAI_API_KEY=sk-proj-FAKE-0000-0004\r\n',
    })
    expect(status).toBe(200)
    expect(rpc('vault_store_secret')[0].args.secret_value).toBe('sk-proj-FAKE-0000-0004')
  })

  it('rejects a key for another provider with the same sentence the console shows', async () => {
    seed({})
    const { status, json } = await call('POST', '/v1/admin/byok/keys', {
      provider: 'openai',
      key: 'sk-ant-FAKE-0000-0005',
    })
    expect(status).toBe(400)
    expect(json.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'This looks like an Anthropic key — paste it in the Anthropic row.',
    })
    expect(rpc('vault_store_secret')).toHaveLength(0)
  })
})

describe('BL-098: removing a legacy key does not delete a Vault secret a pooled key still uses', () => {
  const SHARED = '4000000a-0000-4000-8000-0000000000aa'
  const poolRow = (provider: string) => ({
    id: '3000000a-0000-4000-8000-000000000099',
    project_id: P,
    provider_slug: provider,
    vault_secret_id: SHARED,
    status: 'active',
  })

  it.each([
    ['anthropic', '/v1/admin/byok/anthropic', `mushi/byok/${P}/anthropic`, 'byok_anthropic_key_ref'],
    ['openai', '/v1/admin/byok/openai', `mushi/byok/${P}/openai`, 'byok_openai_key_ref'],
    ['firecrawl', '/v1/admin/byok/firecrawl', `mushi/byok/${P}/firecrawl`, 'byok_firecrawl_key_ref'],
    ['browserbase', '/v1/admin/byok/browserbase', `mushi/byok/${P}/browserbase`, 'byok_browserbase_key_ref'],
  ] as const)(
    'DELETE %s clears the slot first, then calls vault_delete_secret_by_name_if_unused',
    async (provider, path, secretName, refCol) => {
      seed({
        [refCol]: `vault://${secretName}`,
        ...(provider === 'openai' ? { byok_openai_base_url: 'https://example.invalid/v1' } : {}),
      })
      vault[secretName] = 'sk-FAKE-legacy'

      const { status } = await call('DELETE', path)

      expect(status).toBe(200)
      expect(settingsRow()[refCol]).toBeNull()
      if (provider === 'openai') expect(settingsRow().byok_openai_base_url).toBeNull()
      expect(refsAtDelete[refCol]).toBeNull()
      if (provider === 'openai') expect(refsAtDelete.byok_openai_base_url).toBeNull()
      expect(rpc('vault_delete_secret_by_name_if_unused')).toEqual([
        { fn: 'vault_delete_secret_by_name_if_unused', args: { secret_name: secretName } },
      ])
      expect(rpc('vault_delete_secret')).toHaveLength(0)
      expect(vault[secretName]).toBeUndefined()
    },
  )

  it('calls the safe RPC with the legacy name when a pool row holds that secret id', async () => {
    const name = `mushi/byok/${P}/anthropic`
    seed({ byok_anthropic_key_ref: `vault://${name}` }, [poolRow('anthropic')])

    const { status } = await call('DELETE', '/v1/admin/byok/anthropic')

    expect(status).toBe(200)
    expect(settingsRow().byok_anthropic_key_ref).toBeNull()
    expect(refsAtDelete.byok_anthropic_key_ref).toBeNull()
    expect(rpc('vault_delete_secret_by_name_if_unused')).toEqual([
      { fn: 'vault_delete_secret_by_name_if_unused', args: { secret_name: name } },
    ])
    expect(rpc('vault_delete_secret')).toHaveLength(0)
  })

  it('calls the safe RPC with the uuid a pool row holds', async () => {
    seed({ byok_anthropic_key_ref: `vault://${SHARED}` }, [poolRow('anthropic')])

    const { status } = await call('DELETE', '/v1/admin/byok/anthropic')

    expect(status).toBe(200)
    expect(refsAtDelete.byok_anthropic_key_ref).toBeNull()
    expect(rpc('vault_delete_secret_by_name_if_unused')).toEqual([
      { fn: 'vault_delete_secret_by_name_if_unused', args: { secret_name: SHARED } },
    ])
    expect(rpc('vault_delete_secret')).toHaveLength(0)
  })

  it('calls the safe RPC with a vault://uuid only after the column is cleared', async () => {
    seed({ byok_anthropic_key_ref: `vault://${SHARED}` })
    vault[SHARED] = 'sk-ant-FAKE-only-legacy'

    const { status } = await call('DELETE', '/v1/admin/byok/anthropic')

    expect(status).toBe(200)
    expect(refsAtDelete.byok_anthropic_key_ref).toBeNull()
    expect(vault[SHARED]).toBeUndefined()
    expect(rpc('vault_delete_secret')).toHaveLength(0)
  })

  it('firecrawl delete calls the safe RPC when a pool row holds the secret', async () => {
    const name = `mushi/byok/${P}/firecrawl`
    seed({ byok_firecrawl_key_ref: `vault://${name}` }, [poolRow('firecrawl')])

    const { status } = await call('DELETE', '/v1/admin/byok/firecrawl')

    expect(status).toBe(200)
    expect(settingsRow().byok_firecrawl_key_ref).toBeNull()
    expect(refsAtDelete.byok_firecrawl_key_ref).toBeNull()
    expect(rpc('vault_delete_secret_by_name_if_unused')).toEqual([
      { fn: 'vault_delete_secret_by_name_if_unused', args: { secret_name: name } },
    ])
    expect(rpc('vault_delete_secret')).toHaveLength(0)
  })

  it('does not fall back to vault_delete_secret when the safe RPC errors', async () => {
    const name = `mushi/byok/${P}/firecrawl`
    seed({ byok_firecrawl_key_ref: `vault://${name}` }, [], { failSafeDelete: true })
    vault[name] = 'fc-FAKE'

    const { status } = await call('DELETE', '/v1/admin/byok/firecrawl')

    expect(status).toBe(200)
    expect(settingsRow().byok_firecrawl_key_ref).toBeNull()
    expect(vault[name]).toBe('fc-FAKE')
    expect(rpc('vault_delete_secret_by_name_if_unused')).toHaveLength(1)
    expect(rpc('vault_delete_secret')).toHaveLength(0)
  })

  it('does not fall back to vault_delete_secret when the safe RPC throws', async () => {
    const name = `mushi/byok/${P}/browserbase`
    throwVaultDelete = true
    seed({ byok_browserbase_key_ref: `vault://${name}` })
    vault[name] = 'bb_FAKE'

    const { status } = await call('DELETE', '/v1/admin/byok/browserbase')

    expect(status).toBe(200)
    expect(settingsRow().byok_browserbase_key_ref).toBeNull()
    expect(vault[name]).toBe('bb_FAKE')
    expect(rpc('vault_delete_secret')).toHaveLength(0)
  })
})

describe('vault_delete_secret_by_name_if_unused (migration 20261116090000)', () => {
  // Grants and delegation, as text. Runtime behavior is
  // vault-delete-secret-by-name-if-unused.runtime.test.ts.
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20261116090000_vault_delete_secret_by_name_if_unused.sql'),
    'utf8',
  )

  it('resolves a name or uuid and deletes only through vault_delete_secret_if_unused', () => {
    expect(sql).toContain('where s.name = secret_name')
    expect(sql).toContain('where s.id = secret_name::uuid')
    expect(sql).toContain('return public.vault_delete_secret_if_unused(v_id);')
    expect(sql).not.toContain('vault_delete_secret(')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toContain('security definer')
    expect(sql).toContain(
      'grant execute on function public.vault_delete_secret_by_name_if_unused(text) to service_role;',
    )
    expect(sql).toContain(
      'revoke all on function public.vault_delete_secret_by_name_if_unused(text) from public, anon, authenticated;',
    )
  })
})
