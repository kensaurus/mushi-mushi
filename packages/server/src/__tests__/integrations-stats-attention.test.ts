/**
 * FILE: integrations-stats-attention.test.ts
 * PURPOSE: GET /v1/admin/integrations/stats returns platformAttention from the
 *          same classifyPlatformConnection loop that sets the banner priority.
 *          A Sentry poll that has not finished, or finished too long ago, is
 *          attention. sentry_auto_import is read from the project row: it is
 *          not an inherited org setting.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const USER = '2000000a-0000-4000-8000-000000000000'

const effective = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  sourceByField: {} as Record<string, 'project' | 'org' | 'env' | null>,
}))

let db: FakeDb

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
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  reportError: vi.fn(),
  reportMessage: vi.fn(),
  ensureSentry: () => {},
}))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    resolveOwnedProject: async () => ({
      project: { id: P, name: 'App', organization_id: null, organization_role: 'owner' },
    }),
  }
})
vi.mock('../../supabase/functions/_shared/integration-settings.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    resolveEffectivePlatformSettings: async () => ({
      settings: effective.settings,
      sourceByField: effective.sourceByField,
      organizationId: null,
    }),
  }
})

const ENV: Record<string, string> = {
  SUPABASE_URL: 'http://fake.local',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role',
}

const CONNECTED: Record<string, string> = {
  sentry_org_slug: 'acme',
  sentry_auth_token_ref: 'vault://sentry',
  langfuse_host: 'https://cloud.langfuse.com',
  langfuse_public_key_ref: 'vault://lf-pub',
  langfuse_secret_key_ref: 'vault://lf-sec',
  github_repo_url: 'https://github.com/acme/app',
  github_installation_token_ref: 'vault://gh',
}

function probes(at: string) {
  return ['sentry', 'langfuse', 'github'].map((kind) => ({
    kind,
    status: 'ok',
    checked_at: at,
    project_id: P,
  }))
}

let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno = {
    env: { get: (k: string) => ENV[k] },
  }
  const { registerIntegrationsRoutes } = await import('../../supabase/functions/api/routes/integrations.ts')
  app = new Hono()
  registerIntegrationsRoutes(app as never)
})

interface StatsBody {
  platformAttention: number
  platformHealthy: number
  platformConnected: number
  platformDown: number
  topPriority: string
  topPriorityLabel: string | null
}

async function loadStats(): Promise<StatsBody> {
  const res = await app.request('/v1/admin/integrations/stats')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ok: boolean; data: StatsBody }
  expect(body.ok).toBe(true)
  expect(body.data).toHaveProperty('platformAttention')
  expect(typeof body.data.platformAttention).toBe('number')
  return body.data
}

describe('GET /v1/admin/integrations/stats platformAttention', () => {
  const now = Date.now()
  const freshAt = new Date(now - 60_000).toISOString()
  const staleAt = new Date(now - 2 * 60 * 60 * 1000).toISOString()

  function seed(row: Record<string, unknown>) {
    effective.settings = { ...CONNECTED }
    effective.sourceByField = Object.fromEntries(Object.keys(CONNECTED).map((k) => [k, 'project' as const]))
    db = makeFakeDb({
      project_settings: [{ project_id: P, ...row }],
      integration_health_history: probes(freshAt),
      webhook_audit_log: [],
      project_integrations: [],
    })
  }

  it('counts a Sentry poll that has not finished as attention, and the banner priority uses that count', async () => {
    seed({ sentry_auto_import: true, sentry_auto_import_last_at: null })
    const data = await loadStats()
    expect(data.platformConnected).toBe(3)
    expect(data.platformDown).toBe(0)
    expect(data.platformHealthy).toBe(2)
    expect(data.platformAttention).toBe(1)
    expect(data.topPriority).toBe('attention')
    expect(data.topPriorityLabel).toMatch(/Sentry needs attention/)
  })

  it('counts a poll older than three 15-minute intervals as attention', async () => {
    seed({ sentry_auto_import: true, sentry_auto_import_last_at: staleAt })
    const data = await loadStats()
    expect(data.platformAttention).toBe(1)
    expect(data.topPriority).toBe('attention')
  })

  it('a poll that finished recently is working, so the attention count is zero', async () => {
    seed({ sentry_auto_import: true, sentry_auto_import_last_at: freshAt })
    const data = await loadStats()
    expect(data.platformAttention).toBe(0)
    expect(data.platformHealthy).toBe(3)
    expect(data.topPriority).toBe('healthy')
  })

  it('reads sentry_auto_import from the project row, ignoring a true value on effective settings', async () => {
    seed({ sentry_auto_import: false, sentry_auto_import_last_at: freshAt })
    effective.settings = { ...CONNECTED, sentry_auto_import: true }
    const data = await loadStats()
    expect(data.platformAttention).toBe(1)
    expect(data.topPriority).toBe('attention')
  })
})
