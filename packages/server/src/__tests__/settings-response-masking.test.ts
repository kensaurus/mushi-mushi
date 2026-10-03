/**
 * `GET /v1/admin/settings` is readable by `mcp:read` API keys (and backs the
 * MCP `project://settings` resource), so it must never return a stored secret
 * or its Vault ref. `PATCH /v1/admin/settings` must accept the masked payload
 * back (the console's General panel used to send the whole row) without
 * touching the stored secrets, and must vault a newly pasted one.
 *
 * The real route module is registered on a fake Hono surface; auth, project
 * resolution and the DB are stubbed.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const PROJECT = '11111111-2222-4333-8444-555555555555'
let db: FakeDb
const adminOrApiKeyCalls: Array<unknown> = []

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => db,
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  // Stands in for a project API key with the default `mcp:read` scope.
  adminOrApiKey: (options?: unknown) => {
    adminOrApiKeyCalls.push(options)
    return async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
      c.set('userId', 'key-owner')
      c.set('apiKeyScopes', ['mcp:read'])
      return next()
    }
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message: string }) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err.message } }, 500),
  resolveOwnedProject: async () => ({ project: { id: PROJECT, name: 'p', role: 'owner' } }),
  ownedProjectIds: async () => [PROJECT],
  callerProjectIds: async () => [PROJECT],
  requireProjectAdmin: () => null,
  callerCanAccessProject: async () => ({ allowed: true, role: 'owner' }),
}))

type Handler = (c: FakeContext, next?: () => Promise<void>) => Promise<unknown> | unknown
interface JsonResult {
  body: Record<string, unknown>
  status: number
}
interface FakeContext {
  req: {
    json: () => Promise<unknown>
    header: (k: string) => string | undefined
    param: (k: string) => string | undefined
    query: (k: string) => string | undefined
  }
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  json: (body: Record<string, unknown>, status?: number) => JsonResult
}

class FakeApp {
  routes = new Map<string, Handler[]>()
  private add(method: string) {
    return (path: string, ...handlers: Handler[]) => {
      this.routes.set(`${method} ${path}`, handlers)
    }
  }
  get = this.add('GET')
  post = this.add('POST')
  put = this.add('PUT')
  patch = this.add('PATCH')
  delete = this.add('DELETE')
  all = this.add('ALL')
  use = () => {}
  async call(method: string, path: string, c: FakeContext): Promise<JsonResult> {
    const handlers = this.routes.get(`${method} ${path}`)
    if (!handlers) throw new Error(`no route ${method} ${path}`)
    let result: unknown
    const run = async (i: number): Promise<void> => {
      const h = handlers[i]
      if (i === handlers.length - 1) {
        result = await h(c)
        return
      }
      const short = await h(c, () => run(i + 1))
      if (result === undefined && short !== undefined) result = short
    }
    await run(0)
    return result as JsonResult
  }
}

function ctx(body?: unknown): FakeContext {
  const vars: Record<string, unknown> = { requestId: 'req-1' }
  return {
    req: {
      json: async () => body,
      header: () => undefined,
      param: () => undefined,
      query: () => undefined,
    },
    get: (k) => vars[k],
    set: (k, v) => {
      vars[k] = v
    },
    json: (b, status = 200) => ({ body: b, status }),
  }
}

const RAW_TOKEN = 'ghp_rawtokenAAAABBBBCCCCDDDD1234'
const RAW_WHSEC = 'whsec_plaintextvalue_0123456789'
const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/secretpart'
const SENTRY_REF = `vault://mushi/integration/${PROJECT}/sentry/sentry_webhook_secret`
const TELEGRAM_REF = `vault://mushi/integration/${PROJECT}/voice/telegram_bot_token_ref`

let app: FakeApp

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  const mod = await import('../../supabase/functions/api/routes/settings-research.ts')
  app = new FakeApp()
  mod.registerSettingsResearchRoutes(app as never)
})

beforeEach(() => {
  db = makeFakeDb(
    {
      project_settings: [
        {
          project_id: PROJECT,
          github_installation_token_ref: RAW_TOKEN,
          github_webhook_secret: RAW_WHSEC,
          sentry_webhook_secret: SENTRY_REF,
          telegram_bot_token_ref: TELEGRAM_REF,
          slack_webhook_url: SLACK_URL,
          slack_channel_id: 'C123',
          stage2_model: 'claude-sonnet-5-5',
          sentry_dsn: 'https://pub@o0.ingest.sentry.io/1',
        },
      ],
    },
    { rpc: (fn) => (fn === 'vault_store_secret' ? 'secret-uuid' : null) },
  )
})

describe('GET /v1/admin/settings', () => {
  it('is gated by adminOrApiKey with the default (mcp:read) scope', () => {
    expect(adminOrApiKeyCalls).toContain(undefined)
  })

  it('gives an mcp:read key no secret value and no Vault ref', async () => {
    const res = await app.call('GET', '/v1/admin/settings', ctx())
    expect(res.status).toBe(200)
    const wire = JSON.stringify(res.body)
    for (const secret of [RAW_TOKEN, RAW_WHSEC, SLACK_URL, 'secretpart', 'vault://']) {
      expect(wire).not.toContain(secret)
    }
    const data = res.body.data as Record<string, unknown>
    expect(data.github_installation_token_ref_set).toBe(true)
    expect(data.sentry_webhook_secret_set).toBe(true)
    expect(data.slack_webhook_url_set).toBe(true)
    // Non-secret settings still come back as-is.
    expect(data.slack_channel_id).toBe('C123')
    expect(data.sentry_dsn).toBe('https://pub@o0.ingest.sentry.io/1')
  })

  it('returns the spend caps as plain values (the console re-checks them before applying suggested caps)', async () => {
    db.table('project_settings')[0].monthly_llm_budget_usd = 40
    db.table('project_settings')[0].autofix_max_spend_usd = null
    const data = (await app.call('GET', '/v1/admin/settings', ctx())).body.data as Record<string, unknown>
    expect(data.monthly_llm_budget_usd).toBe(40)
    expect(data.autofix_max_spend_usd).toBeNull()
  })

  it('answers {} only when the project has no settings row', async () => {
    db = makeFakeDb({ project_settings: [] })
    const res = await app.call('GET', '/v1/admin/settings', ctx())
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({})
  })

  it('a failed read is a 500, never {} (which would read as "nothing is set")', async () => {
    db = makeFakeDb({ project_settings: [{ project_id: PROJECT }] }, { failRead: (t) => (t === 'project_settings' ? 'statement timeout' : null) })
    const res = await app.call('GET', '/v1/admin/settings', ctx())
    expect(res.status).toBe(500)
    expect(res.body.data).toBeUndefined()
  })
})

describe('PATCH /v1/admin/settings', () => {
  it('accepts the masked GET payload back without changing any stored secret', async () => {
    const got = await app.call('GET', '/v1/admin/settings', ctx())
    const echoed = { ...(got.body.data as Record<string, unknown>), stage2_model: 'claude-opus-5-5' }
    const res = await app.call('PATCH', '/v1/admin/settings', ctx(echoed))
    expect(res.status).toBe(200)
    const row = db.table('project_settings')[0]
    expect(row.stage2_model).toBe('claude-opus-5-5')
    expect(row.sentry_webhook_secret).toBe(SENTRY_REF)
    expect(row.telegram_bot_token_ref).toBe(TELEGRAM_REF)
    expect(row.slack_webhook_url).toBe(SLACK_URL)
    expect(db.rpcCalls.filter((c) => c.fn === 'vault_store_secret')).toHaveLength(0)
  })

  it('stores a newly pasted Sentry webhook secret in Vault and keeps only the ref', async () => {
    const res = await app.call('PATCH', '/v1/admin/settings', ctx({ sentry_webhook_secret: 'whsec_brand_new_value' }))
    expect(res.status).toBe(200)
    const store = db.rpcCalls.find((c) => c.fn === 'vault_store_secret')
    expect(store?.args).toEqual({
      secret_name: `mushi/integration/${PROJECT}/sentry/sentry_webhook_secret`,
      secret_value: 'whsec_brand_new_value',
    })
    expect(db.table('project_settings')[0].sentry_webhook_secret).toBe(SENTRY_REF)
  })

  it('removes exactly the secret the console Remove action names', async () => {
    const res = await app.call('PATCH', '/v1/admin/settings', ctx({ sentry_webhook_secret: null }))
    expect(res.status).toBe(200)
    const row = db.table('project_settings')[0]
    expect(row.sentry_webhook_secret).toBeNull()
    expect(row.slack_webhook_url).toBe(SLACK_URL)
    expect(row.telegram_bot_token_ref).toBe(TELEGRAM_REF)

    await app.call('PATCH', '/v1/admin/settings', ctx({ slack_webhook_url: null }))
    expect(db.table('project_settings')[0].slack_webhook_url).toBeNull()
    expect(db.rpcCalls.filter((c) => c.fn === 'vault_store_secret')).toHaveLength(0)
  })

  it('refuses a Vault ref the server did not store for this row', async () => {
    const res = await app.call(
      'PATCH',
      '/v1/admin/settings',
      ctx({ sentry_webhook_secret: 'vault://mushi/integration/99999999-8888-4777-8666-555555555555/sentry/sentry_webhook_secret' }),
    )
    expect(res.status).toBe(400)
    expect(db.table('project_settings')[0].sentry_webhook_secret).toBe(SENTRY_REF)
  })
})
