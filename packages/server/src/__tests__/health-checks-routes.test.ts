/**
 * FILE: health-checks-routes.test.ts
 * PURPOSE: GET /v1/admin/health-checks (plan-simplicity-2026-10 Phase 1, unit A):
 *            - one list per app from the existing checkers (setup gaps, SDK
 *              health, the report button, the server doctor narrowed to the
 *              app), problems first, with "Fix these first" and the count of
 *              items waiting on each root cause;
 *            - a source that fails or is slow gives `unknown` rows, never
 *              missing ones and never `problem`;
 *            - access: members only, and a project key reaches its own app only;
 *            - GET /v1/admin/setup-gaps keeps answering as before.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P1 = '2000000a-0000-4000-8000-000000000000'
const P2 = '2000000b-0000-4000-8000-000000000000'
const ORG = '4000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-29T05:00:00Z')

const state = vi.hoisted(() => ({
  db: null as unknown,
  accessible: [] as string[],
  auth: { method: 'jwt' as 'jwt' | 'apiKey', keyProject: null as string | null },
}))
const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/background.ts', () => ({ runInBackground: (task: Promise<unknown>) => void task.catch(() => {}) }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'u1')
    await next()
  },
  adminOrApiKey: () => async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', 'u1')
    c.set('authMethod', state.auth.method)
    if (state.auth.method === 'apiKey') c.set('projectId', state.auth.keyProject)
    await next()
  },
}))
vi.mock('../../supabase/functions/_shared/super-admin.ts', () => ({ SUPER_ADMIN_ROLE: 'super_admin', getUserRole: async () => null }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  enumerateAccessibleProjectIds: async () => state.accessible,
  ownedProjectIds: async () => [],
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) => c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  parseUuidParam: (c: { req: { param: (k: string) => string } }) => ({ ok: true, value: c.req.param('id') }),
  userCanAccessProject: async (_db: unknown, _u: string, id: string) => ({ allowed: state.accessible.includes(id), role: state.accessible.includes(id) ? 'owner' : null }),
}))

type Routes = typeof import('../../supabase/functions/api/routes/health-checks.ts')
let routes: Routes
let setupGaps: typeof import('../../supabase/functions/api/routes/setup-gaps.ts')

const sdk = { fails: false }
const doctorFails = { on: false }

function deps(): Parameters<Routes['registerHealthCheckRoutes']>[1] {
  const setup = {
    now: () => NOW,
    mintInstallation: async () => {
      throw new Error('no app')
    },
    resolvePat: async () => null,
    platformToken: () => null,
    githubGet: async () => ({ status: 200, scopes: null }),
    readDispatchers: (async () => [{ projectId: P1, autofixOn: true, server: { agentKeys: 0, offKeys: 1 } }]) as never,
  }
  return {
    now: () => NOW,
    setupGaps: setup as never,
    readSdkHealth: (async () => {
      if (sdk.fails) throw new Error('GitHub answered 502')
      return {
        ok: true,
        data: {
          problems: [{ id: 'csp_blocks_api', severity: 'error', title: 'Your site blocks Mushi', detail: 'connect-src does not allow the API.', fix: { kind: 'csp_task', label: 'File CSP task' } }],
          notes: [],
          installed: true,
          lastSeenAt: '2026-10-29T04:00:00Z',
          repoUrl: null,
          siteUrl: 'https://kensaur.us/glot-it',
          checkedAt: NOW.toISOString(),
        },
      }
    }) as never,
    runDoctorChecks: (async (_db: unknown, _u: string, opts: { projectIds?: string[] }) => {
      if (doctorFails.on) throw new Error('doctor down')
      expect(opts.projectIds).toHaveLength(1)
      return {
        status: 'warn',
        checks: [
          { name: 'recovery_token', status: 'pass', summary: 'ok' },
          { name: 'stranded_reports', status: 'pass', summary: 'No stranded reports.' },
          { name: 'dead_letter', status: 'warn', summary: '2 queue item(s) dead-lettered.', hint: 'Requeue them.' },
        ],
      }
    }) as never,
    readPipeline: (async () => ({
      stages: [
        {
          id: 'review',
          label: 'Reviewed',
          count: 24,
          stuck: 24,
          oldestAt: null,
          groups: [{ id: 'fix_first', stage: 'review', tone: 'stuck', label: '24 PRs: the review asked for changes', count: 24, oldestAt: null, actions: [], settings: null, items: [{ id: 'a1', projectId: P1 }] }],
        },
      ],
    })) as never,
  }
}

function seed() {
  return makeFakeDb({
    projects: [
      { id: P1, name: 'glot.it', organization_id: ORG, owner_id: 'u1' },
      { id: P2, name: 'yen-yen', organization_id: null, owner_id: 'u1' },
    ],
    project_repos: [],
    organizations: [{ id: ORG, review_followup_enabled: false, review_followup_off_reason: 'the Cursor key chosen for review follow-ups was deleted.' }],
    byok_keys: [],
    deploy_observations: [],
    project_settings: [{ project_id: P1, slack_bot_token_ref: null, sdk_config_enabled: true, sdk_widget_launcher: 'banner' }],
    integration_health_history: [],
    setup_gap_results: [],
  })
}

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  routes = await import('../../supabase/functions/api/routes/health-checks.ts')
  setupGaps = await import('../../supabase/functions/api/routes/setup-gaps.ts')
})

beforeEach(() => {
  state.db = seed()
  state.accessible = [P1, P2]
  state.auth = { method: 'jwt', keyProject: null }
  sdk.fails = false
  doctorFails.on = false
  setupGaps.clearSetupGapsCache()
  app = new Hono()
  routes.registerHealthCheckRoutes(app as never, deps())
})

async function get(path: string) {
  const res = await app.request(path)
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('GET /v1/admin/health-checks', () => {
  it('glot.it on 2026-10-29: the deleted follow-up key is the first root cause, with the 24 PRs waiting on it', async () => {
    const { status, json } = await get(`/v1/admin/health-checks?projectId=${P1}`)
    expect(status).toBe(200)
    const [p] = json.data.projects
    const ids = p.checks.map((c: { key: string }) => c.key)
    for (const id of ['review_followup_key', 'autofix_agent_key', 'deploy_events', 'slack_bot_token', 'github_access', 'csp_blocks_api', 'never_seen', 'banner_disabled', 'dead_letter', 'stranded_reports']) {
      expect(ids, id).toContain(id)
    }
    // Platform lines never reach an app's list.
    expect(ids).not.toContain('recovery_token')
    // Critical first, most waiting first; then the order the checkers list them (setup gaps first).
    expect(p.fixFirst.map((c: { id: string }) => c.id)).toEqual(['review_followup_key', 'github_access', 'autofix_agent_key'])
    expect(p.fixFirst[0]).toMatchObject({ affects: 24, status: 'problem', blocks: ['followups'] })
    expect(p.checks[0].status).toBe('problem')
    expect(json.data.pipelineRead).toBe(true)
  })

  it('a source that fails or times out gives unknown rows, never problem and never missing', async () => {
    sdk.fails = true
    doctorFails.on = true
    const { json } = await get(`/v1/admin/health-checks?projectId=${P1}`)
    const rows = json.data.projects[0].checks as Array<{ id: string; status: string; source: string }>
    const sdkRows = rows.filter((r) => r.source === 'sdk_health')
    // Eight SDK checks; "no repo" is setup gaps' github_access line here, kept once.
    expect(sdkRows).toHaveLength(7)
    expect(rows.filter((r) => r.id === 'github_access')).toHaveLength(1)
    expect(sdkRows.every((r) => r.status === 'unknown')).toBe(true)
    expect(rows.filter((r) => r.source === 'doctor').map((r) => [r.id, r.status])).toEqual([
      ['stranded_reports', 'unknown'],
      ['dead_letter', 'unknown'],
    ])
  })

  it('checks access first: an app the caller cannot open is a 404', async () => {
    state.accessible = [P2]
    expect((await get(`/v1/admin/health-checks?projectId=${P1}`)).status).toBe(404)
    expect((await get('/v1/admin/health-checks?projectId=nope')).status).toBe(400)
  })

  it('a project key reaches its own app only, even though its user owns both', async () => {
    state.auth = { method: 'apiKey', keyProject: P2 }
    expect((await get(`/v1/admin/health-checks?projectId=${P1}`)).status).toBe(404)
    const own = await get('/v1/admin/health-checks')
    expect(own.json.data.projects.map((p: { projectId: string }) => p.projectId)).toEqual([P2])
  })

  it('every app the caller can open, by name', async () => {
    const { json } = await get('/v1/admin/health-checks')
    expect(json.data.projects.map((p: { name: string }) => p.name)).toEqual(['glot.it', 'yen-yen'])
  })

  it('stores the setup-gaps answer it checked, so GET /v1/admin/setup-gaps answers the same lines', async () => {
    await get(`/v1/admin/health-checks?projectId=${P1}`)
    expect((state.db as FakeDb).table('setup_gap_results').some((r) => r.project_id === P1)).toBe(true)
    const gapsApp = new Hono()
    setupGaps.registerSetupGapsRoutes(gapsApp as never, deps()!.setupGaps)
    const res = await gapsApp.request(`/v1/admin/setup-gaps?projectId=${P1}`)
    const body = (await res.json()) as Record<string, any>
    expect(body.data.projects[0].gaps.map((g: { id: string }) => g.id)).toEqual(expect.arrayContaining(['review_followup_key', 'autofix_agent_key', 'deploy_events', 'slack_bot_token', 'github_access']))
  })
})
