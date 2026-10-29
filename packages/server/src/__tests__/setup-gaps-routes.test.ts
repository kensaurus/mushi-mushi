/**
 * FILE: setup-gaps-routes.test.ts
 * PURPOSE: GET /v1/admin/setup-gaps and the doctor's platform checks
 *          (console ops plan 2026-10-27, P1):
 *            - access is checked before the cache, and the cache holds for
 *              10 minutes (a refresh re-checks after a minute);
 *            - every check returns a line; a failing read is `unknown`;
 *            - GitHub is probed with reads only, through the App's mint, a
 *              classic token's scopes or a fine-grained token's reads;
 *            - platform secrets never reach the app route, and the doctor
 *              shows them to super-admins only, as present or missing.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const ORG = '4000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-27T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600_000).toISOString()

const state = vi.hoisted(() => ({
  db: null as unknown,
  accessible: [] as string[],
  role: null as string | null,
  env: {} as Record<string, string>,
  tasks: [] as Promise<unknown>[],
}))
const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/background.ts', () => ({
  runInBackground: (task: Promise<unknown>) => {
    state.tasks.push(task)
  },
}))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'u1')
    await next()
  },
  adminOrApiKey: () => async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'u1')
    await next()
  },
}))
vi.mock('../../supabase/functions/_shared/super-admin.ts', () => ({ SUPER_ADMIN_ROLE: 'super_admin', getUserRole: async () => state.role }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  enumerateAccessibleProjectIds: async () => state.accessible,
  ownedProjectIds: async () => [],
  userCanAccessProject: async (_db: unknown, _u: string, id: string) => ({ allowed: state.accessible.includes(id), role: state.accessible.includes(id) ? 'owner' : null }),
}))

type Routes = typeof import('../../supabase/functions/api/routes/setup-gaps.ts')
let routes: Routes
let doctor: typeof import('../../supabase/functions/api/routes/doctor.ts')

const calls = { github: [] as string[], mint: 0, dispatch: 0 }
const gh = {
  scopes: null as string | null,
  status: {} as Record<string, number>,
  mint: null as null | { token: string; permissions: Record<string, string> | null },
  pat: 'pat-token' as string | null,
  platform: null as string | null,
}
let dispatcher: Array<{ projectId: string; autofixOn: boolean; server: { agentKeys: number; offKeys: number } }> | null = []

function deps(): Parameters<Routes['registerSetupGapsRoutes']>[1] {
  return {
    now: () => NOW,
    mintInstallation: async () => {
      calls.mint++
      if (!gh.mint) throw new Error('mint failed')
      return gh.mint
    },
    resolvePat: async () => gh.pat,
    platformToken: () => gh.platform,
    githubGet: async (_token: string, path: string) => {
      calls.github.push(path)
      const key = Object.keys(gh.status).find((k) => path.endsWith(k))
      return { status: key ? gh.status[key] : 200, scopes: gh.scopes }
    },
    readDispatchers: (async () => {
      calls.dispatch++
      return dispatcher
    }) as never,
  }
}

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => state.env[k] } }
  routes = await import('../../supabase/functions/api/routes/setup-gaps.ts')
  doctor = await import('../../supabase/functions/api/routes/doctor.ts')
})

function seed(over: Record<string, Array<Record<string, unknown>>> = {}): FakeDb {
  return makeFakeDb({
    projects: [
      { id: P1, name: 'glot.it', organization_id: ORG, owner_id: 'u1' },
      { id: P2, name: 'yen-yen', organization_id: null, owner_id: 'u1' },
    ],
    project_repos: [{ project_id: P1, repo_url: 'https://github.com/kensaurus/glot.it', github_app_installation_id: 42, is_primary: true }],
    organizations: [{ id: ORG, review_followup_enabled: false, review_followup_off_reason: 'The Cursor key it used was deleted.' }],
    byok_keys: [],
    deploy_observations: [{ project_id: P1, observed_at: daysAgo(20) }],
    project_settings: [{ project_id: P1, slack_bot_token_ref: 'vault-1' }],
    integration_health_history: [{ project_id: P1, kind: 'slack', status: 'down', message: 'Slack auth.test error: invalid_auth', checked_at: daysAgo(0.01) }],
    ...over,
  })
}

beforeEach(() => {
  state.db = seed()
  state.accessible = [P1, P2]
  state.role = null
  state.env = { SLACK_CLIENT_ID: 'id' }
  state.tasks = []
  calls.github = []
  calls.mint = 0
  calls.dispatch = 0
  gh.scopes = null
  gh.status = {}
  gh.mint = { token: 'app-token', permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' } }
  gh.pat = 'pat-token'
  gh.platform = null
  dispatcher = [{ projectId: P1, autofixOn: true, server: { agentKeys: 0, offKeys: 1 } }]
  routes.clearSetupGapsCache()
  app = new Hono()
  routes.registerSetupGapsRoutes(app as never, deps())
  doctor.registerDoctorRoutes(app as never)
})

async function get(path: string) {
  const res = await app.request(path)
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}
const byId = (gaps: Array<{ id: string }>) => new Map(gaps.map((g) => [g.id, g as Record<string, any>]))

describe('GET /v1/admin/setup-gaps', () => {
  it('glot.it on 2026-10-27: every app-owner check has a line, gaps first', async () => {
    const res = await get(`/v1/admin/setup-gaps?projectId=${P1}`)
    expect(res.status).toBe(200)
    const gaps = res.json.data.projects[0].gaps as Array<{ id: string; status: string; audience: string }>
    const m = byId(gaps)
    expect(m.get('github_access:kensaurus/glot.it')).toMatchObject({ status: 'gap', summary: expect.stringContaining("can't re-run CI") })
    expect(m.get('review_followup_key')).toMatchObject({ status: 'gap', summary: expect.stringContaining('The Cursor key it used was deleted.') })
    expect(m.get('autofix_agent_key')!.status).toBe('gap')
    expect(m.get('deploy_events')).toMatchObject({ status: 'gap', summary: expect.stringContaining('20 days') })
    expect(m.get('slack_bot_token')).toMatchObject({ status: 'gap', summary: expect.stringContaining('invalid_auth') })
    expect(gaps.every((g) => g.audience === 'app_owner')).toBe(true)
    expect(gaps.some((g) => g.id.startsWith('platform_'))).toBe(false)
    expect(res.json.data.counts.gap).toBe(5)
    expect(res.json.data.projects[0].checkedAt).toBe(NOW.toISOString())
  })

  it('checks access first: an app the caller cannot open is a 404, and nothing is probed', async () => {
    state.accessible = [P2]
    const res = await get(`/v1/admin/setup-gaps?projectId=${P1}`)
    expect(res.status).toBe(404)
    expect(calls.github).toEqual([])
    expect((await get('/v1/admin/setup-gaps?projectId=nope')).status).toBe(400)
  })

  it('caches each app for 10 minutes; refresh=1 re-checks only after a minute', async () => {
    await get(`/v1/admin/setup-gaps?projectId=${P1}`)
    const first = calls.mint
    await get(`/v1/admin/setup-gaps?projectId=${P1}`)
    await get(`/v1/admin/setup-gaps?projectId=${P1}&refresh=1`)
    expect(calls.mint).toBe(first)
  })

  it('stores each fresh answer, so another isolate can serve it', async () => {
    await get(`/v1/admin/setup-gaps?projectId=${P1}`)
    const rows = (state.db as FakeDb).table('setup_gap_results')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ project_id: P1, checked_at: NOW.toISOString() })
  })

  it('a stored answer under 10 minutes old is served without asking GitHub (sweep #37)', async () => {
    const stored = { projectId: P1, name: 'glot.it', checkedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(), gaps: [{ id: 'stored', status: 'ok' }] }
    state.db = seed({ setup_gap_results: [{ project_id: P1, value: stored, checked_at: stored.checkedAt }] })
    const { json } = await get(`/v1/admin/setup-gaps?projectId=${P1}`)
    expect(calls.mint).toBe(0)
    expect(calls.github).toEqual([])
    expect(json.data.projects[0].gaps).toEqual([{ id: 'stored', status: 'ok' }])
  })

  it('an older stored answer is shown at once and re-checked in the background, which stores the new one', async () => {
    const old = new Date(NOW.getTime() - 2 * 3600_000).toISOString()
    state.db = seed({ setup_gap_results: [{ project_id: P1, value: { projectId: P1, name: 'glot.it', checkedAt: old, gaps: [{ id: 'old', status: 'ok' }] }, checked_at: old }] })
    const { json } = await get(`/v1/admin/setup-gaps?projectId=${P1}`)
    expect(json.data.projects[0].gaps).toEqual([{ id: 'old', status: 'ok' }])
    expect(state.tasks).toHaveLength(1)
    await Promise.all(state.tasks)
    expect(calls.mint).toBe(1)
    const row = (state.db as FakeDb).table('setup_gap_results')[0] as { checked_at: string; value: { gaps: unknown[] } }
    expect(row.checked_at).toBe(NOW.toISOString())
    expect(row.value.gaps.length).toBeGreaterThan(1)
  })

  it('refresh=1 ignores the stored answer and checks live', async () => {
    const recent = new Date(NOW.getTime() - 5 * 60_000).toISOString()
    state.db = seed({ setup_gap_results: [{ project_id: P1, value: { projectId: P1, name: 'glot.it', checkedAt: recent, gaps: [] }, checked_at: recent }] })
    await get(`/v1/admin/setup-gaps?projectId=${P1}&refresh=1`)
    expect(calls.mint).toBe(1)
  })

  it('every app the caller can open, with no repo and no organization as their own lines', async () => {
    const res = await get('/v1/admin/setup-gaps')
    const names = res.json.data.projects.map((p: { name: string }) => p.name)
    expect(names).toEqual(['glot.it', 'yen-yen'])
    const yen = byId(res.json.data.projects[1].gaps)
    expect(yen.get('github_access')!.summary).toContain('No GitHub repo is connected')
    expect(yen.get('review_followup_key')!.status).toBe('ok')
    expect(yen.get('autofix_agent_key')!.status).toBe('unknown')
    expect(yen.get('deploy_events')!.summary).toContain('never seen a deploy')
    expect(yen.get('slack_bot_token')!.summary).toBe('Slack is not connected (optional).')
  })

  it('a stored classic token: reads its scopes from one GET; a fine-grained one is probed with reads only', async () => {
    gh.mint = null
    gh.scopes = 'repo, workflow'
    let m = byId((await get(`/v1/admin/setup-gaps?projectId=${P1}`)).json.data.projects[0].gaps)
    expect(m.get('github_access:kensaurus/glot.it')).toMatchObject({ status: 'ok', summary: expect.stringContaining('Your GitHub token') })
    expect(calls.github).toEqual(['/repos/kensaurus/glot.it'])

    // A second, independent check: no cached or stored answer from the first.
    routes.clearSetupGapsCache()
    state.db = seed()
    calls.github = []
    gh.scopes = null
    gh.status = { '/actions/secrets/public-key': 403 }
    m = byId((await get(`/v1/admin/setup-gaps?projectId=${P1}`)).json.data.projects[0].gaps)
    expect(m.get('github_access:kensaurus/glot.it')).toMatchObject({ status: 'unknown', summary: expect.stringContaining('it never writes to check') })
    expect(calls.github.every((p) => !/merges|dispatches|rerun/.test(p))).toBe(true)
    expect(calls.github).toContain('/repos/kensaurus/glot.it/actions/secrets/public-key')
  })

  it("never probes a tenant's repo with Mushi's own fallback token", async () => {
    gh.mint = null
    gh.pat = null
    gh.platform = 'platform-token'
    const m = byId((await get(`/v1/admin/setup-gaps?projectId=${P1}`)).json.data.projects[0].gaps)
    expect(m.get('github_access:kensaurus/glot.it')).toMatchObject({ status: 'unknown', summary: expect.stringContaining('no GitHub token of its own') })
    expect(calls.github).toEqual([])
  })

  it('a read that fails is an unknown line, never a missing one', async () => {
    const db = seed()
    const from = db.from.bind(db)
    db.from = ((name: string) => {
      if (name === 'deploy_observations') throw new Error('connection reset')
      if (name === 'project_repos') throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
      return from(name)
    }) as never
    state.db = db
    const m = byId((await get(`/v1/admin/setup-gaps?projectId=${P1}`)).json.data.projects[0].gaps)
    // A statement timeout reads in plain words, never as the raw Postgres text.
    expect(m.get('deploy_events')).toMatchObject({ status: 'unknown', summary: expect.stringContaining('connection reset') })
    expect(m.get('github_access')).toMatchObject({ status: 'unknown', summary: "Mushi could not read this app's repos (the database was too slow to answer; try again in a minute)." })
  })
})

describe('GET /v1/admin/doctor platform checks', () => {
  it('an app owner never sees them', async () => {
    const res = await get('/v1/admin/doctor')
    expect(res.status).toBe(200)
    expect(res.json.data.checks.some((c: { name: string }) => c.name.startsWith('platform_'))).toBe(false)
  })

  it('a super-admin sees each secret group as present or missing, never a value', async () => {
    state.role = 'super_admin'
    state.env = { SLACK_CLIENT_ID: 'secret-id-value', LINEAR_OAUTH_CLIENT_ID: 'l', LINEAR_OAUTH_CLIENT_SECRET: 'm' }
    const res = await get('/v1/admin/doctor')
    const checks = byId(res.json.data.checks.map((c: { name: string }) => ({ ...c, id: c.name })))
    expect(checks.get('platform_slack_oauth')).toMatchObject({ status: 'fail', summary: expect.stringContaining('SLACK_CLIENT_SECRET is not set') })
    expect(checks.get('platform_slack_oauth')!.hint).toContain('docs/operators/platform-setup-checks.md')
    expect(checks.get('platform_linear_oauth')!.status).toBe('pass')
    expect(JSON.stringify(res.json)).not.toContain('secret-id-value')
  })
})
