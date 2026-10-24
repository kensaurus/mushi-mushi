/**
 * FILE: privacy-status.test.ts
 * PURPOSE: The sidebar privacy chip reads GET /v1/admin/privacy-status.
 *          byok_configured follows the app's key resolution (own → legacy →
 *          organization → the organization's owners' universal keys → platform),
 *          so an owner and an admin see the same chip for the same app.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '10000000-0000-4000-8000-000000000002'
const ORG = '7a7b7991-0000-4000-8000-000000000002'
const OWNER = 'aaaaaaaa-0000-4000-8000-00000000000a'
const ADMIN = 'cccccccc-0000-4000-8000-00000000000c'
const STRANGER = 'dddddddd-0000-4000-8000-00000000000d'

const envStore: Record<string, string | undefined> = {}
const previousDeno = (globalThis as { Deno?: unknown }).Deno
let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (
    c: { set: (k: string, v: string) => void; req: { header: (name: string) => string | undefined } },
    next: () => Promise<void>,
  ) => {
    c.set('userId', c.req.header('x-test-user') ?? OWNER)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { adminOrApiKey: () => pass }
})

let app: Hono
let resolveLlmKeySource: (
  client: unknown,
  projectId: string,
  provider: 'anthropic' | 'openai' | 'firecrawl' | 'browserbase',
) => Promise<string | null>

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: (key: string) => string | undefined } } }).Deno = {
    env: { get: (key: string) => envStore[key] },
  }
  const evolution = await import('../../supabase/functions/api/routes/evolution.ts')
  const byok = await import('../../supabase/functions/_shared/byok.ts')
  resolveLlmKeySource = byok.resolveLlmKeySource
  app = new Hono()
  evolution.registerEvolutionRoutes(app as never)
})

afterAll(() => {
  ;(globalThis as { Deno?: unknown }).Deno = previousDeno
})

function seed(keys: Array<Record<string, unknown>>, settings: Record<string, unknown> = {}) {
  db = makeFakeDb({
    projects: [{ id: P, organization_id: ORG }],
    organization_members: [
      { organization_id: ORG, user_id: OWNER, role: 'owner' },
      { organization_id: ORG, user_id: ADMIN, role: 'admin' },
    ],
    project_members: [],
    byok_keys: keys,
    project_settings: [{ project_id: P, byok_status_checked_at: '2026-10-01T00:00:00.000Z', ...settings }],
  })
}

function key(
  id: string,
  owner: { project_id?: string; organization_id?: string; owner_user_id?: string },
  provider = 'anthropic',
) {
  return {
    id,
    provider_slug: provider,
    project_id: owner.project_id ?? null,
    organization_id: owner.organization_id ?? null,
    owner_user_id: owner.owner_user_id ?? null,
    vault_secret_id: id,
    label: null,
    priority: 100,
    status: 'active',
    cooldown_until: null,
    test_status: 'ok',
    base_url: null,
  }
}

async function privacy(userId: string, path = '/v1/admin/privacy-status') {
  const res = await app.request(path, {
    headers: { 'X-Mushi-Project-Id': P, 'x-test-user': userId },
  })
  return {
    status: res.status,
    json: (await res.json()) as {
      ok: boolean
      data?: { byok_configured: boolean; llm_provider: string; last_audit_at: string | null }
    },
  }
}

/** The chip is BYOK when any privacy provider resolves to a non-platform key. */
async function expectedByok(): Promise<boolean> {
  for (const provider of ['anthropic', 'openai', 'firecrawl', 'browserbase'] as const) {
    const source = await resolveLlmKeySource(db, P, provider)
    if (source && source !== 'env') return true
  }
  return false
}

describe('GET /v1/admin/privacy-status', () => {
  it('gives the owner and the admin the same chip, matching key resolution', async () => {
    const cases: Array<{
      name: string
      keys: Array<Record<string, unknown>>
      settings?: Record<string, unknown>
      env?: string
      byok: boolean
    }> = [
      { name: 'project key', keys: [key('own', { project_id: P })], byok: true },
      { name: 'organization key', keys: [key('org', { organization_id: ORG })], byok: true },
      { name: 'owner universal key', keys: [key('uni', { owner_user_id: OWNER })], byok: true },
      { name: 'admin universal key', keys: [key('admin-uni', { owner_user_id: ADMIN })], byok: false },
      {
        name: 'legacy credential',
        keys: [],
        settings: { byok_anthropic_key_ref: 'vault://legacy', byok_anthropic_test_status: 'ok' },
        byok: true,
      },
      {
        name: 'unvalidated legacy credential',
        keys: [],
        settings: { byok_anthropic_key_ref: 'vault://legacy', byok_anthropic_test_status: 'error_auth' },
        byok: false,
      },
      { name: 'firecrawl pool key', keys: [key('fc', { project_id: P }, 'firecrawl')], byok: true },
      { name: 'platform key', keys: [], env: 'sk-ant-platform-0000', byok: false },
    ]

    for (const c of cases) {
      if (c.env) envStore.ANTHROPIC_API_KEY = c.env
      else delete envStore.ANTHROPIC_API_KEY
      seed(c.keys, c.settings)
      const owner = await privacy(OWNER)
      const admin = await privacy(ADMIN)
      expect(owner.status, c.name).toBe(200)
      expect(admin.json, c.name).toEqual(owner.json)
      expect(owner.json.data?.byok_configured, c.name).toBe(c.byok)
      expect(owner.json.data?.byok_configured, c.name).toBe(await expectedByok())
      expect(owner.json.data?.llm_provider, c.name).toBe(c.byok ? 'byok' : 'platform')
      expect(owner.json.data?.last_audit_at, c.name).toBe('2026-10-01T00:00:00.000Z')
    }
  })

  it('rejects a caller who cannot open the app', async () => {
    delete envStore.ANTHROPIC_API_KEY
    seed([])
    const res = await privacy(STRANGER, `/v1/admin/projects/${P}/privacy-status`)
    expect(res.status).toBe(403)
  })
})
