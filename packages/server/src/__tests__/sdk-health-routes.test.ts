/**
 * FILE: sdk-health-routes.test.ts
 * PURPOSE: GET /sdk-health and POST /sdk-health/tasks: a failed GitHub or site
 *          read is a note (never a 500, never "all good"); the heartbeat counts
 *          SDK keys only; a task is one classified 'sdk_health' report, filed
 *          once per kind; viewers cannot file; a refused insert is an error.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000e-0000-4000-8000-000000000000'
const USER = '2000000e-0000-4000-8000-000000000000'
const SITE = 'https://lets-talk.kensaur.us/'

const pkg = (deps: Record<string, string>, devDeps: Record<string, string> = {}) => JSON.stringify({ dependencies: deps, devDependencies: devDeps })

const state = vi.hoisted(() => ({
  role: 'owner' as string,
  repo: true,
  files: {} as Record<string, string>,
  tree: [] as string[],
  treeFails: false,
  secretNames: [] as string[] | Error,
  csp: null as string | null,
  siteFails: false,
  siteStatus: 200,
}))
let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    await next()
  },
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, userCanAccessProject: async () => ({ allowed: true, role: state.role }) }
})
vi.mock('../../supabase/functions/_shared/recipe-github.ts', () => {
  const repo = { ref: { owner: 'kensaurus', repo: 'lets-talk' }, token: 't', repoUrl: 'https://github.com/kensaurus/lets-talk', defaultBranchHint: 'main' }
  return {
    resolveRecipeRepo: async () => (state.repo ? { ok: true, repo } : { ok: false, repoConnected: false, tokenAvailable: false, reason: 'No primary GitHub repo is connected to this project.' }),
    getDefaultHead: async () => ({ branch: 'main', sha: 'abcdef1234567890' }),
    listTree: async () => {
      if (state.treeFails) throw new Error('could not list the repo tree (502)')
      return { entries: [...Object.keys(state.files), ...state.tree].map((path) => ({ path, size: 1, sha: 'x' })), truncated: false }
    },
    readBlobsGraphql: async (_r: unknown, _s: string, paths: string[]) => new Map(paths.map((p) => [p, state.files[p] ?? null])),
    listActionsNames: async () => {
      if (state.secretNames instanceof Error) throw state.secretNames
      return state.secretNames
    },
  }
})
vi.mock('../../supabase/functions/_shared/safe-fetch.ts', () => ({
  publicFetch: async (url: string) => {
    if (state.siteFails) throw new Error('timed out')
    const headers = new Headers(state.csp ? { 'content-security-policy': state.csp } : {})
    return { status: state.siteStatus, headers, finalUrl: url, text: '<html></html>', truncated: false }
  },
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => ({ SUPABASE_URL: 'https://dxptnwrhwsqckaftyymj.supabase.co' })[k] } }
  const { registerSdkHealthRoutes } = await import('../../supabase/functions/api/routes/sdk-health.ts')
  app = new Hono()
  registerSdkHealthRoutes(app as never)
})

function seed(over: Record<string, Array<Record<string, unknown>>> = {}) {
  db = makeFakeDb(
    {
      projects: [{ id: P, name: 'lets-talk', slug: 'lets-talk' }],
      project_api_keys: [],
      sdk_versions: [
        { package: '@mushi-mushi/web', version: '1.33.1' },
        { package: '@mushi-mushi/web', version: '1.9.0' },
        { package: '@mushi-mushi/web', version: '1.40.0-beta.1' },
      ],
      app_recipe_snapshots: [],
      site_watches: [{ project_id: P, base_url: SITE }],
      site_audits: [],
      reports: [],
      ...over,
    },
    { autoId: true },
  )
}

beforeEach(() => {
  state.role = 'owner'
  state.repo = true
  state.files = { 'package.json': pkg({ react: '19.0.0' }, { vite: '7.0.0' }) }
  state.tree = ['.github/workflows/deploy.yml', 'src/main.tsx']
  state.treeFails = false
  state.secretNames = []
  state.csp = "default-src 'self'; connect-src 'self'"
  state.siteFails = false
  state.siteStatus = 200
  seed()
})

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

const HEALTH = `/v1/admin/projects/${P}/sdk-health`
const TASKS = `${HEALTH}/tasks`
const ids = (json: Record<string, any>) => (json.data.problems as Array<{ id: string }>).map((p) => p.id)

describe('GET /sdk-health', () => {
  it('lets-talk on 2026-10-26: no SDK, no CI keys, and a CSP that blocks the API', async () => {
    const res = await call('GET', HEALTH)
    expect(res.status).toBe(200)
    expect(ids(res.json).sort()).toEqual(['ci_secrets_missing', 'csp_blocks_api', 'not_installed'])
    expect(res.json.data.problems.find((p: { id: string }) => p.id === 'ci_secrets_missing').detail).toContain('VITE_MUSHI_PROJECT_ID and VITE_MUSHI_API_KEY')
    expect(res.json.data).toMatchObject({ installed: false, siteUrl: SITE, repoUrl: 'https://github.com/kensaurus/lets-talk' })
  })

  it('yen-yen: an outdated pin is the one problem; pre-releases are not "latest"', async () => {
    state.files = { 'apps/mobile/package.json': pkg({ expo: '54.0.0', '@mushi-mushi/react-native': '0.24.0' }) }
    state.secretNames = ['EXPO_PUBLIC_MUSHI_PROJECT_ID', 'EXPO_PUBLIC_MUSHI_API_KEY']
    state.csp = null
    seed({
      projects: [{ id: P, name: 'yen-yen', slug: 'yen-yen' }],
      sdk_versions: [{ package: '@mushi-mushi/react-native', version: '0.24.3' }, { package: '@mushi-mushi/react-native', version: '0.25.0-rc.1' }],
      project_api_keys: [{ project_id: P, is_active: true, scopes: ['report:write'], last_seen_at: new Date().toISOString(), last_seen_origin: null, last_seen_user_agent: 'okhttp/4.12' }],
    })
    const res = await call('GET', HEALTH)
    expect(ids(res.json)).toEqual(['outdated'])
    expect(res.json.data.problems[0].detail).toContain('0.24.0 → 0.24.3')
  })

  it('yen-yen with upgrade PR #359 open and CI failing: link it, no second upgrade PR', async () => {
    state.files = { 'apps/mobile/package.json': pkg({ expo: '54.0.0', '@mushi-mushi/react-native': '0.24.0' }) }
    state.secretNames = ['EXPO_PUBLIC_MUSHI_PROJECT_ID', 'EXPO_PUBLIC_MUSHI_API_KEY']
    seed({
      sdk_versions: [{ package: '@mushi-mushi/react-native', version: '0.24.3' }],
      project_api_keys: [{ project_id: P, is_active: true, scopes: ['report:write'], last_seen_at: new Date().toISOString(), last_seen_user_agent: 'okhttp/4.12' }],
      sdk_upgrade_jobs: [
        { project_id: P, status: 'completed', pr_url: 'https://github.com/kensaurus/yen-yen/pull/359', pr_state: 'open', merged_at: null, check_run_status: 'completed', check_run_conclusion: 'failure', finished_at: new Date().toISOString() },
      ],
    })
    const res = await call('GET', HEALTH)
    expect(res.json.data.problems).toEqual([
      expect.objectContaining({ id: 'outdated', fix: null, link: { label: 'Open PR #359', href: 'https://github.com/kensaurus/yen-yen/pull/359' } }),
    ])
    expect(res.json.data.problems[0].detail).toContain('Upgrade PR #359 is open; CI failing.')
  })

  it('an upgrade PR closed without merging is history: the Fix is offered again', async () => {
    state.files = { 'apps/mobile/package.json': pkg({ expo: '54.0.0', '@mushi-mushi/react-native': '0.24.0' }) }
    state.secretNames = ['EXPO_PUBLIC_MUSHI_PROJECT_ID', 'EXPO_PUBLIC_MUSHI_API_KEY']
    seed({
      sdk_versions: [{ package: '@mushi-mushi/react-native', version: '0.24.3' }],
      project_api_keys: [{ project_id: P, is_active: true, scopes: ['report:write'], last_seen_at: new Date().toISOString(), last_seen_user_agent: 'okhttp/4.12' }],
      sdk_upgrade_jobs: [
        { project_id: P, status: 'completed', pr_url: 'https://github.com/kensaurus/yen-yen/pull/358', pr_state: 'closed', merged_at: null, finished_at: new Date().toISOString() },
      ],
    })
    const res = await call('GET', HEALTH)
    expect(res.json.data.problems[0]).toMatchObject({ id: 'outdated', fix: { kind: 'upgrade_pr' } })
    expect(res.json.data.problems[0].link).toBeUndefined()
  })

  it('an MCP key heartbeat is not an SDK check-in', async () => {
    state.files = { 'package.json': pkg({ '@mushi-mushi/web': '^1.33.1' }, { vite: '7.0.0' }) }
    state.secretNames = ['VITE_MUSHI_PROJECT_ID', 'VITE_MUSHI_API_KEY']
    state.csp = null
    seed({ project_api_keys: [{ project_id: P, is_active: true, scopes: ['report:write', 'mcp:read'], last_seen_at: new Date().toISOString() }] })
    expect(ids((await call('GET', HEALTH)).json).sort()).toEqual(['never_seen', 'no_sdk_key'])
  })

  it('failed reads are notes, not problems and not a 500', async () => {
    state.treeFails = true
    state.secretNames = new Error('the token cannot list Actions secrets (403)')
    state.siteFails = true
    const res = await call('GET', HEALTH)
    expect(res.status).toBe(200)
    expect(res.json.data.problems).toEqual([])
    expect(res.json.data.installed).toBeNull()
    expect(res.json.data.notes.map((n: { check: string }) => n.check).sort()).toEqual(['ci_secrets', 'repo', 'site_csp'])
  })

  it('a site that answers 403 (a bot challenge) is not checked, never a pass', async () => {
    state.files = { 'package.json': pkg({ '@mushi-mushi/web': '^1.33.1' }, { vite: '7.0.0' }) }
    state.secretNames = ['VITE_MUSHI_PROJECT_ID', 'VITE_MUSHI_API_KEY']
    state.csp = null
    state.siteStatus = 403
    seed({ project_api_keys: [{ project_id: P, is_active: true, scopes: ['report:write'], last_seen_at: new Date().toISOString() }] })
    const res = await call('GET', HEALTH)
    expect(res.json.data.problems).toEqual([])
    expect(res.json.data.notes).toEqual([expect.objectContaining({ check: 'site_csp', detail: expect.stringContaining('answered 403') })])
    expect((await call('POST', TASKS, { kind: 'csp' })).status).toBe(502)
  })

  it('no repo connected: notes say why', async () => {
    state.repo = false
    const res = await call('GET', HEALTH)
    expect(ids(res.json)).toEqual(['csp_blocks_api'])
    expect(res.json.data.notes.find((n: { check: string }) => n.check === 'repo').detail).toContain('No primary GitHub repo')
  })
})

describe('POST /sdk-health/tasks', () => {
  it('files one classified sdk_health report and returns the open one the second time', async () => {
    const first = await call('POST', TASKS, { kind: 'install' })
    expect(first.status).toBe(200)
    expect(first.json.data.existing).toBe(false)
    const rows = db.table('reports')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ project_id: P, source: 'sdk_health', status: 'classified', component: 'sdk-health:install', category: 'other', confidence: 1 })
    expect(rows[0].description).toContain('VITE_MUSHI_API_KEY')
    expect(rows[0].description).toContain('`.github/workflows/deploy.yml`')
    const second = await call('POST', TASKS, { kind: 'install' })
    expect(second.json.data).toEqual({ reportId: first.json.data.reportId, existing: true })
    expect(db.table('reports')).toHaveLength(1)
  })

  it('a closed task does not block a new one', async () => {
    seed({ reports: [{ id: 'old', project_id: P, source: 'sdk_health', component: 'sdk-health:install', status: 'fixed', created_at: '2026-10-01T00:00:00Z' }] })
    const res = await call('POST', TASKS, { kind: 'install' })
    expect(res.json.data.existing).toBe(false)
    expect(db.table('reports')).toHaveLength(2)
  })

  it('csp files a task with the blocking directive; an allowing policy files nothing', async () => {
    const res = await call('POST', TASKS, { kind: 'csp' })
    expect(res.status).toBe(200)
    expect(db.table('reports')[0]).toMatchObject({ component: 'sdk-health:csp' })
    expect(db.table('reports')[0].description).toContain('https://dxptnwrhwsqckaftyymj.supabase.co')
    seed()
    state.csp = "connect-src 'self' https://*.supabase.co"
    const ok = await call('POST', TASKS, { kind: 'csp' })
    expect(ok.status).toBe(409)
    expect(db.table('reports')).toHaveLength(0)
  })

  it('a repo with only the CLI can still get an install task', async () => {
    state.files = { 'package.json': pkg({ react: '19.0.0' }, { vite: '7.0.0', '@mushi-mushi/cli': '^0.30.0' }) }
    const res = await call('POST', TASKS, { kind: 'install' })
    expect(res.status).toBe(200)
    expect(db.table('reports')).toHaveLength(1)
  })

  it('install refuses when the SDK is already in the repo, or there is no repo', async () => {
    state.files = { 'package.json': pkg({ '@mushi-mushi/web': '1.0.0' }) }
    expect((await call('POST', TASKS, { kind: 'install' })).json.error.code).toBe('ALREADY_INSTALLED')
    state.repo = false
    expect((await call('POST', TASKS, { kind: 'install' })).status).toBe(412)
    expect(db.table('reports')).toHaveLength(0)
  })

  it('viewers and members cannot file; a bad kind is a 400', async () => {
    state.role = 'viewer'
    expect((await call('POST', TASKS, { kind: 'install' })).status).toBe(403)
    state.role = 'member'
    expect((await call('POST', TASKS, { kind: 'install' })).status).toBe(403)
    state.role = 'owner'
    expect((await call('POST', TASKS, { kind: 'deploy' })).status).toBe(400)
  })

  it('a refused insert (CHECK constraint before the migration) is an error, never "filed"', async () => {
    const insert = db.from.bind(db)
    db.from = ((name: string) => {
      const q = insert(name)
      if (name !== 'reports') return q
      const original = q.insert.bind(q)
      q.insert = (payload: never) => {
        original(payload)
        return { select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'new row violates check constraint "reports_source_check"' } }) }) } as never
      }
      return q
    }) as typeof db.from
    const res = await call('POST', TASKS, { kind: 'install' })
    expect(res.status).toBe(500)
    expect(res.json.error.code).toBe('TASK_NOT_FILED')
    expect(res.json.error.message).toContain('reports_source_check')
  })
})
