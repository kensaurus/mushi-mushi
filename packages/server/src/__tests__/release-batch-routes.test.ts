/**
 * FILE: release-batch-routes.test.ts
 * PURPOSE: GET /v1/admin/release-batch (console ops plan 2026-10-27, P1):
 *          one batch per repo from stored state, members' changed files from
 *          GitHub (cached by repo, PR and head), migrations matched against
 *          the recipe's folder, the deploy after the last merged train, and
 *          reads that fail named in `partial` instead of reading as "none".
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

const P1 = '1000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-27T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

const state = vi.hoisted(() => ({ db: null as unknown, accessible: [] as string[] }))
const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'u1')
    await next()
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  enumerateAccessibleProjectIds: async () => state.accessible,
  userCanAccessProject: async (_db: unknown, _u: string, id: string) => ({ allowed: state.accessible.includes(id), role: 'owner' }),
}))

type Routes = typeof import('../../supabase/functions/api/routes/release-batch.ts')
let routes: Routes
const fileCalls: number[] = []
let files: Record<number, string[] | 'fail'> = {}

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  routes = await import('../../supabase/functions/api/routes/release-batch.ts')
})

let app: Hono
beforeEach(() => {
  fileCalls.length = 0
  files = { 101: ['supabase/migrations/20261027_x.sql', 'src/a.ts'], 102: ['db/schema/1.sql'] }
  state.accessible = [P1]
  state.db = makeFakeDb({
    projects: [{ id: P1, name: 'glot.it' }],
    project_settings: [{ project_id: P1, release_mode: 'train', train_interval_minutes: 360, train_max_members: 15 }],
    project_repos: [{ project_id: P1, repo_url: 'https://github.com/kensaurus/glot.it', github_app_installation_id: 7, is_primary: true }],
    fix_merge_queue: [
      { id: 'q1', fix_attempt_id: 'a1', project_id: P1, repo: 'kensaurus/glot.it', pr_number: 101, state: 'queued', detail: 'Approved; waits for the next release train.', queued_at: hoursAgo(9), train_id: null },
      { id: 'q2', fix_attempt_id: 'a2', project_id: P1, repo: 'kensaurus/glot.it', pr_number: 102, state: 'blocked', detail: 'CI fails on its own commit (test).', queued_at: hoursAgo(8), train_id: null },
    ],
    release_trains: [
      { id: 't0', project_id: P1, repo: 'kensaurus/glot.it', pr_number: 90, state: 'merged', members: [], attempt: 1, detail: null, head_sha: null, merge_sha: 'abcdef1234567', created_at: hoursAgo(30), merged_at: hoursAgo(29) },
    ],
    fix_attempts: [
      { id: 'a1', report_id: 'r1', pr_url: 'https://github.com/kensaurus/glot.it/pull/101', pr_state: 'open', commit_sha: 'h1h1h1h1', check_run_conclusion: 'success' },
      { id: 'a2', report_id: 'r2', pr_url: 'https://github.com/kensaurus/glot.it/pull/102', pr_state: 'open', commit_sha: 'h2h2h2h2', check_run_conclusion: 'failure' },
    ],
    reports: [
      { id: 'r1', title: 'Quiz crashes on submit', summary: null, severity: 'high', source: 'sdk' },
      { id: 'r2', title: null, summary: 'Login button does nothing', severity: 'medium', source: 'sdk' },
    ],
    fix_reviews: [
      { fix_attempt_id: 'a1', verdict: 'merge', head_sha: 'h1h1h1h1', status: 'completed', completed_at: hoursAgo(5), created_at: hoursAgo(5) },
      { fix_attempt_id: 'a2', verdict: 'merge', head_sha: 'h2h2h2h2', status: 'completed', completed_at: hoursAgo(5), created_at: hoursAgo(5) },
    ],
    ci_jobs: [],
    app_recipe_snapshots: [],
    deploy_observations: [{ project_id: P1, observed_at: hoursAgo(28), observed_commit: 'abcdef1', observed_version: '1.103.0', ok: true }],
  })
  routes.clearReleaseBatchCache()
  app = new Hono()
  routes.registerReleaseBatchRoutes(app as never, {
    now: () => NOW,
    token: async () => 'tok',
    pullFiles: async (_t, _r, pr) => {
      fileCalls.push(pr)
      const f = files[pr]
      if (f === 'fail') throw new Error('GitHub 502')
      return f ? { files: f.map((filename) => ({ filename })), complete: true } : null
    },
  })
})

async function get(path: string) {
  const res = await app.request(path)
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('GET /v1/admin/release-batch', () => {
  it('glot.it: the next train, why each member waits, migrations in their changes, and the last deploy', async () => {
    const res = await get(`/v1/admin/release-batch?projectId=${P1}`)
    expect(res.status).toBe(200)
    const [b] = res.json.data.repos
    expect(b).toMatchObject({ repo: 'kensaurus/glot.it', projectName: 'glot.it', mode: 'train' })
    expect(b.train).toMatchObject({ kind: 'next', readyCount: 1 })
    expect(b.members.map((m: { prNumber: number; rides: boolean }) => [m.prNumber, m.rides])).toEqual([[101, true], [102, false]])
    expect(b.members[0]).toMatchObject({ title: 'Quiz crashes on submit', verdict: 'merge', verdictAtHead: true, ci: 'green' })
    expect(b.members[1]).toMatchObject({ title: 'Login button does nothing', ci: 'failing', queueDetail: 'CI fails on its own commit (test).' })
    expect(b.migrations).toMatchObject({ source: 'default', files: [{ prNumber: 101, path: 'supabase/migrations/20261027_x.sql' }], complete: true })
    expect(b.deploy).toMatchObject({ state: 'live', version: '1.103.0', train: { prNumber: 90 } })
    expect(res.json.data.partial).toEqual([])
  })

  it("the recipe's migrations folder replaces the common ones", async () => {
    ;(state.db as ReturnType<typeof makeFakeDb>).tables.app_recipe_snapshots.push({ project_id: P1, is_current: true, manifest: { version: 1, data: { migrationsDir: 'db/schema' } } })
    const [b] = (await get(`/v1/admin/release-batch?projectId=${P1}`)).json.data.repos
    expect(b.migrations).toMatchObject({ source: 'recipe', globs: ['db/schema/**'], files: [{ prNumber: 102, path: 'db/schema/1.sql' }] })
  })

  it('caches changed files by repo, PR and head; a failed read is listed as unread, not as "no migrations"', async () => {
    await get(`/v1/admin/release-batch?projectId=${P1}`)
    await get(`/v1/admin/release-batch?projectId=${P1}`)
    expect(fileCalls.sort()).toEqual([101, 102])
    routes.clearReleaseBatchCache()
    files[102] = 'fail'
    const [b] = (await get(`/v1/admin/release-batch?projectId=${P1}`)).json.data.repos
    expect(b.migrations).toMatchObject({ complete: false, unread: [102] })
  })

  it('an app the caller cannot open is a 404; no apps is an empty list', async () => {
    state.accessible = []
    expect((await get(`/v1/admin/release-batch?projectId=${P1}`)).status).toBe(404)
    const all = await get('/v1/admin/release-batch')
    expect(all.json.data.repos).toEqual([])
  })
})
