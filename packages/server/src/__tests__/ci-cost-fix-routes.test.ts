/**
 * FILE: ci-cost-fix-routes.test.ts
 * PURPOSE: The CI cost "Open fix PR" routes (api/routes/ci-cost-fix.ts,
 *          ADR 0047) through the real handlers on an in-memory database:
 *            - POST validates the body, refuses viewers and repos outside the
 *              project, is rate limited, queues one job and fires the worker,
 *              answers 409 for an edit in flight or a PR still open;
 *            - GET :id measures an opened PR, re-fires a stuck queued job,
 *              hides other projects' jobs; GET ?project_id lists them;
 *            - `api` forwards the paths to `api-ext`, which registers them.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

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
}))

type Routes = typeof import('../../supabase/functions/api/routes/ci-cost-fix.ts')
let routes: Routes
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  routes = await import('../../supabase/functions/api/routes/ci-cost-fix.ts')
})

const P = '1000000a-0000-4000-8000-000000000000'
const OTHER = '1000000b-0000-4000-8000-000000000000'
const USER = '2000000a-0000-4000-8000-000000000000'
const JOB = '4000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-27T12:00:00Z')

let db: FakeDb
let role: string | null = 'member'
let allowedProject = P
const calls = { invoke: vi.fn(), audit: vi.fn(async () => undefined), rate: vi.fn(), refresh: vi.fn() }

function job(over: Partial<Row> = {}): Row {
  return {
    id: JOB,
    project_id: P,
    requested_by: USER,
    repo: 'acme/app',
    workflow_path: '.github/workflows/ci.yml',
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
    ...over,
  }
}

function seed(jobs: Row[] = []) {
  db = makeFakeDb(
    {
      ci_cost_fix_jobs: jobs,
      project_repos: [{ project_id: P, repo_url: 'https://github.com/Acme/App', default_branch: 'main', github_app_installation_id: 7 }],
      project_settings: [{ project_id: P, github_repo_url: null }],
    },
    { autoId: true },
  )
}

function app() {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    await next()
  }
  const a = new Hono()
  routes.registerCiCostFixRoutes(a as never, {
    ...routes.defaultCiCostFixRouteDeps,
    getServiceClient: () => db as never,
    adminOrApiKeyRead: pass as never,
    adminOrApiKeyWrite: pass as never,
    callerCanAccessProject: (async (_c: unknown, _db: unknown, _u: string, projectId: string) => ({ allowed: role !== null && projectId === allowedProject, role })) as never,
    claimRateLimit: calls.rate as never,
    refresh: calls.refresh as never,
    invokeWorker: calls.invoke,
    logAudit: calls.audit as never,
    now: () => NOW,
  })
  return a
}

async function call(method: string, path: string, body?: unknown) {
  const res = await app().request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, json: (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string } } }
}

const BODY = { projectId: P, repo: 'acme/app', workflowPath: '.github/workflows/ci.yml', kind: 'skip_drafts', evidence: 'runs on drafts', monthSavingUsd: 3.456 }

beforeEach(() => {
  role = 'member'
  allowedProject = P
  for (const f of Object.values(calls)) f.mockReset()
  calls.rate.mockResolvedValue({ allowed: true })
  calls.audit.mockResolvedValue(undefined)
  calls.refresh.mockImplementation(async (_db: unknown, j: unknown) => ({ ...(j as Row), merged_at: '2026-10-26T00:00:00Z' }))
  seed()
})

describe('POST /v1/admin/ci/cost-fixes', () => {
  it('queues one job with the repo as the project names it, fires the worker and audits', async () => {
    const res = await call('POST', '/v1/admin/ci/cost-fixes', BODY)
    expect(res.status).toBe(202)
    expect(res.json.data.job).toMatchObject({ status: 'queued', repo: 'Acme/App', kind: 'skip_drafts', workflowPath: '.github/workflows/ci.yml', monthSavingUsd: 3.46 })
    const stored = db.tables.ci_cost_fix_jobs
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ project_id: P, requested_by: USER, evidence: 'runs on drafts', status: 'queued' })
    expect(calls.invoke).toHaveBeenCalledWith(stored[0].id)
    expect(calls.rate).toHaveBeenCalledWith(db, `project:${P}:ci_cost_fix`, routes.COST_FIXES_PER_HOUR, 3600)
    expect(calls.audit).toHaveBeenCalledWith(db, P, USER, 'settings.updated', 'ci_cost_fix', stored[0].id, expect.objectContaining({ kind: 'skip_drafts' }), expect.anything())
  })

  it('validates the body: kind, repo, a path under .github/workflows, no ..', async () => {
    for (const bad of [
      { ...BODY, kind: 'rm_rf' },
      { ...BODY, repo: 'acme' },
      { ...BODY, workflowPath: 'scripts/deploy.yml' },
      { ...BODY, workflowPath: '.github/workflows/../../x.yml' },
      { ...BODY, projectId: 'acme' },
      { ...BODY, monthSavingUsd: -1 },
    ]) {
      const res = await call('POST', '/v1/admin/ci/cost-fixes', bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
    expect(calls.invoke).not.toHaveBeenCalled()
  })

  it('refuses viewers, other projects and repos the project does not have', async () => {
    role = 'viewer'
    expect((await call('POST', '/v1/admin/ci/cost-fixes', BODY)).status).toBe(403)
    role = 'member'
    allowedProject = OTHER
    expect((await call('POST', '/v1/admin/ci/cost-fixes', BODY)).status).toBe(404)
    allowedProject = P
    const res = await call('POST', '/v1/admin/ci/cost-fixes', { ...BODY, repo: 'acme/other' })
    expect(res.status).toBe(404)
    expect(res.json.error?.code).toBe('REPO_NOT_IN_PROJECT')
    expect(db.tables.ci_cost_fix_jobs).toHaveLength(0)
  })

  it('is rate limited per project', async () => {
    calls.rate.mockResolvedValue({ allowed: false, retryAfterSec: 120 })
    const res = await call('POST', '/v1/admin/ci/cost-fixes', BODY)
    expect(res.status).toBe(429)
    expect(res.json.error?.message).toContain(`${routes.COST_FIXES_PER_HOUR} CI fix pull requests an hour`)
  })

  it('answers 409 with the job when its PR is still open, and when the same edit is in flight', async () => {
    seed([job({ status: 'pr_opened', repo: 'Acme/App', pr_url: 'https://github.com/Acme/App/pull/7' })])
    const open = await call('POST', '/v1/admin/ci/cost-fixes', BODY)
    expect(open.status).toBe(409)
    expect(open.json.error?.code).toBe('PR_ALREADY_OPEN')
    expect(open.json.data.job.prUrl).toBe('https://github.com/Acme/App/pull/7')

    db = makeFakeDb(
      { ci_cost_fix_jobs: [job({ repo: 'Acme/App' })], project_repos: [{ project_id: P, repo_url: 'https://github.com/Acme/App' }], project_settings: [] },
      { autoId: true, uniques: { ci_cost_fix_jobs: ['project_id', 'repo', 'workflow_path', 'kind', 'status'] } },
    )
    const busy = await call('POST', '/v1/admin/ci/cost-fixes', BODY)
    expect(busy.status).toBe(409)
    expect(busy.json.error?.code).toBe('COST_FIX_IN_PROGRESS')
    expect(calls.invoke).not.toHaveBeenCalled()
  })
})

describe('GET /v1/admin/ci/cost-fixes', () => {
  it('measures an opened PR on read', async () => {
    seed([job({ status: 'pr_opened', pr_number: 7 })])
    const res = await call('GET', `/v1/admin/ci/cost-fixes/${JOB}`)
    expect(res.status).toBe(200)
    expect(calls.refresh).toHaveBeenCalledTimes(1)
    expect(res.json.data.job).toMatchObject({ id: JOB, status: 'pr_opened', mergedAt: '2026-10-26T00:00:00Z' })
  })

  it('fires the worker again for a job queued over two minutes ago, not for a fresh one', async () => {
    seed([job()])
    await call('GET', `/v1/admin/ci/cost-fixes/${JOB}`)
    expect(calls.invoke).not.toHaveBeenCalled()
    seed([job({ created_at: '2026-10-27T11:50:00Z' })])
    await call('GET', `/v1/admin/ci/cost-fixes/${JOB}`)
    expect(calls.invoke).toHaveBeenCalledWith(JOB)
    expect(calls.refresh).not.toHaveBeenCalled()
  })

  it('hides another project\'s job and rejects a bad id', async () => {
    seed([job({ project_id: OTHER })])
    expect((await call('GET', `/v1/admin/ci/cost-fixes/${JOB}`)).status).toBe(404)
    expect((await call('GET', '/v1/admin/ci/cost-fixes/abc')).status).toBe(400)
  })

  it('lists the project\'s jobs newest first, and needs a project', async () => {
    seed([job(), job({ id: '4000000b-0000-4000-8000-000000000000', created_at: '2026-10-27T11:00:00Z', status: 'refused' }), job({ id: '4000000c-0000-4000-8000-000000000000', project_id: OTHER })])
    const res = await call('GET', `/v1/admin/ci/cost-fixes?project_id=${P}`)
    expect(res.status).toBe(200)
    expect(res.json.data.jobs.map((j: { id: string }) => j.id)).toEqual([JOB, '4000000b-0000-4000-8000-000000000000'])
    expect((await call('GET', '/v1/admin/ci/cost-fixes')).status).toBe(400)
  })
})

describe('routing', () => {
  it('api forwards /v1/admin/ci/* to api-ext, which registers the cost-fix routes', () => {
    const api = readFileSync(resolve(__dirname, '../../supabase/functions/api/index.ts'), 'utf8')
    const ext = readFileSync(resolve(__dirname, '../../supabase/functions/api-ext/index.ts'), 'utf8')
    expect(api).toContain("'/v1/admin/ci/*'")
    expect(ext).toContain('registerCiCostFixRoutes(app)')
  })
})
