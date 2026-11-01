/**
 * FILE: local-agent-routes.test.ts
 * PURPOSE: The local fix agent (Plan 023 Phase 3, ADR 0034) through the real
 *          handlers on an in-memory database:
 *            - dispatch: agent 'local' queues a fix_attempts row and a
 *              'running' job, and never invokes the fix-worker;
 *            - POST /v1/admin/agent/claim: one claim per queued attempt even
 *              when two machines ask together, scoped to the caller's
 *              projects, a lapsed lease is claimable again, and the fix
 *              context packet rides along;
 *            - POST /v1/admin/agent/attempts/:id/report: only the claiming
 *              key (or a console member) reports, `running` renews the
 *              lease, a PR goes through applyCloudAgentOutcome (review
 *              queued, report → fixing), a foreign repo is refused, no PR
 *              uses the no-PR verdicts and a failure is local_agent_error;
 *            - the migration claims with FOR UPDATE SKIP LOCKED and only the
 *              service role can call it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const mocks = vi.hoisted(() => {
  // _shared/github-pr.ts reads Deno.env at import (the real branch-name check runs here).
  ;(globalThis as { Deno?: unknown }).Deno ??= { env: { get: () => undefined } }
  return {
  enqueueFixReview: vi.fn(async (..._args: unknown[]) => ({ queued: true })),
  notifyTeamFixEvent: vi.fn(async () => undefined),
  dispatchPluginEventDetached: vi.fn(async () => undefined),
  }
})

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) noop[level] = () => {}
  noop.child = () => noop
  return { log: noop, createLogger: () => noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({ resolveLlmKey: async () => null }))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  parseGithubRepoUrl: () => null,
  resolveProjectGithubToken: async () => null,
  prNumberFromUrl: (url: string) => Number(url.split('/pull/')[1]?.split('/')[0]) || null,
  fetchPullRequestFiles: async () => null,
}))
vi.mock('../../supabase/functions/_shared/team-notify.ts', () => ({
  notifyTeamFixEvent: (...args: unknown[]) => mocks.notifyTeamFixEvent(...(args as [])),
}))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({
  dispatchPluginEventDetached: (...args: unknown[]) => mocks.dispatchPluginEventDetached(...(args as [])),
}))
vi.mock('../../supabase/functions/_shared/fix-review-db.ts', () => ({
  enqueueFixReview: (...args: unknown[]) => mocks.enqueueFixReview(...args),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400, extra?: Record<string, unknown>) =>
    c.json({ ok: false, error: { code, message, ...extra } }, status),
  callerProjectIds: async () => [],
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))
vi.mock('../../supabase/functions/api/routes/report-agent-context.ts', () => ({
  FIX_CONTEXT_COLUMNS: 'id',
  reportFixContextOf: async () => ({}),
}))

let la: typeof import('../../supabase/functions/api/routes/local-agent.ts')
let adapters: typeof import('../../supabase/functions/_shared/agent-adapters.ts')
beforeAll(async () => {
  la = await import('../../supabase/functions/api/routes/local-agent.ts')
  adapters = await import('../../supabase/functions/_shared/agent-adapters.ts')
})
beforeEach(() => {
  mocks.enqueueFixReview.mockClear()
  mocks.notifyTeamFixEvent.mockClear()
})

const NOW = new Date('2026-10-22T09:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const R1 = '2000000a-0000-4000-8000-000000000000'
const R2 = '2000000b-0000-4000-8000-000000000000'
const A1 = '3000000a-0000-4000-8000-000000000000'
const A2 = '3000000b-0000-4000-8000-000000000000'
const KEY = '4000000a-0000-4000-8000-000000000000'
const OTHER_KEY = '4000000b-0000-4000-8000-000000000000'
const REPO = '5000000a-0000-4000-8000-000000000000'

type Res = { status: number; body: { ok: boolean; data?: any; error?: { code: string; message: string } } }
type Handler = (c: unknown) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handler: h[h.length - 1] }) }
  async call(path: string, opts: { body?: unknown; params?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    const route = this.routes.find((r) => r.path === path)
    if (!route) throw new Error(`no route ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'apiKey', apiKeyId: KEY, ...opts.vars }
    const c = {
      req: { json: async () => opts.body ?? {}, param: (k: string) => opts.params?.[k] },
      get: (k: string) => vars[k],
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

/** The SQL claim, in memory: oldest local attempt queued or with a lapsed lease. */
function claimRpc(db: FakeDb, clock: () => Date) {
  return (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'claim_local_fix_attempt') return null
    const ids = args.p_project_ids as string[]
    const now = clock()
    const row = db
      .table('fix_attempts')
      .filter((r) => r.agent === 'local' && ids.includes(r.project_id as string))
      .filter((r) => r.status === 'queued' || (r.status === 'running' && r.claimed_until && Date.parse(String(r.claimed_until)) < now.getTime()))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]
    if (!row) return []
    const reclaimed = row.status === 'running'
    Object.assign(row, {
      status: 'running',
      claimed_at: now.toISOString(),
      claimed_until: new Date(now.getTime() + Number(args.p_lease_seconds) * 1000).toISOString(),
      claimed_by_key_id: args.p_key_id,
      claimed_by_user_id: args.p_user_id,
    })
    return [{ ...row, reclaimed }]
  }
}

interface Setup {
  db: FakeDb
  app: FakeApp
  rpcCalls: Array<Record<string, unknown>>
  access: { allowed: boolean }
  applyCalls: unknown[][]
  tick: (ms: number) => void
}

function attempt(over: Row = {}): Row {
  return {
    id: A1,
    project_id: P1,
    report_id: R1,
    agent: 'local',
    status: 'queued',
    pr_url: null,
    pr_state: null,
    branch_name: `bugfix/MUSHI-${R1}-local-3000000a`,
    repo_id: REPO,
    external_agent_ref: { kind: 'local', repo_url: 'https://github.com/kensaurus/glot.it', base_branch: 'main' },
    created_at: '2026-10-22T08:00:00Z',
    claimed_until: null,
    claimed_by_key_id: null,
    ...over,
  }
}

function setup(seed: Record<string, Row[]> = {}, opts: { realOutcome?: boolean } = {}): Setup {
  let clock = NOW
  const rpcCalls: Array<Record<string, unknown>> = []
  // eslint-disable-next-line prefer-const
  let db: FakeDb
  const claim = (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, ...args })
    return claimRpc(db, () => clock)(fn, args)
  }
  db = makeFakeDb(
    {
      fix_attempts: [attempt()],
      fix_dispatch_jobs: [{ id: 'job-1', fix_attempt_id: A1, project_id: P1, report_id: R1, status: 'running' }],
      reports: [{ id: R1, project_id: P1, status: 'classified' }, { id: R2, project_id: P2, status: 'classified' }],
      project_repos: [{ id: REPO, project_id: P1, repo_url: 'https://github.com/kensaurus/glot.it', default_branch: 'main', is_primary: true }],
      ...seed,
    },
    { rpc: claim },
  )
  const access = { allowed: true }
  const applyCalls: unknown[][] = []
  const app = new FakeApp()
  la.registerLocalAgentRoutes(app as never, {
    getServiceClient: () => db as never,
    adminOrApiKeyWrite: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    callerProjectIds: async () => [P1],
    callerCanAccessProject: async () => ({ allowed: access.allowed, role: access.allowed ? 'member' : null }) as never,
    applyOutcome: (async (d: unknown, target: unknown, outcome: unknown) => {
      applyCalls.push([target, outcome])
      if (!opts.realOutcome) return { applied: true }
      return adapters.applyCloudAgentOutcome(d as never, target as never, outcome as never, {
        inspectPr: async () => ({ kind: 'read', complete: true, files: [{ filename: 'src/cart.ts', status: 'modified', additions: 4, deletions: 1 }] }),
      })
    }) as never,
    loadFixContext: async (_db, reportId) => ({ report_id: reportId, fix_prompt: 'Fix the cart total.' }),
    now: () => clock,
  })
  return { db, app, rpcCalls, access, applyCalls, tick: (ms) => { clock = new Date(clock.getTime() + ms) } }
}

const claim = (s: Setup, body: unknown = {}, vars: Record<string, unknown> = {}) => s.app.call('/v1/admin/agent/claim', { body, vars })
const report = (s: Setup, body: unknown, vars: Record<string, unknown> = {}, id = A1) =>
  s.app.call('/v1/admin/agent/attempts/:id/report', { body, params: { id }, vars })

describe('agent "local" in the dispatch allow-list', () => {
  it('is accepted and has its own branch and failure category', () => {
    expect(adapters.validateAgentOverride('local')).toEqual({ ok: true, agent: 'local' })
    expect(adapters.localFixBranchName(R1, A1)).toBe(`bugfix/MUSHI-${R1}-local-3000000a`)
  })

  it('queueLocalFixAttempt writes a queued local attempt linked to the job, and the route never invokes the fix-worker for it', async () => {
    const db = makeFakeDb({ fix_attempts: [], fix_dispatch_jobs: [{ id: 'job-9', status: 'running' }] })
    const repo = { id: REPO, repo_url: 'https://github.com/kensaurus/glot.it', default_branch: 'develop' }
    const out = await la.queueLocalFixAttempt(db as never, { projectId: P1, reportId: R1, dispatchId: 'job-9', repo, newId: () => A2 })
    expect(out).toEqual({ attemptId: A2, branchName: `bugfix/MUSHI-${R1}-local-3000000b` })
    expect(db.table('fix_attempts')[0]).toMatchObject({ id: A2, agent: 'local', status: 'queued', repo_id: REPO, external_agent_ref: { repo_url: repo.repo_url, base_branch: 'develop', dispatch_id: 'job-9' } })
    expect(db.table('fix_dispatch_jobs')[0]).toMatchObject({ fix_attempt_id: A2 })

    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/fix-dispatch.ts'), 'utf8')
    expect(src).toMatch(/status: isLocal \? 'running' : 'queued'/)
    // The only fix-worker call sits in the non-local branch.
    expect(src).toMatch(/\} else \{\s*\/\/ Fire-and-forget invoke of the fix-worker[\s\S]*?invokeFixWorker\(job\.id/)
    expect(src.match(/invokeFixWorker\(/g)).toHaveLength(1)
  })

  it('resolveLocalRepo prefers the chosen repo, then the primary', async () => {
    const db = makeFakeDb({
      project_repos: [
        { id: 'r-old', project_id: P1, repo_url: 'https://github.com/o/old', default_branch: 'main', is_primary: false, created_at: '2026-01-01' },
        { id: 'r-pri', project_id: P1, repo_url: 'https://github.com/o/app', default_branch: 'main', is_primary: true, created_at: '2026-02-01' },
      ],
    })
    expect((await la.resolveLocalRepo(db as never, P1, null))?.id).toBe('r-pri')
    expect((await la.resolveLocalRepo(db as never, P1, 'r-old'))?.id).toBe('r-old')
    expect(await la.resolveLocalRepo(db as never, P2, null)).toBeNull()
  })
})

describe('POST /v1/admin/agent/claim', () => {
  it('claims the oldest queued attempt once, with its repo, branch and fix context', async () => {
    const s = setup({
      fix_attempts: [attempt(), attempt({ id: A2, report_id: R2, project_id: P2, created_at: '2026-10-22T07:00:00Z' })],
    })
    const [first, second] = await Promise.all([claim(s), claim(s)])
    const claimed = [first, second].filter((r) => r.body.data?.attempt)
    expect(claimed).toHaveLength(1)
    expect([first, second].filter((r) => r.body.data?.attempt === null)).toHaveLength(1)
    // P2's older attempt is not the caller's: never claimed.
    expect(claimed[0].body.data.attempt).toMatchObject({
      id: A1,
      projectId: P1,
      reportId: R1,
      repoUrl: 'https://github.com/kensaurus/glot.it',
      baseBranch: 'main',
      branchName: `bugfix/MUSHI-${R1}-local-3000000a`,
      claimedUntil: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
      reclaimed: false,
    })
    expect(claimed[0].body.data.context).toEqual({ report_id: R1, fix_prompt: 'Fix the cart total.' })
    expect(s.rpcCalls[0]).toMatchObject({ fn: 'claim_local_fix_attempt', p_project_ids: [P1], p_key_id: KEY, p_lease_seconds: 1800 })
    expect(s.db.table('fix_attempts').find((r) => r.id === A1)).toMatchObject({ status: 'running', claimed_by_key_id: KEY })
  })

  it('answers attempt null when nothing waits, and 403 for a project the caller cannot reach', async () => {
    const s = setup({ fix_attempts: [] })
    expect((await claim(s)).body.data).toEqual({ attempt: null })
    expect((await claim(s, { projectId: P2 })).status).toBe(403)
    expect((await claim(s, { projectId: 'nope' })).status).toBe(400)
  })

  it('a console session claims without a key id', async () => {
    const s = setup()
    await claim(s, {}, { authMethod: 'jwt', apiKeyId: undefined })
    expect(s.rpcCalls[0]).toMatchObject({ p_key_id: null, p_user_id: 'u1' })
  })

  it('a running attempt whose lease lapsed (crashed machine) is claimed again', async () => {
    const s = setup()
    expect((await claim(s)).body.data.attempt.id).toBe(A1)
    s.tick(10 * 60_000)
    expect((await claim(s, {}, { apiKeyId: OTHER_KEY })).body.data.attempt).toBeNull()
    s.tick(21 * 60_000)
    const again = await claim(s, {}, { apiKeyId: OTHER_KEY })
    expect(again.body.data.attempt).toMatchObject({ id: A1, reclaimed: true })
    expect(s.db.table('fix_attempts')[0]).toMatchObject({ claimed_by_key_id: OTHER_KEY })
  })
})

describe('POST /v1/admin/agent/attempts/:id/report', () => {
  async function claimed(over: Parameters<typeof setup>[1] = {}) {
    const s = setup({}, over)
    await claim(s)
    return s
  }

  it('renews the lease on running', async () => {
    const s = await claimed()
    s.tick(20 * 60_000)
    const res = await report(s, { status: 'running', branch: `bugfix/MUSHI-${R1}-local-3000000a` })
    expect(res.status).toBe(200)
    expect(res.body.data.claimedUntil).toBe(new Date(NOW.getTime() + 50 * 60_000).toISOString())
    expect(s.db.table('fix_attempts')[0].claimed_until).toBe(res.body.data.claimedUntil)
  })

  it('refuses another key, a project it cannot reach, a non-local attempt and a closed one', async () => {
    const s = await claimed()
    expect((await report(s, { status: 'running' }, { apiKeyId: OTHER_KEY })).body.error?.code).toBe('NOT_CLAIMANT')
    s.access.allowed = false
    expect((await report(s, { status: 'running' })).status).toBe(404)
    s.access.allowed = true
    s.db.table('fix_attempts')[0].agent = 'cursor_cloud'
    expect((await report(s, { status: 'running' })).status).toBe(404)
    s.db.table('fix_attempts')[0].agent = 'local'
    s.db.table('fix_attempts')[0].status = 'completed'
    expect((await report(s, { status: 'failed', error: 'x' })).status).toBe(409)
    expect(s.applyCalls).toHaveLength(0)
  })

  it('a key must claim before it reports; a console member may give up on a queued fix', async () => {
    const s = setup()
    expect((await report(s, { status: 'failed', error: 'x' })).body.error?.code).toBe('NOT_CLAIMANT')
    s.db.table('fix_attempts')[0].claimed_by_key_id = KEY
    expect((await report(s, { status: 'failed', error: 'x' })).body.error?.code).toBe('NOT_CLAIMED')
    const res = await report(s, { status: 'failed', error: 'Not needed any more' }, { authMethod: 'jwt', apiKeyId: undefined })
    expect(res.status).toBe(200)
    expect(s.applyCalls[0][1]).toEqual({ kind: 'failed', error: 'Not needed any more', failureCategory: 'local_agent_error' })
  })

  it('validates the body', async () => {
    const s = await claimed()
    expect((await report(s, { status: 'done' })).status).toBe(400)
    expect((await report(s, { status: 'failed' })).body.error?.message).toMatch(/needs an error/)
    expect((await report(s, { status: 'running', prUrl: 'https://github.com/o/r/pull/1' })).status).toBe(400)
    expect((await report(s, { status: 'running', branch: '../etc' })).status).toBe(400)
    expect((await report(s, { status: 'completed', prUrl: 'https://gitlab.com/o/r/-/merge_requests/1' })).body.error?.code).toBe('INVALID_PR_URL')
    expect(la.parseReportBody({ status: 'completed', summary: 7 })).toMatchObject({ ok: false })
  })

  it('refuses a PR on a repo the project does not own', async () => {
    const s = await claimed()
    const res = await report(s, { status: 'completed', prUrl: 'https://github.com/someone/else/pull/3' })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('REPO_NOT_IN_PROJECT')
    expect(s.applyCalls).toHaveLength(0)
  })

  it('accepts a PR exactly like a cloud agent: applyCloudAgentOutcome attaches it, queues the Opus review and moves the report to fixing', async () => {
    const s = await claimed({ realOutcome: true })
    const prUrl = 'https://github.com/Kensaurus/glot.it/pull/42'
    const res = await report(s, { status: 'completed', prUrl, branch: `bugfix/MUSHI-${R1}-local-3000000a`, summary: 'Round the cart total.' })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ attemptId: A1, applied: true })
    expect(s.applyCalls[0]).toEqual([
      { attemptId: A1, projectId: P1, reportId: R1, agent: 'local', pendingPrUrl: null },
      { kind: 'pr_opened', prUrl: 'https://github.com/kensaurus/glot.it/pull/42', branch: `bugfix/MUSHI-${R1}-local-3000000a`, summary: 'Round the cart total.', agentFinished: true },
    ])
    expect(s.db.table('fix_attempts')[0]).toMatchObject({ status: 'completed', pr_url: 'https://github.com/kensaurus/glot.it/pull/42', pr_number: 42 })
    expect(s.db.table('reports')[0]).toMatchObject({ status: 'fixing', fix_pr_url: 'https://github.com/kensaurus/glot.it/pull/42' })
    expect(s.db.table('fix_dispatch_jobs')[0]).toMatchObject({ status: 'completed' })
    expect(mocks.enqueueFixReview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fixAttemptId: A1, prUrl: 'https://github.com/kensaurus/glot.it/pull/42' }))
    // A second report finds the attempt closed.
    expect((await report(s, { status: 'completed', prUrl })).status).toBe(409)
  })

  it('without a PR, the no-PR verdict classifier reads the summary', async () => {
    const s = await claimed({ realOutcome: true })
    const res = await report(s, { status: 'completed', summary: 'Already fixed on main; nothing to change.' })
    expect(res.status).toBe(200)
    expect(s.applyCalls[0][1]).toEqual({ kind: 'completed_no_pr', summary: 'Already fixed on main; nothing to change.' })
    const row = s.db.table('fix_attempts')[0]
    expect(row.status).toBe('failed')
    expect(typeof row.failure_category).toBe('string')
    expect(mocks.enqueueFixReview).not.toHaveBeenCalled()
  })

  it('a failure is recorded as local_agent_error', async () => {
    const s = await claimed({ realOutcome: true })
    await report(s, { status: 'failed', error: 'claude exited 1: rate limited' })
    expect(s.db.table('fix_attempts')[0]).toMatchObject({ status: 'failed', failure_category: 'local_agent_error', error: 'claude exited 1: rate limited' })
    expect(s.db.table('fix_dispatch_jobs')[0]).toMatchObject({ status: 'failed' })
  })
})

describe('migration 20261022000100_local_agent_claim', () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261022000100_local_agent_claim.sql'), 'utf8')

  it('claims in one statement with SKIP LOCKED, queued or lapsed lease, local only', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.claim_local_fix_attempt'), sql.indexOf("COMMENT ON FUNCTION public.claim_local_fix_attempt"))
    expect(fn).toMatch(/FOR UPDATE SKIP LOCKED/)
    expect(fn).toMatch(/LIMIT\s+1/)
    expect(fn).toMatch(/fa\.agent = 'local'/)
    expect(fn).toMatch(/fa\.status = 'queued'/)
    expect(fn).toMatch(/fa\.status = 'running' AND fa\.claimed_until IS NOT NULL AND fa\.claimed_until < now\(\)/)
    expect(fn).toMatch(/fa\.project_id = ANY/)
  })

  it('only the service role can claim or expire, and local_agent_error is a valid category', () => {
    expect(sql).toMatch(/REVOKE ALL\s+ON FUNCTION public\.claim_local_fix_attempt\(uuid\[\], uuid, uuid, integer\) FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.claim_local_fix_attempt\(uuid\[\], uuid, uuid, integer\) TO service_role/)
    expect(sql).toMatch(/REVOKE ALL\s+ON FUNCTION public\.local_fix_attempts_expire\(\) FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/'local_agent_error'\n/)
    expect(readFileSync(resolve(__dirname, '../../../../deploy/helm/migrations/20261022000100_local_agent_claim.sql'), 'utf8')).toBe(sql)
  })
})
