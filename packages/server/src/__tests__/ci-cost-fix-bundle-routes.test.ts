/**
 * FILE: ci-cost-fix-bundle-routes.test.ts
 * PURPOSE: "Apply to every app" (api/routes/ci-cost-fix-bundle.ts, ADR 0047
 *          amendment 2026-10-27) through the real handlers on an in-memory
 *          database:
 *            - the preview lists the caller's non-viewer apps only, grouped
 *              per repo, with the workflow-write reason the setup check knows;
 *            - the request caps repos (10) and items per repo (20), refuses a
 *              repo listed twice, and answers per repo;
 *            - only items the server still advises are queued, with the
 *              server's evidence and saving; an open PR or an edit in flight
 *              is skipped and said so; one bundle (one rate-limit token, one
 *              worker call) per repo;
 *            - viewers, other projects, unconnected repos, the rate limit and
 *              a racing duplicate each fail their repo only;
 *            - GET :id shows the bundle, re-fires a stuck one, measures an
 *              opened one, hides other projects';
 *            - the single-fix GET re-fires a bundle row as its bundle.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'
import type { CiOverviewAdvice } from '../../supabase/functions/_shared/ci-overview-types.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) =>
    c.json({ ok: false, error: { code, message } }, status),
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
  callerProjectIds: async () => [],
}))

type Routes = typeof import('../../supabase/functions/api/routes/ci-cost-fix-bundle.ts')
type SingleRoutes = typeof import('../../supabase/functions/api/routes/ci-cost-fix.ts')
let routes: Routes
let single: SingleRoutes
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  routes = await import('../../supabase/functions/api/routes/ci-cost-fix-bundle.ts')
  single = await import('../../supabase/functions/api/routes/ci-cost-fix.ts')
})

const A = '1000000a-0000-4000-8000-000000000000'
const B = '1000000b-0000-4000-8000-000000000000'
const V = '1000000c-0000-4000-8000-000000000000'
const USER = '2000000a-0000-4000-8000-000000000000'
const BUNDLE = '5000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-27T12:00:00Z')
const CI = '.github/workflows/ci.yml'
const NIGHTLY = '.github/workflows/nightly.yml'

let db: FakeDb
let roles: Record<string, string | null>
let adviceList: CiOverviewAdvice[]
let ability: 'yes' | 'no' | null
let ids: number
const calls = { invoke: vi.fn(), audit: vi.fn(async () => undefined), rate: vi.fn(), refresh: vi.fn(), loadAdvice: vi.fn() }

function advice(projectId: string, repo: string, workflowPath: string, kind: 'skip_drafts' | 'weekly_cron' | 'add_concurrency', monthSavingUsd: number | null = null): CiOverviewAdvice {
  return { id: `${kind}:${workflowPath}`, severity: 'low', title: kind, detail: 'd', evidence: `server evidence for ${workflowPath}`, fix: 'f', repo, monthSavingUsd, autofix: { kind, projectId, repo, workflowPath } }
}

function job(over: Partial<Row> = {}): Row {
  return {
    id: '4000000a-0000-4000-8000-000000000000',
    project_id: A,
    requested_by: USER,
    repo: 'acme/app',
    workflow_path: CI,
    kind: 'skip_drafts',
    status: 'queued',
    workflow_name: null,
    evidence: null,
    month_saving_usd: null,
    summary: null,
    error_code: null,
    error: null,
    pr_url: null,
    pr_number: null,
    branch: null,
    commit_sha: null,
    baseline: null,
    measured: null,
    merged_at: null,
    closed_at: null,
    created_at: '2026-10-27T11:59:30Z',
    started_at: null,
    finished_at: null,
    updated_at: '2026-10-27T11:59:30Z',
    bundle_id: null,
    ...over,
  }
}

function seed(jobs: Row[] = [], opts: Parameters<typeof makeFakeDb>[1] = {}) {
  db = makeFakeDb(
    {
      ci_cost_fix_jobs: jobs,
      projects: [{ id: A, name: 'App' }, { id: B, name: 'Web' }, { id: V, name: 'Viewed' }],
      project_repos: [
        { project_id: A, repo_url: 'https://github.com/Acme/App' },
        { project_id: B, repo_url: 'https://github.com/acme/web' },
        { project_id: V, repo_url: 'https://github.com/acme/viewed' },
      ],
      project_settings: [],
    },
    { autoId: true, ...opts },
  )
}

function app(over: Partial<import('../../supabase/functions/api/routes/ci-cost-fix-bundle.ts').CiCostFixBundleRouteDeps> = {}) {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    await next()
  }
  const access = (async (_c: unknown, _db: unknown, _u: string, projectId: string) => {
    const role = roles[projectId] ?? null
    return { allowed: role !== null, role }
  }) as never
  const a = new Hono()
  routes.registerCiCostFixBundleRoutes(a as never, {
    ...routes.defaultCiCostFixBundleRouteDeps,
    getServiceClient: () => db as never,
    adminOrApiKeyRead: pass as never,
    adminOrApiKeyWrite: pass as never,
    callerCanAccessProject: access,
    callerProjectIds: (async () => Object.keys(roles).filter((k) => roles[k] !== null)) as never,
    claimRateLimit: calls.rate as never,
    loadAdvice: calls.loadAdvice as never,
    workflowsAbility: () => ability,
    refreshBundle: calls.refresh as never,
    invokeBundleWorker: calls.invoke,
    logAudit: calls.audit as never,
    now: () => NOW,
    newId: () => `5000000${(ids++).toString(16)}-0000-4000-8000-000000000000`,
    ...over,
  })
  single.registerCiCostFixRoutes(a as never, {
    ...single.defaultCiCostFixRouteDeps,
    getServiceClient: () => db as never,
    adminOrApiKeyRead: pass as never,
    adminOrApiKeyWrite: pass as never,
    callerCanAccessProject: access,
    invokeWorker: vi.fn(),
    invokeBundleWorker: calls.invoke,
    refresh: calls.refresh as never,
    now: () => NOW,
  })
  return a
}

async function call(method: string, path: string, body?: unknown, over = {}) {
  const res = await app(over).request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, json: (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string } } }
}

beforeEach(() => {
  roles = { [A]: 'member', [B]: 'owner', [V]: 'viewer' }
  ability = null
  ids = 10
  adviceList = [
    advice(A, 'acme/app', CI, 'skip_drafts'),
    advice(A, 'acme/app', NIGHTLY, 'weekly_cron', 2.5),
    advice(B, 'acme/web', CI, 'add_concurrency'),
    advice(V, 'acme/viewed', CI, 'skip_drafts', 9),
  ]
  for (const f of Object.values(calls)) f.mockReset()
  calls.rate.mockResolvedValue({ allowed: true })
  calls.audit.mockResolvedValue(undefined)
  calls.loadAdvice.mockImplementation(async (_db: unknown, projectIds: string[]) => ({ advice: adviceList.filter((a) => projectIds.includes(a.autofix!.projectId)), partial: null }))
  const merged = (r: Row) => ({ ...r, merged_at: '2026-10-26T00:00:00Z' })
  calls.refresh.mockImplementation(async (_db: unknown, x: Row | Row[]) => (Array.isArray(x) ? x.map(merged) : merged(x)))
  seed()
})

describe('GET /v1/admin/ci/cost-fix-rollout', () => {
  it('lists every autofix item of the apps the caller may change, grouped per repo', async () => {
    ability = 'no'
    const res = await call('GET', '/v1/admin/ci/cost-fix-rollout')
    expect(res.status).toBe(200)
    // The viewer's app is never read.
    expect(calls.loadAdvice.mock.calls[0][1].sort()).toEqual([A, B])
    const repos = res.json.data.repos
    expect(repos.map((r: { repo: string }) => r.repo)).toEqual(['acme/app', 'acme/web'])
    expect(repos[0]).toMatchObject({ projectName: 'App', readyItems: 2, monthSavingUsd: 2.5, unpricedItems: 1 })
    expect(repos[0].block).toMatchObject({ code: 'GITHUB_WORKFLOWS_WRITE_MISSING', source: 'setup_check' })
    expect(res.json.data.caps).toEqual({ reposPerRequest: 10, itemsPerRepo: 20 })
  })

  it('reads one app with ?project_id, and refuses one the caller cannot read', async () => {
    const res = await call('GET', `/v1/admin/ci/cost-fix-rollout?project_id=${B}`)
    expect(res.json.data.repos.map((r: { repo: string }) => r.repo)).toEqual(['acme/web'])
    expect((await call('GET', '/v1/admin/ci/cost-fix-rollout?project_id=1000000f-0000-4000-8000-000000000000')).status).toBe(403)
    expect((await call('GET', '/v1/admin/ci/cost-fix-rollout?project_id=nope')).status).toBe(400)
  })

  it('an all-viewer caller gets an empty preview without reading advice', async () => {
    roles = { [V]: 'viewer' }
    const res = await call('GET', '/v1/admin/ci/cost-fix-rollout')
    expect(res.json.data.repos).toEqual([])
    expect(calls.loadAdvice).not.toHaveBeenCalled()
  })

  it('says when the advice could not be read', async () => {
    calls.loadAdvice.mockRejectedValue(new Error('db down'))
    const res = await call('GET', '/v1/admin/ci/cost-fix-rollout')
    expect(res.status).toBe(500)
    expect(res.json.error?.code).toBe('CI_ADVICE_FAILED')
  })
})

describe('POST /v1/admin/ci/cost-fix-rollout', () => {
  const both = { repos: [
    { projectId: A, repo: 'acme/app', items: [{ workflowPath: CI, kind: 'skip_drafts' }, { workflowPath: NIGHTLY, kind: 'weekly_cron' }] },
    { projectId: B, repo: 'acme/web', items: [{ workflowPath: CI, kind: 'add_concurrency' }] },
  ] }

  it('queues one bundle per repo with the server\'s evidence and saving, one rate token and one worker call each', async () => {
    const res = await call('POST', '/v1/admin/ci/cost-fix-rollout', both)
    expect(res.status).toBe(202)
    expect(res.json.data.queued).toBe(2)
    const [app1, web] = res.json.data.results
    expect(app1).toMatchObject({ status: 'queued', repo: 'Acme/App', error: null, skipped: [] })
    expect(app1.jobs).toHaveLength(2)
    expect(web).toMatchObject({ status: 'queued', repo: 'acme/web' })
    const stored = db.tables.ci_cost_fix_jobs
    expect(stored).toHaveLength(3)
    expect(new Set(stored.filter((r) => r.project_id === A).map((r) => r.bundle_id)).size).toBe(1)
    expect(stored.find((r) => r.kind === 'weekly_cron')).toMatchObject({ evidence: `server evidence for ${NIGHTLY}`, month_saving_usd: 2.5, status: 'queued', requested_by: USER })
    expect(calls.rate).toHaveBeenCalledTimes(2)
    expect(calls.rate).toHaveBeenCalledWith(db, `project:${A}:ci_cost_fix`, 10, 3600)
    expect(calls.invoke.mock.calls.map((c) => c[0]).sort()).toEqual([app1.bundleId, web.bundleId].sort())
    expect(calls.audit).toHaveBeenCalledWith(db, A, USER, 'settings.updated', 'ci_cost_fix_bundle', app1.bundleId, expect.objectContaining({ repo: 'Acme/App' }), expect.anything())
  })

  it('caps repos per request and items per repo, and refuses a repo listed twice', async () => {
    const tooManyRepos = { repos: Array.from({ length: 11 }, () => ({ projectId: A, repo: 'acme/app', items: [{ workflowPath: CI, kind: 'skip_drafts' }] })) }
    expect((await call('POST', '/v1/admin/ci/cost-fix-rollout', tooManyRepos)).status).toBe(400)
    const tooManyItems = { repos: [{ projectId: A, repo: 'acme/app', items: Array.from({ length: 21 }, (_, i) => ({ workflowPath: `.github/workflows/w${i}.yml`, kind: 'skip_drafts' })) }] }
    const items = await call('POST', '/v1/admin/ci/cost-fix-rollout', tooManyItems)
    expect(items.status).toBe(400)
    expect(items.json.error?.message).toContain('at most 20 fixes per repo')
    const twice = { repos: [both.repos[0], { ...both.repos[0], repo: 'ACME/app' }] }
    expect((await call('POST', '/v1/admin/ci/cost-fix-rollout', twice)).status).toBe(400)
    for (const bad of [{ repos: [] }, { repos: [{ projectId: A, repo: 'acme/app', items: [{ workflowPath: 'x.yml', kind: 'skip_drafts' }] }] }, { repos: [{ projectId: A, repo: 'acme/app', items: [{ workflowPath: CI, kind: 'rm_rf' }] }] }]) {
      expect((await call('POST', '/v1/admin/ci/cost-fix-rollout', bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect(db.tables.ci_cost_fix_jobs).toHaveLength(0)
    expect(calls.invoke).not.toHaveBeenCalled()
  })

  it('skips an item no longer advised, an open PR and an edit in flight, saying why per item', async () => {
    seed([
      job({ status: 'pr_opened', pr_url: 'https://github.com/Acme/App/pull/9', repo: 'Acme/App' }),
      job({ id: '4000000b-0000-4000-8000-000000000000', project_id: B, repo: 'acme/web', kind: 'add_concurrency', status: 'running' }),
    ])
    const res = await call('POST', '/v1/admin/ci/cost-fix-rollout', { repos: [
      { projectId: A, repo: 'acme/app', items: [{ workflowPath: CI, kind: 'skip_drafts' }, { workflowPath: CI, kind: 'add_concurrency' }, { workflowPath: NIGHTLY, kind: 'weekly_cron' }] },
      { projectId: B, repo: 'acme/web', items: [{ workflowPath: CI, kind: 'add_concurrency' }] },
    ] })
    const [app1, web] = res.json.data.results
    expect(app1.status).toBe('queued')
    expect(app1.jobs.map((j: { kind: string }) => j.kind)).toEqual(['weekly_cron'])
    expect(app1.skipped).toEqual([
      expect.objectContaining({ kind: 'skip_drafts', code: 'PR_ALREADY_OPEN', prUrl: 'https://github.com/Acme/App/pull/9' }),
      expect.objectContaining({ kind: 'add_concurrency', code: 'NOT_ADVISED' }),
    ])
    expect(web).toMatchObject({ status: 'skipped', bundleId: null })
    expect(web.skipped[0].code).toBe('COST_FIX_IN_PROGRESS')
    // A repo with nothing to open spends no rate-limit token.
    expect(calls.rate).toHaveBeenCalledTimes(1)
  })

  it('a viewer, another project, an unconnected repo and the rate limit each fail their repo only', async () => {
    calls.rate.mockImplementation(async (_db: unknown, key: string) => ({ allowed: !key.includes(B) }))
    const res = await call('POST', '/v1/admin/ci/cost-fix-rollout', { repos: [
      { projectId: V, repo: 'acme/viewed', items: [{ workflowPath: CI, kind: 'skip_drafts' }] },
      { projectId: '1000000f-0000-4000-8000-000000000000', repo: 'acme/x', items: [{ workflowPath: CI, kind: 'skip_drafts' }] },
      { projectId: A, repo: 'acme/other', items: [{ workflowPath: CI, kind: 'skip_drafts' }] },
      { projectId: B, repo: 'acme/web', items: [{ workflowPath: CI, kind: 'add_concurrency' }] },
      { projectId: A, repo: 'acme/app', items: [{ workflowPath: CI, kind: 'skip_drafts' }] },
    ] })
    expect(res.status).toBe(202)
    expect(res.json.data.results.map((r: { status: string; error: { code: string } | null }) => r.error?.code ?? r.status)).toEqual([
      'FORBIDDEN',
      'NOT_FOUND',
      'REPO_NOT_IN_PROJECT',
      'RATE_LIMITED',
      'queued',
    ])
    expect(res.json.data.results[0].error.message).toMatch(/^Viewers have read-only access/)
    expect(db.tables.ci_cost_fix_jobs).toHaveLength(1)
  })

  it('a racing duplicate (the one-active-edit index) fails that repo as in progress, never silently', async () => {
    seed([job({ status: 'failed' })], { autoId: true, partialUniques: { ci_cost_fix_jobs: { keys: ['project_id', 'workflow_path', 'kind'], where: () => true } } })
    const res = await call('POST', '/v1/admin/ci/cost-fix-rollout', { repos: [{ projectId: A, repo: 'acme/app', items: [{ workflowPath: CI, kind: 'skip_drafts' }] }] })
    expect(res.status).toBe(200)
    expect(res.json.data.results[0]).toMatchObject({ status: 'error', error: { code: 'COST_FIX_IN_PROGRESS' } })
    expect(calls.invoke).not.toHaveBeenCalled()
  })

  it('opens nothing when the advice cannot be read', async () => {
    calls.loadAdvice.mockRejectedValue(new Error('down'))
    const res = await call('POST', '/v1/admin/ci/cost-fix-rollout', both)
    expect(res.status).toBe(500)
    expect(db.tables.ci_cost_fix_jobs).toHaveLength(0)
  })
})

describe('GET /v1/admin/ci/cost-fix-bundles/:id', () => {
  const rows = (over: Partial<Row> = {}) => [
    job({ bundle_id: BUNDLE, ...over }),
    job({ id: '4000000b-0000-4000-8000-000000000000', bundle_id: BUNDLE, kind: 'weekly_cron', workflow_path: NIGHTLY, ...over }),
  ]

  it('shows the bundle and re-fires one still queued after two minutes', async () => {
    seed(rows())
    const fresh = await call('GET', `/v1/admin/ci/cost-fix-bundles/${BUNDLE}`)
    expect(fresh.status).toBe(200)
    expect(fresh.json.data.bundle).toMatchObject({ id: BUNDLE, status: 'queued', repo: 'acme/app' })
    expect(fresh.json.data.bundle.items).toHaveLength(2)
    expect(calls.invoke).not.toHaveBeenCalled()
    seed(rows({ created_at: '2026-10-27T11:50:00Z' }))
    await call('GET', `/v1/admin/ci/cost-fix-bundles/${BUNDLE}`)
    expect(calls.invoke).toHaveBeenCalledWith(BUNDLE)
  })

  it('fires a bundle again when a row is stuck running past the stale window, not a fresh run', async () => {
    seed(rows({ status: 'running', started_at: '2026-10-27T11:55:00Z' }))
    await call('GET', `/v1/admin/ci/cost-fix-bundles/${BUNDLE}`)
    expect(calls.invoke).not.toHaveBeenCalled()
    seed(rows({ status: 'running', started_at: '2026-10-27T11:45:00Z' }))
    await call('GET', `/v1/admin/ci/cost-fix-bundles/${BUNDLE}`)
    expect(calls.invoke).toHaveBeenCalledWith(BUNDLE)
  })

  it('measures an opened bundle on read', async () => {
    seed(rows({ status: 'pr_opened', pr_url: 'https://github.com/acme/app/pull/5', pr_number: 5 }))
    const res = await call('GET', `/v1/admin/ci/cost-fix-bundles/${BUNDLE}`)
    expect(calls.refresh).toHaveBeenCalledTimes(1)
    expect(res.json.data.bundle).toMatchObject({ status: 'pr_opened', prNumber: 5 })
    expect(res.json.data.bundle.items[0].mergedAt).toBe('2026-10-26T00:00:00Z')
  })

  it('hides another project\'s bundle, an unknown one and a bad id', async () => {
    seed(rows({ project_id: '1000000f-0000-4000-8000-000000000000' }))
    expect((await call('GET', `/v1/admin/ci/cost-fix-bundles/${BUNDLE}`)).status).toBe(404)
    expect((await call('GET', '/v1/admin/ci/cost-fix-bundles/5000000f-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await call('GET', '/v1/admin/ci/cost-fix-bundles/abc')).status).toBe(400)
  })

  it('the single-fix GET re-fires a stuck bundle row as its bundle, never alone', async () => {
    seed([job({ bundle_id: BUNDLE, created_at: '2026-10-27T11:50:00Z' })])
    await call('GET', '/v1/admin/ci/cost-fixes/4000000a-0000-4000-8000-000000000000')
    expect(calls.invoke).toHaveBeenCalledWith(BUNDLE)
    // Also one left `running` past the stale window (a lost finish).
    calls.invoke.mockReset()
    seed([job({ bundle_id: BUNDLE, status: 'running', started_at: '2026-10-27T11:45:00Z' })])
    await call('GET', '/v1/admin/ci/cost-fixes/4000000a-0000-4000-8000-000000000000')
    expect(calls.invoke).toHaveBeenCalledWith(BUNDLE)
  })
})

describe('routing', () => {
  it('api-ext registers the bundle routes (api forwards /v1/admin/ci/*)', () => {
    const ext = readFileSync(resolve(__dirname, '../../supabase/functions/api-ext/index.ts'), 'utf8')
    expect(ext).toContain('registerCiCostFixBundleRoutes(app)')
  })
})
