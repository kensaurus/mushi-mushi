/**
 * One setup step list (_shared/setup-steps.ts) behind every route that counts
 * setup steps.
 *
 * The routes carried six copies of the list and disagreed on whether the SDK
 * step is required: /v1/admin/setup, the dashboard and ingest-setup said 4,
 * the activation builders said 3, so the console showed "3 of 4" beside
 * "ready, 3/3" (mushi-demo, 2026-10-26) and patched the counts client-side.
 * Each route is exercised here against the real module, and for the same
 * project state every one must report the shared table's required total and
 * the same required-complete count and done flag.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'
import {
  REQUIRED_SETUP_STEPS,
  SETUP_OPTIONAL_TOTAL,
  SETUP_REQUIRED_TOTAL,
  SETUP_STEPS,
  SETUP_STEPS_TOTAL,
  requiredSetupProgress,
  setupStepCounts,
} from '../../supabase/functions/_shared/setup-steps.ts'

const P = '1000000c-0000-4000-8000-000000000000'
const USER = '2000000c-0000-4000-8000-000000000000'

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
    c.set('projectId', P)
    c.set('projectName', 'Demo')
    await next()
  }
  return {
    jwtAuth: pass,
    apiKeyAuth: pass,
    adminOrApiKey: () => pass,
    requireApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
    getOrgIdFromContext: () => null,
  }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/agent-credits-load.ts', () => ({
  loadFixAgentCheck: async () => ({ ready: false, label: 'Fix agent key' }),
}))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const project = { id: P, name: 'Demo', owner_id: USER, organization_role: 'owner' }
  return {
    ...actual,
    callerProjectIds: async () => [P],
    enumerateAccessibleProjectIds: async () => [P],
    scopedOwnedProjectIds: async () => [P],
    ownedProjectIds: async () => [P],
    callerCanAccessProject: async () => ({ allowed: true }),
    resolveOwnedProject: async () => ({ project, explicit: true }),
  }
})

let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const [{ registerOnboardingSetupRoutes }, { registerActivationRoutes }, { registerDashboardRoutes }, { registerSyncRoutes }, { registerReportsRoutes }] =
    await Promise.all([
      import('../../supabase/functions/api/routes/onboarding-setup.ts'),
      import('../../supabase/functions/api/routes/activation.ts'),
      import('../../supabase/functions/api/routes/dashboard.ts'),
      import('../../supabase/functions/api/routes/sync.ts'),
      import('../../supabase/functions/api/routes/reports.ts'),
    ])
  app = new Hono()
  registerOnboardingSetupRoutes(app as never)
  registerActivationRoutes(app as never)
  registerDashboardRoutes(app as never)
  registerSyncRoutes(app as never)
  registerReportsRoutes(app as never)
})

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

/** A project state: which required signals hold. */
interface Scenario {
  name: string
  key: boolean
  sdk: boolean
  report: boolean
}

const SCENARIOS: Scenario[] = [
  { name: 'nothing but the project', key: false, sdk: false, report: false },
  { name: 'key minted, no SDK, no report', key: true, sdk: false, report: false },
  // The split that started this: a test report reaches a diagnosis without the SDK.
  { name: 'key and a test report, SDK never seen', key: true, sdk: false, report: true },
  { name: 'SDK checked in, no report yet', key: true, sdk: true, report: false },
  { name: 'every required step done', key: true, sdk: true, report: true },
]

function seed(s: Scenario) {
  const keys: Row[] = []
  if (s.key) {
    keys.push({
      id: 'k1',
      project_id: P,
      is_active: true,
      label: 'app',
      scopes: ['report:write'],
      // A key that never checked in has no heartbeat; a checked-in SDK key does.
      last_seen_at: s.sdk ? minutesAgo(1) : null,
      last_seen_origin: s.sdk ? 'https://app.example' : null,
      last_seen_user_agent: null,
      last_seen_endpoint_host: s.sdk ? 'localhost' : null,
      created_at: minutesAgo(60),
    })
  }
  const reports: Row[] = s.report
    ? [
        {
          id: 'r1',
          project_id: P,
          status: 'classified',
          severity: 'low',
          environment: 'production',
          created_at: minutesAgo(5),
          custom_metadata: null,
          reporter_token_hash: 'rk1_1',
          stage1_classification: { category: 'bug' },
        },
      ]
    : []
  db = makeFakeDb(
    {
      projects: [{ id: P, name: 'Demo', slug: 'demo', created_at: minutesAgo(120), organization_id: null, owner_id: USER }],
      project_api_keys: keys,
      reports,
      fix_attempts: [],
      project_settings: [],
      project_repos: [],
      byok_keys: [],
      qa_stories: [],
      llm_invocations: [],
      classification_evaluations: [],
      project_codebase_files: [],
    },
    { rpc: () => null },
  )
}

async function get(path: string): Promise<Record<string, any>> {
  const res = await app.request(`http://localhost${path}`)
  const body = (await res.json()) as { ok: boolean; data: Record<string, any> }
  expect(res.status, `${path} answered ${res.status}: ${JSON.stringify(body)}`).toBe(200)
  expect(body.ok).toBe(true)
  return body.data
}

describe('the shared setup step table', () => {
  it('requires exactly project, key, SDK and first report, in that order', () => {
    expect(REQUIRED_SETUP_STEPS.map((s) => s.id)).toEqual([
      'project_created',
      'api_key_generated',
      'sdk_installed',
      'first_report_received',
    ])
    expect(SETUP_REQUIRED_TOTAL).toBe(4)
    expect(SETUP_STEPS_TOTAL).toBe(SETUP_STEPS.length)
    expect(SETUP_OPTIONAL_TOTAL).toBe(SETUP_STEPS.length - 4)
  })

  it('has unique step ids', () => {
    const ids = SETUP_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names the first missing required step as next', () => {
    expect(requiredSetupProgress({ hasKey: true, hasSdk: false, reportCount: 3 }).next?.id).toBe('sdk_installed')
    expect(requiredSetupProgress({ hasKey: true, hasSdk: true, reportCount: 1 }).next).toBeNull()
  })
})

describe('every setup route counts the same steps', () => {
  for (const s of SCENARIOS) {
    it(s.name, async () => {
      seed(s)
      const expected = requiredSetupProgress({ hasKey: s.key, hasSdk: s.sdk, reportCount: s.report ? 1 : 0 })
      const all = setupStepCounts({
        hasKey: s.key,
        hasSdk: s.sdk,
        reportCount: s.report ? 1 : 0,
        hasGithub: false,
        hasSentry: false,
        hasByok: false,
        hasSlack: false,
        fixCount: 0,
        hasQaPassing: false,
      })

      const setup = await get('/v1/admin/setup')
      const project = setup.projects[0]
      expect(project.steps.map((x: { id: string }) => x.id)).toEqual(SETUP_STEPS.map((x) => x.id))
      expect(project.required_total).toBe(SETUP_REQUIRED_TOTAL)
      expect(project.required_complete).toBe(expected.requiredComplete)
      expect(project.done).toBe(expected.setupDone)
      expect(project.total).toBe(SETUP_STEPS_TOTAL)
      expect(project.complete).toBe(all.stepsComplete)

      const stats = await get('/v1/admin/onboarding/stats')
      expect(stats.requiredTotal).toBe(SETUP_REQUIRED_TOTAL)
      expect(stats.requiredComplete).toBe(expected.requiredComplete)
      expect(stats.setupDone).toBe(expected.setupDone)
      expect(stats.nextStepId).toBe(expected.next?.id ?? null)
      expect(stats.stepsTotal).toBe(SETUP_STEPS_TOTAL)
      expect(stats.optionalTotal).toBe(SETUP_OPTIONAL_TOTAL)

      // The activation cockpit's two blocks used to disagree with each other.
      const activation = await get(`/v1/admin/activation?project_id=${P}`)
      expect(activation.setup).toEqual(setup)
      expect(activation.stats.requiredTotal).toBe(SETUP_REQUIRED_TOTAL)
      expect(activation.stats.requiredComplete).toBe(expected.requiredComplete)
      expect(activation.stats.setupDone).toBe(expected.setupDone)
      expect(activation.stats.nextStepId).toBe(expected.next?.id ?? null)
      expect(activation.stats.stepsTotal).toBe(SETUP_STEPS_TOTAL)

      for (const path of ['/v1/admin/dashboard/stats', '/v1/admin/inbox/stats']) {
        const d = await get(path)
        expect(d.requiredTotal, path).toBe(SETUP_REQUIRED_TOTAL)
        expect(d.requiredComplete, path).toBe(expected.requiredComplete)
        expect(d.setupDone, path).toBe(expected.setupDone)
      }

      const reportStats = await get('/v1/admin/reports/stats')
      expect(reportStats.setupDone).toBe(expected.setupDone)

      // CLI `mushi doctor` and MCP `diagnose_setup` read this one.
      for (const path of ['/v1/sync/ingest-setup', `/v1/admin/projects/${P}/ingest-setup`]) {
        const ingest = await get(path)
        expect(ingest.required_total, path).toBe(SETUP_REQUIRED_TOTAL)
        expect(ingest.required_complete, path).toBe(expected.requiredComplete)
        expect(ingest.ready, path).toBe(expected.setupDone)
        expect(ingest.steps.map((x: { id: string }) => x.id)).toEqual(REQUIRED_SETUP_STEPS.map((x) => x.id))
        for (const step of ingest.steps) {
          expect(Object.keys(step).sort()).toEqual(['complete', 'hint', 'id', 'label', 'required'])
          expect(step.required).toBe(true)
        }
      }
    })
  }
})
