/**
 * OAuth start routes and the Browserbase key delete.
 *
 * - Slack install signs a project-bound state. With no X-Mushi-Project-Id it
 *   used to fall back to the caller's oldest project and could connect Slack
 *   to the wrong app; it now answers 400 NO_PROJECT_SELECTED.
 * - Both OAuth start routes return a URL holding a one-time state/nonce, so
 *   they send Cache-Control: no-store.
 * - DELETE /v1/admin/byok/browserbase wrapped vault_delete_secret in
 *   try/catch, but rpc() reports failure in `error`; the error is now logged.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const USER = '2000000a-0000-4000-8000-000000000000'

let db: FakeDb
let explicit = true
const warn = vi.fn()

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: (...a: unknown[]) => warn(...a), error: () => {}, debug: () => {}, child: () => noop }
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
vi.mock('../../supabase/functions/_shared/entitlements.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    resolveOwnedProject: async () => ({
      project: { id: P, name: 'App', organization_id: null, organization_role: 'owner' },
      explicit,
    }),
  }
})

const ENV: Record<string, string> = {
  SLACK_CLIENT_ID: 'fake-client',
  SLACK_CLIENT_SECRET: 'fake-secret',
  LINEAR_OAUTH_CLIENT_ID: 'fake-linear',
  SUPABASE_URL: 'http://fake.local',
}

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => ENV[k] } }
  const { registerSettingsResearchRoutes } = await import('../../supabase/functions/api/routes/settings-research.ts')
  const { registerIntegrationsRoutes } = await import('../../supabase/functions/api/routes/integrations.ts')
  app = new Hono()
  registerSettingsResearchRoutes(app as never)
  registerIntegrationsRoutes(app as never)
})

beforeEach(() => {
  explicit = true
  warn.mockClear()
  db = makeFakeDb({ project_settings: [{ project_id: P }], linear_oauth_states: [], byok_audit_log: [] })
})

describe('GET /v1/admin/integrations/slack/install', () => {
  it('refuses to fall back to a default project', async () => {
    explicit = false
    const res = await app.request('/v1/admin/integrations/slack/install')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NO_PROJECT_SELECTED')
  })

  it('returns the authorize URL uncached for an explicit project', async () => {
    const res = await app.request('/v1/admin/integrations/slack/install')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('GET /v1/admin/linear-oauth/authorize', () => {
  it('returns the nonce-bearing URL uncached', async () => {
    const res = await app.request('/v1/admin/linear-oauth/authorize')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('DELETE /v1/admin/byok/browserbase', () => {
  it('logs a vault_delete_secret error instead of dropping it', async () => {
    ;(db as unknown as { rpc: unknown }).rpc = async () => ({ data: null, error: { code: '42501', message: 'denied' } })
    const res = await app.request('/v1/admin/byok/browserbase', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(warn).toHaveBeenCalledWith('vault_delete_secret failed for browserbase (non-fatal)', { code: '42501' })
  })
})
