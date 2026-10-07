/**
 * FILE: ux-runs-pr.test.ts
 * PURPOSE: A UX run's pull request in the console (Plan 021): the CLI's sync
 *          stores it, the console reads its checks live, and a person's click
 *          merges it. The PR must be in a repo connected to the project, a
 *          viewer cannot merge, and a merge GitHub refuses says why.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { summarizeChecks } from '../../supabase/functions/_shared/ux-runs.ts'

const P = '1a000000-0000-4000-8000-000000000000'
const RUN = '20261007-115031-7po3'
const PR = 'https://github.com/kensaurus/glot.it/pull/147'

const state = vi.hoisted(() => ({
  db: null as unknown,
  role: null as string | null,
  merge: vi.fn(),
  audit: vi.fn(async () => null),
  token: 'tok' as string | null,
}))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: state.audit }))
vi.mock('../../supabase/functions/_shared/fix-merge.ts', () => ({
  mergeGithubPullRequest: state.merge,
  parsePrRepoRef: (url: string) => {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//)
    return m ? { owner: m[1], repo: m[2] } : null
  },
}))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  parseGithubRepoUrl: (url: string | null) => {
    const m = url?.match(/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/)
    return m ? { owner: m[1], repo: m[2] } : null
  },
  resolveProjectGithubToken: async () => state.token,
  fetchPullRequestDetails: async () => ({
    number: 147, draft: true, state: 'open', merged: false, htmlUrl: PR, headRef: `mushi-ux/${RUN}`,
    headSha: 'abc1234', baseRef: 'main', mergeable: true, mergeableState: 'blocked',
  }),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) =>
    c.json({ ok: false, error: { code, message } }, status),
  callerCanAccessProject: async () => ({ allowed: true, role: state.role }),
}))

let routes: typeof import('../../supabase/functions/api/routes/ux-runs.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/ux-runs.ts')
})
afterEach(() => vi.unstubAllGlobals())

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } }
type Handler = (c: unknown) => Promise<unknown>

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  private add(method: string) {
    return (path: string, ...handlers: Handler[]) => this.routes.push({ method, path, handler: handlers[handlers.length - 1] })
  }
  get = this.add('GET')
  post = this.add('POST')
  put = this.add('PUT')
  async call(method: string, path: string, body?: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const params: Record<string, string> = { pid: P, runId: RUN }
    const c = {
      req: { json: async () => body, param: (k: string) => params[k], query: () => undefined },
      get: (k: string) => ({ userId: 'u1' })[k as 'userId'],
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

const BASE = '/v1/admin/projects/:pid/ux-runs/:runId'
const snapshot = (pr?: { url: string; number: number } | null) => ({
  status: 'done', agent: 'cursor', model: 'grok-4.7-xhigh', judge_model: null, branch: `mushi-ux/${RUN}`,
  base_sha: '177734ea7', cli_version: null, started_at: '2026-10-07T11:50:31.000Z', finished_at: '2026-10-07T14:00:00.000Z',
  surfaces: [], ...(pr !== undefined ? { pr } : {}),
})

function setup(repo = 'https://github.com/kensaurus/glot.it'): { db: FakeDb; app: FakeApp } {
  const db = makeFakeDb(
    { ux_runs: [], ux_surfaces: [], ux_iterations: [], project_repos: [{ project_id: P, repo_url: repo }], project_settings: [{ project_id: P, github_repo_url: null }] },
    { autoId: true, uniques: { ux_runs: ['project_id', 'local_run_id'] } },
  )
  state.db = db
  state.role = null
  state.token = 'tok'
  state.merge.mockReset()
  state.audit.mockClear()
  // No test reaches GitHub; stubGithub() replaces this where a test needs answers.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  const app = new FakeApp()
  routes.registerUxRunsRoutes(app as never)
  return { db, app }
}

function stubGithub(checkRuns: Array<{ name: string; status: string; conclusion: string | null; started_at?: string }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/issues/147')) return new Response(JSON.stringify({ title: 'fix(ux): steadier tone training' }))
    if (url.includes('/rules/branches/main')) return new Response(JSON.stringify([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'gate' }] } }]))
    if (url.includes('/check-runs')) return new Response(JSON.stringify({ check_runs: checkRuns }))
    return new Response('{}', { status: 404 })
  }))
}

describe('a UX run pull request', () => {
  it('is stored from the sync, and a later sync without it keeps it', async () => {
    const { db, app } = setup()
    expect((await app.call('PUT', BASE, snapshot({ url: PR, number: 147 }))).status).toBe(200)
    expect(db.table('ux_runs')[0]).toMatchObject({ pr_url: PR, pr_number: 147 })
    expect((await app.call('PUT', BASE, snapshot())).status).toBe(200)
    expect(db.table('ux_runs')[0]).toMatchObject({ pr_url: PR, pr_number: 147 })
  })

  it('reads its state and required checks live from GitHub', async () => {
    const { app } = setup()
    await app.call('PUT', BASE, snapshot({ url: PR, number: 147 }))
    stubGithub([{ name: 'gate', status: 'in_progress', conclusion: null }, { name: 'lint', status: 'completed', conclusion: 'success' }])
    const res = await app.call('GET', `${BASE}/pull-request`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ number: 147, state: 'draft', baseRef: 'main', title: 'fix(ux): steadier tone training' })
    expect(res.body.data?.checks).toMatchObject({ required: ['gate'], passing: false, pending: 1, failing: 0 })
  })

  it('refuses a PR in a repo that is not connected to the project', async () => {
    const { app } = setup('https://github.com/kensaurus/other-app')
    await app.call('PUT', BASE, snapshot({ url: PR, number: 147 }))
    const res = await app.call('GET', `${BASE}/pull-request`)
    expect(res.status).toBe(403)
    expect(res.body.error?.message).toContain('kensaurus/glot.it is not connected')
  })

  it('says so when there is no PR or no GitHub connection', async () => {
    const { app } = setup()
    await app.call('PUT', BASE, snapshot())
    expect((await app.call('GET', `${BASE}/pull-request`)).body.error?.code).toBe('NO_PR')
    await app.call('PUT', BASE, snapshot({ url: PR, number: 147 }))
    state.token = null
    expect((await app.call('POST', `${BASE}/merge`, {})).body.error?.code).toBe('GITHUB_NOT_CONNECTED')
  })

  it('merges on a click, records it, and a viewer cannot', async () => {
    const { db, app } = setup()
    await app.call('PUT', BASE, snapshot({ url: PR, number: 147 }))
    state.role = 'viewer'
    expect((await app.call('POST', `${BASE}/merge`, {})).status).toBe(403)
    state.role = 'admin'
    state.merge.mockResolvedValueOnce({ merged: true, alreadyMerged: false, sha: 'def5678' })
    const res = await app.call('POST', `${BASE}/merge`, { method: 'squash' })
    expect(res.status).toBe(200)
    expect(state.merge).toHaveBeenCalledWith('tok', { owner: 'kensaurus', repo: 'glot.it' }, 147, {
      mergeMethod: 'squash',
      commitTitle: undefined,
      commitMessage: `Merged from the Mushi console (UX run ${RUN}).`,
    })
    expect(db.table('ux_runs')[0]).toMatchObject({ pr_state: 'merged' })
    expect(state.audit).toHaveBeenCalledWith(expect.anything(), P, 'u1', 'ux_run.merged', 'ux_run', expect.any(String), expect.objectContaining({ pr_number: 147 }))
  })

  it('passes on why GitHub refused a merge', async () => {
    const { db, app } = setup()
    await app.call('PUT', BASE, snapshot({ url: PR, number: 147 }))
    state.merge.mockResolvedValueOnce({ merged: false, alreadyMerged: false, message: 'Required status check "gate" is failing.' })
    const res = await app.call('POST', `${BASE}/merge`, {})
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'MERGE_REJECTED', message: 'Required status check "gate" is failing.' })
    expect(db.table('ux_runs')[0].pr_state).toBeUndefined()
  })
})

// A bot commit's "[skip ci]" in GitHub's default squash message skipped every workflow on the
// merge, a store release included (glot.it #146, 2026-10-07).
describe('the squash message a console merge writes', () => {
  it('never carries a CI-skip marker', () => {
    expect(routes.stripCiSkips('fix(ux): polish screens [skip ci]')).toBe('fix(ux): polish screens')
    expect(routes.stripCiSkips('chore: [ci skip] regen ***NO_CI***')).toBe('chore: regen')
  })
  it('titles the squash with the PR title and its number', async () => {
    const { app } = setup()
    await app.call('PUT', BASE, snapshot({ url: PR, number: 147 }))
    stubGithub([])
    state.role = 'admin'
    state.merge.mockResolvedValueOnce({ merged: true, alreadyMerged: false })
    await app.call('POST', `${BASE}/merge`, { method: 'squash' })
    expect(state.merge.mock.calls[0][3]).toMatchObject({ commitTitle: 'fix(ux): steadier tone training (#147)' })
    expect(state.merge.mock.calls[0][3].commitMessage).not.toMatch(/skip ci/i)
  })
})

describe('summarizeChecks', () => {
  it('counts a required check that has not reported as pending', () => {
    expect(summarizeChecks(['gate'], [{ name: 'lint', status: 'completed', conclusion: 'success' }])).toMatchObject({ passing: false, pending: 1, failing: 0 })
  })
  it('takes the newest run of a re-run check', () => {
    const s = summarizeChecks(['gate'], [
      { name: 'gate', status: 'completed', conclusion: 'failure', started_at: '2026-10-07T10:00:00Z' },
      { name: 'gate', status: 'completed', conclusion: 'success', started_at: '2026-10-07T11:00:00Z' },
    ])
    expect(s).toMatchObject({ passing: true, pending: 0, failing: 0 })
  })
  it('judges every check when the branch requires none', () => {
    expect(summarizeChecks([], [{ name: 'a', status: 'completed', conclusion: 'failure' }])).toMatchObject({ passing: false, failing: 1 })
    expect(summarizeChecks([], [{ name: 'a', status: 'completed', conclusion: 'skipped' }]).passing).toBe(true)
  })
})
