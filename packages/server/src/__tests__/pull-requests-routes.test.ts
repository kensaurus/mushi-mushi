/**
 * FILE: pull-requests-routes.test.ts
 * PURPOSE: The console's Pull requests page reads and merges with the GitHub
 *          App installation of the repo it lists. resolveProjectGithubToken
 *          mints an App token only when handed an installation id; without one
 *          a project with the App installed and no stored token answered 409
 *          "Connect GitHub" (lets-talk, 2026-10-14). The merge keeps its
 *          CI-skip stripping and its viewer and connected-repo refusals.
 *          A PR that is a Mushi fix goes through the Opus review gate
 *          (ADR 0030), and the list shows its review.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

const P = '3d2abd0b-cfd1-4b31-a8cd-3db158923862'

const state = vi.hoisted(() => ({
  db: null as unknown,
  role: null as string | null,
  authMethod: 'jwt' as string,
  merge: vi.fn(),
  audit: vi.fn(async () => null),
  resolveCalls: [] as Array<{ installationId: unknown; opts: unknown }>,
  /** Installation id → token; null (no installation) has no stored token here, like lets-talk. */
  tokens: new Map<number | null, string | null>([[null, null]]),
}))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: state.audit }))
vi.mock('../../supabase/functions/_shared/fix-merge.ts', () => ({ mergeGithubPullRequest: state.merge }))
vi.mock('../../supabase/functions/_shared/github.ts', async (importOriginal) => ({
  // The real reader of GitHub's `base.repo`: the merge gate keys on it.
  baseRepoOf: (await importOriginal<typeof import('../../supabase/functions/_shared/github.ts')>()).baseRepoOf,
  parseGithubRepoUrl: (url: string | null) => {
    const m = url?.match(/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/)
    return m ? { owner: m[1], repo: m[2] } : null
  },
  resolveProjectGithubToken: async (_db: unknown, _p: string, installationId: number | null = null, opts: unknown = {}) => {
    state.resolveCalls.push({ installationId, opts })
    return state.tokens.get(installationId) ?? null
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) =>
    c.json({ ok: false, error: { code, message } }, status),
  callerCanAccessProject: async () => ({ allowed: true, role: state.role }),
}))

let routes: typeof import('../../supabase/functions/api/routes/pull-requests.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/pull-requests.ts')
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
  async call(method: string, path: string, params: Record<string, string> = {}, body?: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const all: Record<string, string> = { pid: P, ...params }
    const c = {
      req: { json: async () => body, param: (k: string) => all[k], query: () => undefined },
      get: (k: string) => ({ userId: 'u1', authMethod: state.authMethod } as Record<string, string>)[k],
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

const LIST = '/v1/admin/projects/:pid/pull-requests'
const MERGE = '/v1/admin/projects/:pid/pull-requests/:owner/:repo/:number/merge'

type RepoRow = { repo_url: string; is_primary: boolean; github_app_installation_id: number | null }

function setup(repos: RepoRow[], settingsRepo: string | null = null, extra: Record<string, Array<Record<string, unknown>>> = {}): FakeApp {
  state.db = makeFakeDb({
    project_repos: repos.map((r) => ({ project_id: P, ...r })),
    project_settings: [{ project_id: P, github_repo_url: settingsRepo, github_installation_token_ref: null }],
    ...extra,
  })
  state.role = null
  state.authMethod = 'jwt'
  state.resolveCalls = []
  state.tokens = new Map<number | null, string | null>([[null, null]])
  state.merge.mockReset()
  state.audit.mockClear()
  const app = new FakeApp()
  routes.registerPullRequestRoutes(app as never)
  return app
}

/** GitHub answers per repo, and records which token each request carried. */
function stubGithub(): Array<{ url: string; auth: string | null }> {
  const seen: Array<{ url: string; auth: string | null }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url, auth: init?.headers?.Authorization ?? null })
    const repo = url.match(/repos\/([^/]+\/[^/]+)\//)?.[1] ?? ''
    if (url.includes('/pulls?state=open')) {
      return new Response(JSON.stringify([{
        number: 7, title: `open in ${repo}`, html_url: `https://github.com/${repo}/pull/7`, draft: false,
        user: { login: 'kensaurus' }, head: { ref: 'feat/x', sha: 'abc' }, base: { ref: 'main' }, updated_at: '2026-10-14T00:00:00Z',
      }]))
    }
    if (/\/pulls\/\d+$/.test(url)) return new Response(JSON.stringify({ title: 'chore: release [skip ci]', state: 'open', head: { sha: 'abc' } }))
    if (url.includes('/rules/branches/')) return new Response('[]')
    if (url.includes('/check-runs')) return new Response(JSON.stringify({ check_runs: [] }))
    return new Response('{}', { status: 404 })
  }))
  return seen
}

describe('the Pull requests page with only the GitHub App installed', () => {
  it('lists open PRs with the installation token of the primary repo', async () => {
    const app = setup([{ repo_url: 'https://github.com/kensaurus/cooler-heads', is_primary: true, github_app_installation_id: 167392430 }], 'https://github.com/kensaurus/cooler-heads')
    state.tokens.set(167392430, 'ghs_app')
    const seen = stubGithub()
    const res = await app.call('GET', LIST)
    expect(res.status).toBe(200)
    expect(res.body.data?.repos).toEqual(['kensaurus/cooler-heads'])
    expect((res.body.data?.pullRequests as unknown[]).length).toBe(1)
    expect(state.resolveCalls).toContainEqual({ installationId: 167392430, opts: { allowEnvFallback: false } })
    expect(state.resolveCalls.every((c) => (c.opts as { allowEnvFallback?: boolean }).allowEnvFallback === false)).toBe(true)
    expect(seen.every((s) => s.auth === 'Bearer ghs_app')).toBe(true)
  })

  it('reads each repo with its own installation, and a settings-only repo with the primary one', async () => {
    const app = setup(
      [
        { repo_url: 'https://github.com/kensaurus/sbc-docs', is_primary: true, github_app_installation_id: 111 },
        { repo_url: 'https://github.com/other-org/sbc_backend', is_primary: false, github_app_installation_id: 222 },
      ],
      'https://github.com/kensaurus/legacy-app',
    )
    state.tokens.set(111, 'ghs_111')
    state.tokens.set(222, 'ghs_222')
    const seen = stubGithub()
    const res = await app.call('GET', LIST)
    expect(res.status).toBe(200)
    expect(res.body.data?.repos).toEqual(['kensaurus/sbc-docs', 'other-org/sbc_backend', 'kensaurus/legacy-app'])
    const authFor = (repo: string) => [...new Set(seen.filter((s) => s.url.includes(`/repos/${repo}/`)).map((s) => s.auth))]
    expect(authFor('kensaurus/sbc-docs')).toEqual(['Bearer ghs_111'])
    expect(authFor('other-org/sbc_backend')).toEqual(['Bearer ghs_222'])
    expect(authFor('kensaurus/legacy-app')).toEqual(['Bearer ghs_111'])
    // One mint per installation per request, not one per repo.
    expect(state.resolveCalls.filter((c) => c.installationId === 111)).toHaveLength(1)
  })

  it('still answers 409 when no repo resolves a token', async () => {
    const app = setup([{ repo_url: 'https://github.com/kensaurus/cooler-heads', is_primary: true, github_app_installation_id: null }])
    stubGithub()
    const res = await app.call('GET', LIST)
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('GITHUB_NOT_CONNECTED')
  })
})

describe('merging from the Pull requests page', () => {
  const repos: RepoRow[] = [
    { repo_url: 'https://github.com/kensaurus/sbc-docs', is_primary: true, github_app_installation_id: 111 },
    { repo_url: 'https://github.com/other-org/sbc_backend', is_primary: false, github_app_installation_id: 222 },
  ]

  it('merges with the installation of the repo in the path and strips CI-skip markers', async () => {
    const app = setup(repos)
    state.tokens.set(111, 'ghs_111')
    state.tokens.set(222, 'ghs_222')
    stubGithub()
    state.merge.mockResolvedValue({ merged: true, alreadyMerged: false, sha: 'deadbee', message: 'ok' })
    const res = await app.call('POST', MERGE, { owner: 'other-org', repo: 'sbc_backend', number: '7' }, {})
    expect(res.status).toBe(200)
    expect(state.resolveCalls).toEqual([{ installationId: 222, opts: { allowEnvFallback: false } }])
    const [token, ref, number, opts] = state.merge.mock.calls[0]
    expect(token).toBe('ghs_222')
    expect(ref).toEqual({ owner: 'other-org', repo: 'sbc_backend' })
    expect(number).toBe(7)
    expect(opts.commitTitle).toBe('chore: release (#7)')
  })

  it('refuses a viewer and a repo that is not connected, before any token is resolved', async () => {
    const app = setup(repos)
    stubGithub()
    state.role = 'viewer'
    expect((await app.call('POST', MERGE, { owner: 'kensaurus', repo: 'sbc-docs', number: '7' }, {})).status).toBe(403)
    state.role = 'admin'
    expect((await app.call('POST', MERGE, { owner: 'someone', repo: 'elses', number: '7' }, {})).status).toBe(403)
    expect(state.resolveCalls).toEqual([])
    expect(state.merge).not.toHaveBeenCalled()
  })
})

describe('a Mushi fix PR on the Pull requests page (ADR 0030)', () => {
  const repos: RepoRow[] = [{ repo_url: 'https://github.com/kensaurus/sbc-docs', is_primary: true, github_app_installation_id: 111 }]
  const fixAttempt = { id: 'fa-7', project_id: P, pr_number: 7, pr_url: 'https://github.com/kensaurus/sbc-docs/pull/7', created_at: '2026-10-20T00:00:00Z' }
  const hold = {
    id: 'rev-7', fix_attempt_id: 'fa-7', project_id: P, status: 'completed', verdict: 'hold', head_sha: 'abc',
    repo: 'kensaurus/sbc-docs', pr_number: 7, pr_url: 'https://github.com/kensaurus/sbc-docs/pull/7',
    findings: [], removes_behavior: [], rules_applied: [], summary: 'Removes the resume flow.', reviewed_at: '2026-10-21T00:00:00Z',
  }

  it('the list shows the review of a fix PR', async () => {
    const app = setup(repos, null, { fix_attempts: [fixAttempt], fix_reviews: [hold] })
    state.tokens.set(111, 'ghs_111')
    stubGithub()
    const res = await app.call('GET', LIST)
    const pr = (res.body.data?.pullRequests as Array<{ review?: unknown }>)[0]
    expect(pr.review).toEqual({ state: 'hold', label: 'Opus review: hold', fixId: 'fa-7', verdict: 'hold', pending: false })
  })

  it('refuses to merge a held fix PR, and never reaches GitHub', async () => {
    const app = setup(repos, null, { fix_attempts: [fixAttempt], fix_reviews: [hold] })
    state.tokens.set(111, 'ghs_111')
    stubGithub()
    const res = await app.call('POST', MERGE, { owner: 'kensaurus', repo: 'sbc-docs', number: '7' }, {})
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('REVIEW_HOLD')
    expect(state.merge).not.toHaveBeenCalled()
  })

  it('a member overrides with a reason: merged at the reviewed head, audited', async () => {
    const app = setup(repos, null, { fix_attempts: [fixAttempt], fix_reviews: [hold] })
    state.tokens.set(111, 'ghs_111')
    stubGithub()
    state.role = 'member'
    state.merge.mockResolvedValue({ merged: true, alreadyMerged: false, sha: 'm1' })
    expect((await app.call('POST', MERGE, { owner: 'kensaurus', repo: 'sbc-docs', number: '7' }, { override: true })).status).toBe(400)
    const res = await app.call('POST', MERGE, { owner: 'kensaurus', repo: 'sbc-docs', number: '7' }, { override: true, overrideReason: 'Checked by hand' })
    expect(res.status).toBe(200)
    expect(state.merge.mock.calls[0][3]).toMatchObject({ sha: 'abc' })
    expect(state.audit.mock.calls[0][6]).toMatchObject({ fix_attempt_ids: ['fa-7'], review_state: 'hold', review_override: true, override_reason: 'Checked by hand', merged_head_sha: 'abc' })
  })

  it('a PR that is not a Mushi fix merges as before, without a pinned head', async () => {
    const app = setup(repos, null, { fix_attempts: [], fix_reviews: [] })
    state.tokens.set(111, 'ghs_111')
    stubGithub()
    state.merge.mockResolvedValue({ merged: true, alreadyMerged: false, sha: 'm1' })
    const res = await app.call('POST', MERGE, { owner: 'kensaurus', repo: 'sbc-docs', number: '7' }, {})
    expect(res.status).toBe(200)
    expect(state.merge.mock.calls[0][3]).not.toHaveProperty('sha')
  })
})
