/**
 * FILE: role-gated-writes.test.ts
 * PURPOSE: Writes that change credentials, money, data lifetime or who runs
 *          the org need an org owner or admin. Viewers (and, where noted,
 *          members) are refused and nothing is written; an admin still
 *          gets through. Real route modules on Hono, in-memory database.
 *
 *   integrations delete, Linear connect/disconnect, plugin writes, manual
 *   cron run, retention / legal hold, residency pin, spend cap, alert
 *   email, group merge, feature "Mark shipped", rewards writes, org owner
 *   demotion/removal, and the global console-help rebuild (super-admin).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const ORG = 'a0000000-0000-4000-8000-000000000001'
const P = 'a0000000-0000-4000-8000-0000000000aa'
const OWNER = 'c0000000-0000-4000-8000-000000000001'
const ADMIN = 'c0000000-0000-4000-8000-000000000002'
const MEMBER = 'c0000000-0000-4000-8000-000000000003'
const VIEWER = 'c0000000-0000-4000-8000-000000000004'
const OWNER2 = 'c0000000-0000-4000-8000-000000000005'
const G1 = 'e0000000-0000-4000-8000-000000000001'
const G2 = 'e0000000-0000-4000-8000-000000000002'
const TICKET = 'f0000000-0000-4000-8000-000000000001'

let db: FakeDb
let currentUser = OWNER
let superAdmins = new Set<string>()

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', currentUser)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/entitlements.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next() }
})
vi.mock('../../supabase/functions/_shared/ee-gate.ts', () => ({
  requireEeLicense: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { upserted: 3 } }), { status: 200 }))

let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const routes = await Promise.all([
    import('../../supabase/functions/api/routes/integrations.ts').then((m) => m.registerIntegrationsRoutes),
    import('../../supabase/functions/api/routes/plugins-marketplace.ts').then((m) => m.registerPluginsMarketplaceRoutes),
    import('../../supabase/functions/api/routes/health.ts').then((m) => m.registerHealthRoutes),
    import('../../supabase/functions/api/routes/admin-ops.ts').then((m) => m.registerAdminOpsRoutes),
    import('../../supabase/functions/api/routes/billing.ts').then((m) => m.registerBillingRoutes),
    import('../../supabase/functions/api/routes/query-fixes-repo.ts').then((m) => m.registerQueryFixesRepoRoutes),
    import('../../supabase/functions/api/routes/feature-board.ts').then((m) => m.registerFeatureBoardRoutes),
    import('../../supabase/functions/api/routes/organizations.ts').then((m) => m.registerOrganizationRoutes),
    import('../../supabase/functions/api/routes/rewards.ts').then((m) => m.registerRewardsRoutes),
    import('../../supabase/functions/api/routes/console-knowledge.ts').then((m) => m.registerConsoleKnowledgeRoutes),
  ])
  app = new Hono()
  for (const register of routes) register(app as never)
})

function seed() {
  db = makeFakeDb(
    {
      projects: [{ id: P, name: 'App', owner_id: OWNER, organization_id: ORG, data_residency_region: null }],
      organization_members: [
        { organization_id: ORG, user_id: OWNER, role: 'owner' },
        { organization_id: ORG, user_id: ADMIN, role: 'admin' },
        { organization_id: ORG, user_id: MEMBER, role: 'member' },
        { organization_id: ORG, user_id: VIEWER, role: 'viewer' },
        { organization_id: ORG, user_id: OWNER2, role: 'owner' },
      ],
      project_members: [],
      project_integrations: [{ project_id: P, integration_type: 'jira', config: { token: 'fake' }, is_active: true }],
      project_settings: [{ project_id: P, linear_access_token_ref: 'vault://fake', quota_alert_email: null }],
      project_plugins: [],
      project_retention_policies: [{ project_id: P, reports_retention_days: 365, legal_hold: true }],
      billing_subscriptions: [{ project_id: P, status: 'active', monthly_spend_cap_usd_override: 50 }],
      report_groups: [
        { id: G1, project_id: P, report_count: 1 },
        { id: G2, project_id: P, report_count: 1 },
      ],
      reports: [
        { id: 'r1', project_id: P, report_group_id: G1 },
        { id: 'r2', project_id: P, report_group_id: G2 },
      ],
      support_tickets: [
        { id: TICKET, project_id: P, category: 'feature', status: 'open', subject: 'Dark mode', shipped_at: null },
      ],
      reward_rules: [],
      reward_webhooks: [],
    },
    { autoId: true },
  )
  ;(db as unknown as { auth: unknown }).auth = {
    admin: {
      getUserById: async (id: string) => ({
        data: { user: { id, app_metadata: superAdmins.has(id) ? { role: 'super_admin' } : {} } },
        error: null,
      }),
    },
  }
}

beforeEach(() => {
  currentUser = OWNER
  superAdmins = new Set()
  seed()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function call(as: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  currentUser = as
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Mushi-Project-Id': P, 'X-Mushi-Org-Id': ORG, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  let json: Record<string, any> = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json }
}

const t = (name: string) => db.tables[name]

describe('integrations and Linear', () => {
  it('a viewer cannot delete a routing integration; an admin can', async () => {
    expect((await call(VIEWER, 'DELETE', '/v1/admin/integrations/jira')).status).toBe(403)
    expect(t('project_integrations')).toHaveLength(1)
    expect((await call(ADMIN, 'DELETE', '/v1/admin/integrations/jira')).status).toBe(200)
    expect(t('project_integrations')).toHaveLength(0)
  })

  it('a member cannot disconnect Linear or start a Linear connect', async () => {
    expect((await call(MEMBER, 'DELETE', '/v1/admin/linear-oauth/disconnect')).status).toBe(403)
    expect(t('project_settings')[0].linear_access_token_ref).toBe('vault://fake')
    expect((await call(MEMBER, 'GET', '/v1/admin/linear-oauth/authorize')).status).toBe(403)
  })

  it('an admin can disconnect Linear', async () => {
    expect((await call(ADMIN, 'DELETE', '/v1/admin/linear-oauth/disconnect')).status).toBe(200)
    expect(t('project_settings')[0].linear_access_token_ref).toBeNull()
  })
})

describe('plugins', () => {
  it('a member cannot install, change, uninstall or test a plugin', async () => {
    const install = await call(MEMBER, 'POST', '/v1/admin/plugins', { pluginSlug: 'webhook', webhookUrl: 'https://example.com/h' })
    expect(install.status).toBe(403)
    expect(install.json.error.message).toContain('plugins')
    expect((await call(MEMBER, 'PATCH', '/v1/admin/plugins/webhook', { isActive: false })).status).toBe(403)
    expect((await call(MEMBER, 'DELETE', '/v1/admin/plugins/webhook')).status).toBe(403)
    expect((await call(MEMBER, 'POST', '/v1/admin/plugins/webhook/test-event', {})).status).toBe(403)
    expect(t('project_plugins')).toHaveLength(0)
  })

  it('an admin gets past the role check', async () => {
    const res = await call(ADMIN, 'DELETE', '/v1/admin/plugins/webhook')
    expect(res.status).not.toBe(403)
  })
})

describe('manual cron run', () => {
  it('a member cannot run an LLM job by hand; an admin can', async () => {
    const denied = await call(MEMBER, 'POST', '/v1/admin/health/cron/judge-batch/trigger')
    expect(denied.status).toBe(403)
    expect(denied.json.error.message).toBe('Only organization owners and admins can run jobs by hand.')
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await call(ADMIN, 'POST', '/v1/admin/health/cron/judge-batch/trigger')).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('compliance', () => {
  it('a viewer cannot lift a legal hold or shorten retention', async () => {
    const res = await call(VIEWER, 'PUT', `/v1/admin/compliance/retention/${P}`, { legal_hold: false, reports_retention_days: 1 })
    expect(res.status).toBe(403)
    expect(t('project_retention_policies')[0]).toMatchObject({ legal_hold: true, reports_retention_days: 365 })
  })

  it('an admin can change retention', async () => {
    const res = await call(ADMIN, 'PUT', `/v1/admin/compliance/retention/${P}`, { reports_retention_days: 90 })
    expect(res.status).toBe(200)
    expect(t('project_retention_policies')[0].reports_retention_days).toBe(90)
  })

  it('a member cannot pin a data region', async () => {
    expect((await call(MEMBER, 'PUT', `/v1/admin/residency/${P}`, { region: 'eu' })).status).toBe(403)
    expect(t('projects')[0].data_residency_region).toBeNull()
  })

  it('an admin gets past the residency role check', async () => {
    expect((await call(ADMIN, 'PUT', `/v1/admin/residency/${P}`, { region: 'eu' })).status).not.toBe(403)
  })
})

describe('billing', () => {
  it('a viewer cannot change the spend cap or the alert email', async () => {
    expect((await call(VIEWER, 'PUT', '/v1/admin/billing/spend-cap', { project_id: P, spend_cap_usd: 100000 })).status).toBe(403)
    expect(t('billing_subscriptions')[0].monthly_spend_cap_usd_override).toBe(50)
    expect((await call(VIEWER, 'PUT', '/v1/admin/billing/alert-email', { project_id: P, alert_email: 'x@example.com' })).status).toBe(403)
    expect(t('project_settings')[0].quota_alert_email).toBeNull()
  })

  it('an admin can change the spend cap', async () => {
    expect((await call(ADMIN, 'PUT', '/v1/admin/billing/spend-cap', { project_id: P, spend_cap_usd: 80 })).status).toBe(200)
    expect(t('billing_subscriptions')[0].monthly_spend_cap_usd_override).toBe(80)
  })
})

describe('group merge', () => {
  it('a viewer cannot merge groups and both groups survive', async () => {
    expect((await call(VIEWER, 'POST', `/v1/admin/groups/${G1}/merge`, { targetGroupId: G2 })).status).toBe(403)
    expect(t('report_groups')).toHaveLength(2)
    expect(t('reports').find((r) => r.id === 'r1')!.report_group_id).toBe(G1)
  })

  it('a member can merge groups', async () => {
    expect((await call(MEMBER, 'POST', `/v1/admin/groups/${G1}/merge`, { targetGroupId: G2 })).status).toBe(200)
    expect(t('report_groups').map((g) => g.id)).toEqual([G2])
    expect(t('reports').every((r) => r.report_group_id === G2)).toBe(true)
  })
})

describe('feature board: Mark shipped', () => {
  it('a member cannot mark a request shipped', async () => {
    const res = await call(MEMBER, 'POST', `/v1/admin/feature-board/${TICKET}/ship?project_id=${P}`, { note: 'done' })
    expect(res.status).toBe(403)
    expect(t('support_tickets')[0]).toMatchObject({ status: 'open', shipped_at: null })
  })

  it('an admin can mark a request shipped', async () => {
    const res = await call(ADMIN, 'POST', `/v1/admin/feature-board/${TICKET}/ship?project_id=${P}`, { note: 'done' })
    expect(res.status).toBe(200)
    expect(t('support_tickets')[0].status).toBe('resolved')
  })
})

describe('rewards writes', () => {
  it('a viewer cannot change rules, webhooks, points or tiers', async () => {
    for (const [method, path, body] of [
      ['PUT', '/v1/admin/rewards/rules', { rules: [] }],
      ['POST', '/v1/admin/rewards/webhooks', { url: 'https://example.com/h' }],
      ['POST', '/v1/admin/rewards/bonus-points', { end_user_id: 'x', points: 100 }],
      ['POST', '/v1/admin/rewards/set-tier', { end_user_id: 'x', tier: 'legend' }],
      ['POST', '/v1/admin/rewards/presets/apply', {}],
    ] as const) {
      const res = await call(VIEWER, method, path, body)
      expect(res.status, path).toBe(403)
    }
    expect(t('reward_rules')).toHaveLength(0)
    expect(t('reward_webhooks')).toHaveLength(0)
  })

  it('an admin gets past the role check (an empty body is then a validation error, not a 403)', async () => {
    const res = await call(ADMIN, 'PUT', '/v1/admin/rewards/rules', {})
    expect(res.status).not.toBe(403)
  })
})

describe('organization owners', () => {
  it('an admin cannot demote an owner or remove one', async () => {
    expect((await call(ADMIN, 'PATCH', `/v1/org/${ORG}/members/${OWNER2}`, { role: 'viewer' })).status).toBe(403)
    expect((await call(ADMIN, 'DELETE', `/v1/org/${ORG}/members/${OWNER2}`)).status).toBe(403)
    expect(t('organization_members').find((m) => m.user_id === OWNER2)!.role).toBe('owner')
  })

  it('an admin can still change a member, and an owner can change another owner', async () => {
    expect((await call(ADMIN, 'PATCH', `/v1/org/${ORG}/members/${MEMBER}`, { role: 'viewer' })).status).toBe(200)
    expect(t('organization_members').find((m) => m.user_id === MEMBER)!.role).toBe('viewer')
    expect((await call(OWNER, 'PATCH', `/v1/org/${ORG}/members/${OWNER2}`, { role: 'admin' })).status).toBe(200)
    expect(t('organization_members').find((m) => m.user_id === OWNER2)!.role).toBe('admin')
  })
})

describe('console help index rebuild', () => {
  it('a signed-in user who is not a super-admin gets the opaque 404 and no build runs', async () => {
    expect((await call(OWNER, 'POST', '/v1/admin/console-knowledge/rebuild', {})).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a super-admin can rebuild', async () => {
    superAdmins.add(ADMIN)
    ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'http://fake.local' : 'fake-key') } }
    try {
      expect((await call(ADMIN, 'POST', '/v1/admin/console-knowledge/rebuild', {})).status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
    }
  })
})
