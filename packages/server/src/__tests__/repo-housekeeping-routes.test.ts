/**
 * FILE: repo-housekeeping-routes.test.ts
 * PURPOSE: Repo clean-up (ADR 0051) through the real routes, the real
 *          connector-action approval and the real executor, on an in-memory
 *          database and a fake GitHub:
 *            - preview: only branches Mushi recorded, PR candidates, the
 *              race note, no token;
 *            - request: viewers, candidates only, ≤ 50, 5 an hour;
 *            - approve: console owner/admin only, hash-matched, expiring,
 *              single-use;
 *            - execute: every refusal re-checked on fresh reads (default,
 *              protected, open-PR head and base, moved tip, running row),
 *              the checked delete and the read-then-delete fallback, the
 *              item row written before a delete, the table missing, the repo
 *              unbound, the hourly run cap before the claim, one audit entry
 *              per item;
 *            - close: the pipeline close (team note), moved head, release train;
 *            - restore and the repo setting.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})
const notes = vi.hoisted(() => [] as Array<{ reportId: string; body: string; authorName: string }>)
const finalized = vi.hoisted(() => [] as string[])

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  requireApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400, extra?: Record<string, unknown>) =>
    c.json({ ok: false, error: { code, message, ...(extra ?? {}) } }, status),
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))
vi.mock('../../supabase/functions/_shared/fix-merge.ts', () => ({
  finalizeFixClosedUnmerged: async (_db: unknown, a: { id: string }) => {
    finalized.push(a.id)
    return { justClosed: true, reportStatus: 'classified' }
  },
}))
vi.mock('../../supabase/functions/_shared/reporter-comms.ts', () => ({
  postTeamNote: async (_db: unknown, p: { reportId: string; body: string; authorName: string }) => {
    notes.push(p)
    return { ok: true }
  },
}))

let routes: typeof import('../../supabase/functions/api/routes/repo-housekeeping.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/repo-housekeeping.ts')
})

const NOW = new Date('2026-10-27T12:00:00Z')
const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const REPO = 'kensaurus/app'
const sha = (ch: string) => ch.repeat(40)
const id = (n: number) => `3000000${n.toString(16)}-0000-4000-8000-000000000000`
const F = { f1: id(1), f2: id(2), f5: id(5), f6: id(6), f7: id(7) }

type Res = { status: number; body: { ok: boolean; data?: any; error?: { code: string; message: string; items?: unknown[] } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = []
  private add(method: string, path: string, h: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handler: h[h.length - 1], pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(p: string, ...h: Handler[]) { this.add('GET', p, h) }
  post(p: string, ...h: Handler[]) { this.add('POST', p, h) }
  async call(method: string, url: string, opts: { body?: unknown; query?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'jwt', ...opts.vars }
      const c = {
        req: { json: async () => opts.body ?? {}, param: (k: string) => params[k], header: () => undefined, query: (k: string) => opts.query?.[k] },
        get: (k: string) => vars[k],
        set: (k: string, v: unknown) => { vars[k] = v },
        header: () => {},
        json: (b: unknown, status = 200) => ({ body: b, status }),
      }
      return (await r.handler(c)) as Res
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

interface RawPull { number: number; state: 'open' | 'closed'; merged_at: string | null; closed_at: string | null; draft: boolean; head: { ref: string; sha: string; repo: { full_name: string } }; base: { ref: string } }

interface Gh {
  branches: Record<string, { sha: string; protected: boolean }>
  pulls: RawPull[]
  commitDates: Record<number, string>
  cas: 'ok' | 'unavailable' | 'refused'
  perms: { push: boolean; admin: boolean }
  deleteBranchOnMerge: boolean
  remaining: number
  calls: string[]
  /** Runs once just before the checked delete of this branch (a push in that moment). */
  beforeDelete?: Record<string, () => void>
}

const pullOf = (n: number, ref: string, head: string, over: Partial<RawPull> = {}): RawPull => ({
  number: n, state: 'closed', merged_at: '2026-10-20T00:00:00Z', closed_at: '2026-10-20T00:00:00Z', draft: false,
  head: { ref, sha: head, repo: { full_name: REPO } }, base: { ref: 'main' }, ...over,
})
const openPull = (n: number, ref: string, head: string, over: Partial<RawPull> = {}) => pullOf(n, ref, head, { state: 'open', merged_at: null, closed_at: null, ...over })

function freshGh(): Gh {
  return {
    branches: {
      main: { sha: sha('0'), protected: true },
      'mushi/fix-1': { sha: sha('a'), protected: false },
      'mushi/fix-2': { sha: sha('b'), protected: false },
      'mushi/train/20261020': { sha: sha('c'), protected: false },
      'mushi/fix-5': { sha: sha('5'), protected: false },
      'mushi/fix-6': { sha: sha('6'), protected: false },
      'mushi/fix-7': { sha: sha('7'), protected: false },
      'someone-else': { sha: sha('d'), protected: false },
    },
    pulls: [
      pullOf(1, 'mushi/fix-1', sha('a')),
      pullOf(2, 'mushi/fix-2', sha('b'), { merged_at: null }),
      pullOf(10, 'mushi/train/20261020', sha('c')),
      pullOf(99, 'someone-else', sha('d')),
      openPull(5, 'mushi/fix-5', sha('5')),
      openPull(6, 'mushi/fix-6', sha('6')),
      openPull(7, 'mushi/fix-7', sha('7'), { draft: true }),
    ],
    commitDates: { 5: '2026-10-25T00:00:00Z', 6: '2026-10-25T00:00:00Z', 7: '2026-10-25T00:00:00Z' },
    cas: 'ok',
    perms: { push: true, admin: true },
    deleteBranchOnMerge: false,
    remaining: 4000,
    calls: [],
  }
}

function githubFetch(gh: Gh) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    const u = new URL(url)
    const path = decodeURIComponent(u.pathname)
    gh.calls.push(`${method} ${path}${u.search}`)
    const headers = { 'x-ratelimit-remaining': String(gh.remaining) }
    const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers })
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const base = `/repos/${REPO}`
    if (path === '/graphql') {
      if (String(body.query).includes('updateRefs')) {
        const upd = body.variables.input.refUpdates[0] as { name: string; beforeOid: string }
        const name = upd.name.replace('refs/heads/', '')
        gh.beforeDelete?.[name]?.()
        if (gh.cas === 'unavailable') return json(200, { errors: [{ message: "Field 'updateRefs' doesn't exist on type 'Mutation'" }] })
        if (gh.cas === 'refused' || gh.branches[name]?.sha !== upd.beforeOid) return json(200, { errors: [{ message: 'Expected ref to point at the old oid' }] })
        delete gh.branches[name]
        return json(200, { data: { updateRefs: { clientMutationId: null } } })
      }
      const repo: Record<string, unknown> = {}
      for (const [n, at] of Object.entries(gh.commitDates)) repo[`p${n}`] = { commits: { nodes: [{ commit: { committedDate: at } }] } }
      return json(200, { data: { repository: repo } })
    }
    if (path === base && method === 'GET') return json(200, { default_branch: 'main', node_id: 'R_1', delete_branch_on_merge: gh.deleteBranchOnMerge, permissions: gh.perms })
    if (path === base && method === 'PATCH') {
      if (!gh.perms.admin) return json(403, { message: 'Resource not accessible' })
      gh.deleteBranchOnMerge = body.delete_branch_on_merge === true
      return json(200, { delete_branch_on_merge: gh.deleteBranchOnMerge })
    }
    if (path === `${base}/branches`) {
      const page = Number(u.searchParams.get('page') ?? '1')
      return json(200, page > 1 ? [] : Object.entries(gh.branches).map(([name, b]) => ({ name, commit: { sha: b.sha }, protected: b.protected })))
    }
    if (path.startsWith(`${base}/branches/`)) {
      const b = gh.branches[path.slice(`${base}/branches/`.length)]
      return b ? json(200, { commit: { sha: b.sha }, protected: b.protected }) : json(404, {})
    }
    if (path === `${base}/pulls`) {
      const state = u.searchParams.get('state')
      return json(200, Number(u.searchParams.get('page') ?? '1') > 1 ? [] : gh.pulls.filter((p) => p.state === state))
    }
    const pm = /^\/repos\/kensaurus\/app\/pulls\/(\d+)$/.exec(path)
    if (pm) {
      const p = gh.pulls.find((x) => x.number === Number(pm[1]))
      if (!p) return json(404, {})
      if (method === 'PATCH') p.state = body.state
      return json(200, p)
    }
    if (path.startsWith(`${base}/git/ref/heads/`)) {
      const b = gh.branches[path.slice(`${base}/git/ref/heads/`.length)]
      return b ? json(200, { object: { sha: b.sha } }) : json(404, {})
    }
    if (path.startsWith(`${base}/git/refs/heads/`) && method === 'DELETE') {
      const name = path.slice(`${base}/git/refs/heads/`.length)
      if (!gh.branches[name]) return json(422, {})
      delete gh.branches[name]
      return json(204, null)
    }
    if (path === `${base}/git/refs` && method === 'POST') {
      const name = String(body.ref).replace('refs/heads/', '')
      if (gh.branches[name]) return json(422, {})
      gh.branches[name] = { sha: body.sha, protected: false }
      return json(201, {})
    }
    return json(404, {})
  }
}

interface SetupOpts { orgRole?: string | null; projectRole?: string | null; rate?: boolean; token?: boolean; itemsMissing?: boolean; extra?: Record<string, unknown[]>; uniques?: Record<string, string[]> }

function setup(opts: SetupOpts = {}) {
  const db: FakeDb = makeFakeDb(
    {
      projects: [{ id: P1, name: 'app', organization_id: ORG }],
      project_repos: [{ project_id: P1, repo_url: `https://github.com/${REPO}` }],
      organization_members: opts.orgRole === null ? [] : [{ organization_id: ORG, user_id: 'u1', role: opts.orgRole ?? 'owner' }],
      fix_attempts: [
        { id: F.f1, project_id: P1, report_id: 'r1', agent: 'cursor_cloud', status: 'completed', branch: 'mushi/fix-1', branch_name: null, pr_url: `https://github.com/${REPO}/pull/1`, pr_number: 1, pr_state: 'merged', merged_at: '2026-10-20T00:00:00Z', commit_sha: sha('a'), created_at: '2026-10-19T00:00:00Z' },
        { id: F.f2, project_id: P1, report_id: 'r2', agent: 'cursor_cloud', status: 'completed', branch: 'mushi/fix-2', branch_name: null, pr_url: `https://github.com/${REPO}/pull/2`, pr_number: 2, pr_state: 'closed', merged_at: null, commit_sha: sha('b'), created_at: '2026-10-19T00:00:00Z' },
        { id: F.f5, project_id: P1, report_id: 'r5', agent: 'cursor_cloud', status: 'completed', branch: 'mushi/fix-5', branch_name: null, pr_url: `https://github.com/${REPO}/pull/5`, pr_number: 5, pr_state: 'open', merged_at: null, commit_sha: sha('5'), created_at: '2026-10-20T00:00:00Z' },
        { id: F.f6, project_id: P1, report_id: 'r5', agent: 'cursor_cloud', status: 'completed', branch: 'mushi/fix-6', branch_name: null, pr_url: `https://github.com/${REPO}/pull/6`, pr_number: 6, pr_state: 'open', merged_at: null, commit_sha: sha('6'), created_at: '2026-10-22T00:00:00Z' },
        { id: F.f7, project_id: P1, report_id: 'r7', agent: 'cursor_cloud', status: 'completed', branch: 'mushi/fix-7', branch_name: null, pr_url: `https://github.com/${REPO}/pull/7`, pr_number: 7, pr_state: 'draft', merged_at: null, commit_sha: sha('7'), created_at: '2026-10-21T00:00:00Z' },
      ],
      release_trains: [{ id: 't1', project_id: P1, repo: REPO, branch: 'mushi/train/20261020', pr_number: 10, state: 'merged', created_at: '2026-10-20T00:00:00Z' }],
      fix_reviews: [{ fix_attempt_id: F.f7, project_id: P1, verdict: 'hold', head_sha: sha('7'), summary: 'Removes the login form', reviewed_at: '2026-10-25T00:00:00Z', created_at: '2026-10-25T00:00:00Z' }],
      fix_merge_queue: [],
      connector_actions: [],
      repo_housekeeping_items: [],
      org_audit_events: [],
      ...(opts.extra ?? {}),
    },
    {
      autoId: true,
      uniques: opts.uniques,
      failRead: (t) => (opts.itemsMissing && t === 'repo_housekeeping_items' ? { code: '42P01', message: 'relation "public.repo_housekeeping_items" does not exist' } : null),
    },
  )
  const gh = freshGh()
  let clock = NOW
  const app = new FakeApp()
  routes.registerRepoHousekeepingRoutes(app as never, {
    getServiceClient: () => db as never,
    adminOrApiKeyRead: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    adminOrApiKeyWrite: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    jwtAuth: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    callerCanAccessProject: (async (_c: unknown, _db: unknown, _u: unknown, projectId: string) => ({ allowed: projectId === P1 && opts.projectRole !== null, role: opts.projectRole ?? 'member' })) as never,
    fetch: githubFetch(gh),
    now: () => clock,
    token: async () => (opts.token === false ? null : 'ghp_stored'),
    claimRateLimit: (async () => ({ allowed: opts.rate !== false, retryAfterSec: 60 })) as never,
    sleep: async () => {},
  })
  return { db, gh, app, tick: (ms: number) => { clock = new Date(clock.getTime() + ms) } }
}

const URL_BASE = `/v1/admin/projects/${P1}/repo-cleanup`

async function requestAndApprove(s: ReturnType<typeof setup>, body: Record<string, unknown>) {
  const req = await s.app.call('POST', `${URL_BASE}/requests`, { body: { repo: REPO, ...body } })
  if (req.status !== 201) throw new Error(`request failed: ${req.status} ${JSON.stringify(req.body)}`)
  const { id: actionId, payloadSha256 } = req.body.data
  const ok = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/approve`, { body: { payloadSha256 } })
  if (ok.status !== 200) throw new Error(`approve failed: ${JSON.stringify(ok.body)}`)
  return { actionId: actionId as string, payload: req.body.data.payload }
}

const items = (r: Res) => (r.body.data?.result?.items ?? []) as Array<{ key: string; outcome: string; detail: string; method?: string }>

describe('GET /v1/admin/projects/:id/repo-cleanup', () => {
  it('lists only branches Mushi recorded whose PR closed, and stale, superseded or held fix PRs', async () => {
    const s = setup()
    const res = await s.app.call('GET', URL_BASE)
    expect(res.status).toBe(200)
    const repo = res.body.data.repos[0]
    expect(repo).toMatchObject({ repo: REPO, defaultBranch: 'main', deleteBranchOnMerge: false, canChangeSetting: true, error: null })
    expect(repo.branches.map((b: { branch: string }) => b.branch)).toEqual(['mushi/fix-1', 'mushi/fix-2', 'mushi/train/20261020'])
    expect(repo.branches.find((b: { branch: string }) => b.branch === 'someone-else')).toBeUndefined()
    expect(repo.prs.map((p: { prNumber: number; why: string[] }) => [p.prNumber, p.why])).toEqual([[5, ['superseded']], [7, ['hold']]])
    expect(repo.kept.map((k: { key: string }) => k.key)).toEqual(expect.arrayContaining(['branch:mushi/fix-5', 'branch:mushi/fix-6', 'branch:mushi/fix-7']))
    expect(res.body.data).toMatchObject({ canDecide: true, canRequest: true, migrationPending: false, limits: { maxItems: 50, perHour: 5, approvalMinutes: 60 } })
    expect(res.body.data.raceNote).toMatch(/a push in that second could be lost/)
    expect(s.gh.calls.some((c) => !c.startsWith('GET') && c !== 'POST /graphql')).toBe(false)
  })

  it('says plainly when no GitHub token is stored, and stops under the GitHub quota floor', async () => {
    const none = setup({ token: false })
    expect((await none.app.call('GET', URL_BASE)).body.data.repos[0].error).toMatch(/No GitHub token is stored/)
    const low = setup()
    low.gh.remaining = 100
    expect((await low.app.call('GET', URL_BASE)).body.data.repos[0].error).toMatch(/Fewer than 300 GitHub API calls/)
  })

  it('refuses a project the caller cannot open', async () => {
    const s = setup({ projectRole: null })
    expect((await s.app.call('GET', URL_BASE)).status).toBe(404)
  })
})

describe('POST /v1/admin/projects/:id/repo-cleanup/requests', () => {
  it('stores exactly the chosen candidates with their commits; nothing changes on GitHub', async () => {
    const s = setup()
    const res = await s.app.call('POST', `${URL_BASE}/requests`, { body: { action: 'delete_branches', repo: REPO, keys: ['branch:mushi/fix-1', 'branch:mushi/train/20261020'], reason: 'merged' } })
    expect(res.status).toBe(201)
    expect(res.body.data.payload.items).toEqual([
      expect.objectContaining({ key: 'branch:mushi/fix-1', branch: 'mushi/fix-1', headSha: sha('a'), prNumber: 1, prState: 'merged' }),
      expect.objectContaining({ key: 'branch:mushi/train/20261020', headSha: sha('c'), prNumber: 10 }),
    ])
    expect(s.db.table('connector_actions')[0]).toMatchObject({ connector_kind: 'github', action: 'delete_branches', status: 'pending_approval', project_id: P1, connector_instance_id: null })
    expect(s.gh.calls.filter((c) => c.startsWith('DELETE') || c.startsWith('PATCH'))).toEqual([])
    // Now waiting: the next preview keeps them out.
    const again = (await s.app.call('GET', URL_BASE)).body.data.repos[0]
    expect(again.branches.map((b: { branch: string }) => b.branch)).toEqual(['mushi/fix-2'])
  })

  it('refuses viewers, a branch that is not a candidate, more than 50 items, and a sixth request in the hour', async () => {
    expect((await setup({ projectRole: 'viewer' }).app.call('POST', `${URL_BASE}/requests`, { body: { action: 'delete_branches', repo: REPO } })).status).toBe(403)
    const s = setup()
    const not = await s.app.call('POST', `${URL_BASE}/requests`, { body: { action: 'delete_branches', repo: REPO, keys: ['branch:someone-else', 'branch:mushi/fix-5'] } })
    expect(not.status).toBe(409)
    expect(not.body.error?.code).toBe('NOT_A_CANDIDATE')
    expect(JSON.stringify(not.body.error?.items)).toMatch(/head of open pull request #5/)
    const many = Array.from({ length: 51 }, (_, i) => `branch:b${i}`)
    expect((await s.app.call('POST', `${URL_BASE}/requests`, { body: { action: 'delete_branches', repo: REPO, keys: many } })).status).toBe(400)
    const limited = setup({ rate: false })
    expect((await limited.app.call('POST', `${URL_BASE}/requests`, { body: { action: 'delete_branches', repo: REPO } })).status).toBe(429)
    expect((await s.app.call('POST', `${URL_BASE}/requests`, { body: { action: 'delete_branches', repo: 'kensaurus/other' } })).body.error?.code).toBe('REPO_NOT_IN_PROJECT')
  })
})

describe('approve', () => {
  it('only a console owner or admin approves, with the hash of what they saw', async () => {
    const s = setup()
    const req = await s.app.call('POST', `${URL_BASE}/requests`, { body: { action: 'delete_branches', repo: REPO } })
    const actionId = req.body.data.id
    expect((await s.app.call('POST', `${URL_BASE}/requests/${actionId}/approve`, { body: { payloadSha256: req.body.data.payloadSha256 }, vars: { authMethod: 'apiKey' } })).body.error?.code).toBe('HUMAN_REQUIRED')
    expect((await s.app.call('POST', `${URL_BASE}/requests/${actionId}/approve`, { body: { payloadSha256: 'f'.repeat(64) } })).body.error?.code).toBe('HASH_MISMATCH')
    const member = setup({ orgRole: 'member' })
    member.db.table('connector_actions').push(...s.db.table('connector_actions'))
    expect((await member.app.call('POST', `${URL_BASE}/requests/${actionId}/approve`, { body: { payloadSha256: req.body.data.payloadSha256 } })).status).toBe(403)
    expect((await s.app.call('POST', `/v1/admin/projects/${id(9)}/repo-cleanup/requests/${actionId}/approve`, { body: { payloadSha256: req.body.data.payloadSha256 } })).status).toBe(404)
  })
})

describe('execute: delete_branches', () => {
  it('deletes each branch only if it still points at the approved commit, keeps the commit for Restore, one audit entry each', async () => {
    const s = setup()
    const { actionId } = await requestAndApprove(s, { action: 'delete_branches' })
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(res.status).toBe(200)
    expect(items(res).map((i) => [i.key, i.outcome, i.method])).toEqual([
      ['branch:mushi/fix-1', 'done', 'cas'],
      ['branch:mushi/fix-2', 'done', 'cas'],
      ['branch:mushi/train/20261020', 'done', 'cas'],
    ])
    expect(Object.keys(s.gh.branches)).not.toContain('mushi/fix-1')
    expect(s.db.table('repo_housekeeping_items').map((r) => [r.branch, r.outcome, r.deleted_sha])).toEqual([
      ['mushi/fix-1', 'done', sha('a')],
      ['mushi/fix-2', 'done', sha('b')],
      ['mushi/train/20261020', 'done', sha('c')],
    ])
    const audits = s.db.table('org_audit_events').filter((e) => String(e.action).startsWith('repo_cleanup.'))
    expect(audits).toHaveLength(3)
    expect(audits[0]).toMatchObject({ actor_id: 'u1', action: 'repo_cleanup.delete_branches.done', metadata: expect.objectContaining({ branch: 'mushi/fix-1', sha: sha('a') }) })
    expect(s.db.table('connector_actions')[0].status).toBe('executed')
    // Single use.
    expect((await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)).status).toBe(409)
  })

  it('re-checks every item on fresh reads: moved tip, protected, open-PR head and base, a running Mushi row', async () => {
    const s = setup()
    const { actionId } = await requestAndApprove(s, { action: 'delete_branches' })
    s.gh.branches['mushi/fix-1'].sha = sha('e')
    s.gh.branches['mushi/fix-2'].protected = true
    s.gh.pulls.push(openPull(11, 'feature', sha('f'), { base: { ref: 'mushi/train/20261020' } }))
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(items(res).map((i) => [i.outcome, i.detail])).toEqual([
      ['refused', expect.stringMatching(/moved to eeeeeee/)],
      ['refused', expect.stringMatching(/protected/)],
      ['refused', expect.stringMatching(/#11 targets it/)],
    ])
    expect(Object.keys(s.gh.branches)).toEqual(expect.arrayContaining(['mushi/fix-1', 'mushi/fix-2', 'mushi/train/20261020']))
    expect(s.db.table('repo_housekeeping_items').every((r) => r.deleted_sha === null || r.deleted_sha === undefined)).toBe(true)

    const t = setup()
    const run = await requestAndApprove(t, { action: 'delete_branches', keys: ['branch:mushi/fix-1'] })
    t.gh.pulls.push(openPull(12, 'mushi/fix-1', sha('a')))
    t.db.table('fix_attempts').push({ id: id(8), project_id: P1, report_id: 'r8', status: 'running', branch: 'mushi/fix-1', pr_url: null, pr_number: null, created_at: '2026-10-27T00:00:00Z' })
    const r2 = await t.app.call('POST', `${URL_BASE}/requests/${run.actionId}/execute`)
    expect(items(r2)[0]).toMatchObject({ outcome: 'refused', detail: expect.stringMatching(/head of open pull request #12/) })
  })

  it('a push just before the checked delete is refused by GitHub, never lost', async () => {
    const s = setup()
    const { actionId } = await requestAndApprove(s, { action: 'delete_branches', keys: ['branch:mushi/fix-1'] })
    s.gh.beforeDelete = { 'mushi/fix-1': () => { s.gh.branches['mushi/fix-1'].sha = sha('9') } }
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(items(res)[0]).toMatchObject({ outcome: 'refused', detail: expect.stringMatching(/moved to 9999999 just before the delete/) })
    expect(s.gh.branches['mushi/fix-1'].sha).toBe(sha('9'))
  })

  it('falls back to read-then-delete where GitHub has no checked delete, and records it', async () => {
    const s = setup()
    s.gh.cas = 'unavailable'
    const { actionId } = await requestAndApprove(s, { action: 'delete_branches', keys: ['branch:mushi/fix-1'] })
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(items(res)[0]).toMatchObject({ outcome: 'done', method: 'reread', detail: expect.stringMatching(/reading it again just before/) })
    expect(s.gh.calls).toContain(`DELETE /repos/${REPO}/git/refs/heads/mushi/fix-1`)
    expect(s.db.table('repo_housekeeping_items')[0]).toMatchObject({ method: 'reread', deleted_sha: sha('a') })
  })

  it('deletes nothing when Mushi cannot first record the branch and its commit', async () => {
    const s = setup({ uniques: { repo_housekeeping_items: ['item_key'] }, extra: { repo_housekeeping_items: [{ id: id(4), item_key: 'branch:mushi/fix-1', project_id: 'other' }] } })
    const { actionId } = await requestAndApprove(s, { action: 'delete_branches', keys: ['branch:mushi/fix-1'] })
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(items(res)[0]).toMatchObject({ outcome: 'failed', detail: expect.stringMatching(/could not record/) })
    expect(s.gh.branches['mushi/fix-1']).toBeDefined()
  })

  it('refuses before touching GitHub when the log table is missing or the repo was unbound', async () => {
    const s = setup({ itemsMissing: true })
    expect((await s.app.call('GET', URL_BASE)).body.data.migrationPending).toBe(true)
    const { actionId } = await requestAndApprove(s, { action: 'delete_branches' })
    const before = s.gh.calls.length
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(res.body.error?.code).toBe('MIGRATION_PENDING')
    expect(s.gh.calls.slice(before)).toEqual([])

    const t = setup()
    const run = await requestAndApprove(t, { action: 'delete_branches' })
    t.db.table('project_repos').splice(0)
    expect((await t.app.call('POST', `${URL_BASE}/requests/${run.actionId}/execute`)).body.error?.code).toBe('REPO_NOT_IN_PROJECT')
  })

  it('an expired approval does not run; the hourly cap refuses before the approval is used', async () => {
    const s = setup()
    const { actionId } = await requestAndApprove(s, { action: 'delete_branches' })
    s.tick(61 * 60_000)
    expect((await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)).body.error?.code).toBe('APPROVAL_EXPIRED')

    const done = Array.from({ length: 5 }, (_, i) => ({ id: id(0xa0 + i), organization_id: ORG, project_id: P1, connector_kind: 'github', action: 'close_prs', status: 'executed', executed_at: '2026-10-27T11:30:00Z', payload: {}, payload_sha256: 'e'.repeat(64), requested_at: '2026-10-27T11:00:00Z' }))
    const t = setup({ extra: { connector_actions: done } })
    const run = await requestAndApprove(t, { action: 'delete_branches' })
    const res = await t.app.call('POST', `${URL_BASE}/requests/${run.actionId}/execute`)
    expect(res.status).toBe(429)
    expect(t.db.table('connector_actions').find((r) => r.id === run.actionId)?.status).toBe('approved')
  })

  it('answers 202 while a long run goes on, then records the result', async () => {
    const s = setup()
    const { actionId } = await requestAndApprove(s, { action: 'delete_branches' })
    // The same app with a zero wait, so the run outlives the answer.
    s.app.routes = []
    routes.registerRepoHousekeepingRoutes(s.app as never, {
      getServiceClient: () => s.db as never,
      adminOrApiKeyRead: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
      adminOrApiKeyWrite: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
      jwtAuth: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
      callerCanAccessProject: (async () => ({ allowed: true, role: 'member' })) as never,
      fetch: githubFetch(s.gh),
      now: () => NOW,
      token: async () => 'ghp_stored',
      claimRateLimit: (async () => ({ allowed: true })) as never,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      executeWaitMs: 0,
    })
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(res.status).toBe(202)
    await vi.waitFor(() => expect(s.db.table('connector_actions')[0].status).toBe('executed'), { timeout: 5000 })
  })
})

describe('execute: close_prs', () => {
  it('closes through the pipeline close: the reason becomes a team note on the report', async () => {
    const s = setup()
    const { actionId, payload } = await requestAndApprove(s, { action: 'close_prs' })
    expect(payload.items.map((i: { prNumber: number }) => i.prNumber)).toEqual([5, 7])
    notes.length = 0
    finalized.length = 0
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(items(res).map((i) => i.outcome)).toEqual(['done', 'done'])
    expect(s.gh.pulls.find((p) => p.number === 5)?.state).toBe('closed')
    expect(notes.map((n) => [n.reportId, n.authorName])).toEqual([['r5', 'Mushi repo clean-up'], ['r7', 'Mushi repo clean-up']])
    expect(notes[0].body).toMatch(/^Pull request #5 closed without merging: Close #5: a newer fix for the same report is open as #6\. \(Repo clean-up\)$/)
    expect(finalized).toEqual([F.f5, F.f7])
  })

  it('refuses a PR whose head moved or that now rides a release train', async () => {
    const s = setup()
    const { actionId } = await requestAndApprove(s, { action: 'close_prs' })
    s.gh.pulls.find((p) => p.number === 5)!.head.sha = sha('8')
    s.db.table('fix_merge_queue').push({ project_id: P1, repo: REPO, pr_number: 7, state: 'queued', train_id: 't2' })
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(items(res).map((i) => [i.outcome, i.detail])).toEqual([
      ['refused', expect.stringMatching(/New commits arrived/)],
      ['refused', expect.stringMatching(/release train/)],
    ])
    expect(s.gh.pulls.filter((p) => p.state === 'open').map((p) => p.number)).toEqual([5, 6, 7])
  })
})

describe('restore and the repo setting', () => {
  it('restores a deleted branch at the commit Mushi kept, once, never over a branch that exists', async () => {
    const s = setup()
    const del = await requestAndApprove(s, { action: 'delete_branches', keys: ['branch:mushi/fix-1', 'branch:mushi/fix-2'] })
    await s.app.call('POST', `${URL_BASE}/requests/${del.actionId}/execute`)
    const [one, two] = s.db.table('repo_housekeeping_items')
    s.gh.branches['mushi/fix-2'] = { sha: sha('4'), protected: false }
    const req = await s.app.call('POST', `${URL_BASE}/restore`, { body: { itemIds: [one.id, two.id] } })
    expect(req.status).toBe(201)
    expect(req.body.data.payload.items).toEqual([
      expect.objectContaining({ branch: 'mushi/fix-1', sha: sha('a') }),
      expect.objectContaining({ branch: 'mushi/fix-2', sha: sha('b') }),
    ])
    expect((await s.app.call('POST', `${URL_BASE}/restore`, { body: { itemIds: [one.id] } })).body.error?.code).toBe('ALREADY_ASKED')
    await s.app.call('POST', `${URL_BASE}/requests/${req.body.data.id}/approve`, { body: { payloadSha256: req.body.data.payloadSha256 } })
    const res = await s.app.call('POST', `${URL_BASE}/requests/${req.body.data.id}/execute`)
    expect(items(res).map((i) => i.outcome)).toEqual(['done', 'refused'])
    expect(s.gh.branches['mushi/fix-1'].sha).toBe(sha('a'))
    expect(s.gh.branches['mushi/fix-2'].sha).toBe(sha('4'))
    expect(s.db.table('repo_housekeeping_items').find((r) => r.id === one.id)?.restored_at).toBeTruthy()
    expect((await s.app.call('POST', `${URL_BASE}/restore`, { body: { itemIds: [one.id] } })).body.error?.code).toBe('NOT_RESTORABLE')
  })

  it('refuses to restore anything Mushi did not delete', async () => {
    const s = setup({ extra: { repo_housekeeping_items: [{ id: id(4), action_id: id(5), project_id: P1, repo: REPO, action: 'delete_branches', item_key: 'branch:x', branch: 'x', deleted_sha: null, outcome: 'refused' }] } })
    expect((await s.app.call('POST', `${URL_BASE}/restore`, { body: { itemIds: [id(4)] } })).body.error?.code).toBe('NOT_RESTORABLE')
  })

  it('turns on "Automatically delete head branches" when the token can, and says so when it cannot', async () => {
    const s = setup()
    const { actionId } = await requestAndApprove(s, { action: 'set_delete_branch_on_merge' })
    const res = await s.app.call('POST', `${URL_BASE}/requests/${actionId}/execute`)
    expect(res.status).toBe(200)
    expect(s.gh.deleteBranchOnMerge).toBe(true)
    expect((await s.app.call('POST', `${URL_BASE}/requests`, { body: { action: 'set_delete_branch_on_merge', repo: REPO } })).body.error?.code).toBe('ALREADY_ON')

    const t = setup()
    t.gh.perms.admin = false
    const run = await requestAndApprove(t, { action: 'set_delete_branch_on_merge' })
    const no = await t.app.call('POST', `${URL_BASE}/requests/${run.actionId}/execute`)
    expect(no.status).toBe(409)
    expect(no.body.error?.message).toMatch(/Administration: Read and write/)
    expect(t.gh.deleteBranchOnMerge).toBe(false)
  })
})
