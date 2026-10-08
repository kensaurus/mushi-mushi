/**
 * FILE: ux-cloud.test.ts
 * PURPOSE: Plan 021 Phase 4 "Start a cloud UX run": the payload shape is closed
 *          (only cursor-cloud, no shell characters), the front end repo is the
 *          target, the platform GitHub token is never used, a missing workflow
 *          or a refused dispatch answers with the command to run by hand, and
 *          a good request fires one repository_dispatch.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  CloudRunInput,
  clientPayload,
  fallbackCommand,
  pickUxRepo,
} from '../../supabase/functions/_shared/ux-cloud.ts'

const P = '1a000000-0000-4000-8000-000000000000'

const state = vi.hoisted(() => ({
  db: null as unknown,
  members: new Set<string>(),
  role: null as string | null,
  token: 'ghs_test' as string | null,
  tokenOpts: [] as unknown[],
  rateAllowed: true,
  audits: [] as unknown[],
}))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({
  logAudit: async (...args: unknown[]) => {
    state.audits.push(args)
  },
}))
vi.mock('../../supabase/functions/_shared/tenant-observability.ts', () => ({
  claimTenantRateLimit: async () => (state.rateAllowed ? { allowed: true } : { allowed: false, retryAfterSec: 120 }),
}))
vi.mock('../../supabase/functions/_shared/github.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveProjectGithubToken: async (_db: unknown, _p: string, _i: unknown, opts: unknown) => {
    state.tokenOpts.push(opts)
    return state.token
  },
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) =>
    c.json({ ok: false, error: { code, message } }, status),
  callerCanAccessProject: async (_c: unknown, _db: unknown, _u: string, projectId: string) => ({
    allowed: state.members.has(projectId),
    role: state.role,
  }),
}))

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
type Handler = (c: unknown) => Promise<unknown>
let handler: Handler

beforeAll(async () => {
  const { registerUxCloudRoutes } = await import('../../supabase/functions/api/routes/ux-cloud.ts')
  const app = { post: (_p: string, ...hs: Handler[]) => (handler = hs[hs.length - 1]) }
  registerUxCloudRoutes(app as never)
})

async function call(body: unknown): Promise<Res> {
  const c = {
    req: { json: async () => body, param: (k: string) => ({ pid: P })[k as 'pid'] },
    get: (k: string) => ({ userId: 'u1', userEmail: 'a@b.c' })[k as 'userId'],
    json: (b: unknown, status = 200) => ({ body: b, status }),
  }
  return (await handler(c)) as Res
}

const repos = [
  { project_id: P, repo_url: 'https://github.com/o/api', role: 'backend', is_primary: true, default_branch: 'main', github_app_installation_id: 7 },
  { project_id: P, repo_url: 'https://github.com/o/web', role: 'frontend', is_primary: false, default_branch: 'main', github_app_installation_id: 8 },
]

let calls: Array<{ url: string; method: string; body?: unknown }> = []
function stubGithub(opts: { workflow?: boolean; dispatchStatus?: number } = {}) {
  calls = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === 'https://api.github.com/repos/o/web') return new Response(JSON.stringify({ default_branch: 'master' }))
    if (url.includes('/contents/')) return new Response('{}', { status: opts.workflow === false ? 404 : 200 })
    if (url.endsWith('/dispatches')) return new Response(null, { status: opts.dispatchStatus ?? 204 })
    return new Response('{}', { status: 404 })
  })
}

beforeEach(() => {
  state.db = makeFakeDb({ project_repos: repos.map((r) => ({ ...r })), project_settings: [] })
  state.members = new Set([P])
  state.role = null
  state.token = 'ghs_test'
  state.tokenOpts = []
  state.rateAllowed = true
  state.audits = []
})

describe('cloud run input', () => {
  it('defaults to a small cursor-cloud pass and refuses anything else', () => {
    expect(CloudRunInput.parse({})).toEqual({ agent: 'cursor-cloud', max_surfaces: 5, iterations: 2 })
    expect(CloudRunInput.safeParse({ agent: 'claude-code' }).success).toBe(false)
    expect(CloudRunInput.safeParse({ model: 'grok-4.7?reasoning_effort=xhigh' }).success).toBe(true)
    expect(CloudRunInput.safeParse({ model: 'x; rm -rf /' }).success).toBe(false)
    expect(CloudRunInput.safeParse({ model: "a'$(id)" }).success).toBe(false)
    expect(CloudRunInput.safeParse({ paths: '/,/settings' }).success).toBe(true)
    expect(CloudRunInput.safeParse({ paths: '/ $(id)' }).success).toBe(false)
    expect(CloudRunInput.safeParse({ max_surfaces: 500 }).success).toBe(false)
    expect(CloudRunInput.safeParse({ extra: 1 }).success).toBe(false)
  })

  it('keeps client_payload under GitHub’s 10-key cap and builds a quoted fallback', () => {
    const input = CloudRunInput.parse({ model: 'grok-4.7?reasoning_effort=xhigh', paths: '/' })
    expect(Object.keys(clientPayload(input)).length).toBeLessThanOrEqual(10)
    expect(fallbackCommand('o', 'web', input)).toBe(
      "gh workflow run mushi-ux.yml --repo o/web -f agent=cursor-cloud -f model='grok-4.7?reasoning_effort=xhigh' -f max_surfaces=5 -f iterations=2 -f paths='/'",
    )
  })

  it('targets a front end repo before a primary backend', () => {
    expect(pickUxRepo(repos, null)?.repoUrl).toBe('https://github.com/o/web')
    expect(pickUxRepo([repos[0]], null)?.repoUrl).toBe('https://github.com/o/api')
    expect(pickUxRepo([], 'https://github.com/o/legacy')?.repoUrl).toBe('https://github.com/o/legacy')
    expect(pickUxRepo([], null)).toBeNull()
  })
})

describe('POST /v1/admin/projects/:pid/ux-runs/cloud', () => {
  it('fires one repository_dispatch at the front end repo on its default branch', async () => {
    stubGithub()
    const res = await call({ model: 'grok-4.7', max_surfaces: 3 })
    expect(res.status).toBe(202)
    expect(res.body.data).toMatchObject({ repo: 'o/web' })
    expect(calls.find((c) => c.url.includes('/contents/'))?.url).toBe(
      'https://api.github.com/repos/o/web/contents/.github/workflows/mushi-ux.yml?ref=master',
    )
    const dispatch = calls.filter((c) => c.method === 'POST')
    expect(dispatch).toHaveLength(1)
    expect(dispatch[0]).toMatchObject({
      url: 'https://api.github.com/repos/o/web/dispatches',
      body: { event_type: 'mushi-ux-run', client_payload: { agent: 'cursor-cloud', model: 'grok-4.7', max_surfaces: 3, iterations: 2 } },
    })
    expect(state.tokenOpts[0]).toEqual({ allowEnvFallback: false })
    // No Mushi user id travels into the host's event.
    expect(JSON.stringify(dispatch[0].body)).not.toContain('u1')
    expect(state.audits).toHaveLength(1)
  })

  it('refuses non-members and bad input before touching GitHub', async () => {
    stubGithub()
    state.members = new Set()
    expect((await call({})).status).toBe(403)
    state.members = new Set([P])
    expect((await call({ agent: 'claude-code' })).status).toBe(400)
    state.role = 'viewer'
    expect((await call({})).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('answers with the command to run by hand when the workflow is missing', async () => {
    stubGithub({ workflow: false })
    const res = await call({})
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('WORKFLOW_MISSING')
    expect((res.body.data?.fallback as { command: string } | undefined)?.command).toContain('gh workflow run mushi-ux.yml --repo o/web')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('falls back when GitHub refuses the dispatch or no token exists', async () => {
    stubGithub({ dispatchStatus: 403 })
    const refused = await call({})
    expect(refused.status).toBe(409)
    expect(refused.body.error?.code).toBe('GH_DISPATCH_FORBIDDEN')
    expect((refused.body.data?.fallback as { command: string } | undefined)?.command).toBeTruthy()
    expect(state.audits).toHaveLength(0)

    stubGithub()
    state.token = null
    const noToken = await call({})
    expect(noToken.status).toBe(409)
    expect(noToken.body.error?.code).toBe('NO_GITHUB_TOKEN')
    expect(calls).toHaveLength(0)
  })

  it('says so when the GitHub connection cannot see the repo', async () => {
    stubGithub()
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push({ url, method: 'GET' })
      return new Response('{}', { status: url === 'https://api.github.com/repos/o/web' ? 404 : 200 })
    })
    const res = await call({})
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('NO_REPO_ACCESS')
    expect(calls.some((c) => c.url.includes('/contents/'))).toBe(false)
  })

  it('reports a GitHub outage as a 502', async () => {
    stubGithub({ dispatchStatus: 503 })
    const res = await call({})
    expect(res.status).toBe(502)
    expect(res.body.error?.code).toBe('GH_DISPATCH_FAILED')
  })

  it('rate-limits per app', async () => {
    stubGithub()
    state.rateAllowed = false
    const res = await call({})
    expect(res.status).toBe(429)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})
