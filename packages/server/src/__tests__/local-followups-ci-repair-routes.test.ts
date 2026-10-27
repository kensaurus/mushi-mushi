/**
 * FILE: local-followups-ci-repair-routes.test.ts
 * PURPOSE: A CI repair handed to the local `mushi work --followups` lanes
 *          from the console (/pipeline, while cloud follow-ups cannot run),
 *          through the real local-followups handlers on an in-memory database:
 *            - GET …/local-followups offers it as `kind: 'ci_repair'` only at
 *              the head a person asked for, and only while CI there still
 *              fails on the code;
 *            - POST …/local-followup claims it with the CI-repair prompt (the
 *              failing checks and the screened log), once per head, so the
 *              unchanged CLI runs it like any other round.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({ db: null as unknown, liveHead: '' }))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  callerCanAccessProject: async () => ({ allowed: true, role: 'member' }),
  parseUuidParam: (c: { req: { param: (k: string) => string } }) => ({ ok: true, value: c.req.param('id') }),
}))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  installationIdForAttempt: async () => null,
  resolveProjectGithubToken: async () => 'gh-token',
  fetchPullRequestDetails: async () => ({ state: 'open', merged: false, headSha: state.liveHead, headRef: 'mushi/fix-1', headRepoId: 7, baseRepoId: 7 }),
  fetchPullRequestFiles: async () => ({ files: [], complete: true }),
}))
vi.mock('../../supabase/functions/_shared/ci-jobs.ts', () => ({
  ciGithub: () => ({}),
  fetchJobLogTail: async () => 'FAIL src/badge.test.ts\n  expected 2 lines, received 3\n',
}))

let routes: typeof import('../../supabase/functions/api/routes/local-followups.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/local-followups.ts')
})

const P = '1000000a-0000-4000-8000-000000000000'
const F = '3000000a-0000-4000-8000-000000000000'
const HEAD = 'a'.repeat(40)

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handlers: h }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handlers: h }) }
  async call(method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1' }
    const c = {
      req: { json: async () => body ?? {}, param: (k: string) => params[k], header: () => undefined, query: () => undefined },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

let db: FakeDb
let app: FakeApp

beforeEach(() => {
  state.liveHead = HEAD
  db = makeFakeDb({
    projects: [{ id: P, name: 'glot.it' }],
    fix_attempts: [
      {
        id: F,
        project_id: P,
        report_id: 'r1',
        agent: 'cursor_cloud',
        pr_url: 'https://github.com/kensaurus/glot.it/pull/12',
        pr_number: 12,
        pr_state: 'open',
        merged_at: null,
        repo_id: null,
        commit_sha: HEAD,
        ci_infra: null,
        created_at: new Date().toISOString(),
      },
    ],
    fix_reviews: [{ fix_attempt_id: F, status: 'completed', verdict: 'merge', head_sha: HEAD, findings: [] }],
    ci_jobs: [
      {
        project_id: P,
        head_sha: HEAD,
        job_id: 41,
        job_name: 'Build & Test',
        workflow_name: 'CI',
        run_id: 9,
        run_attempt: 1,
        repo: 'kensaurus/glot.it',
        status: 'completed',
        conclusion: 'failure',
        ci_kind: 'code_failure',
        infra: false,
        gh_created_at: '2026-10-26T08:00:00Z',
        steps: [{ name: 'Test', conclusion: 'failure' }],
      },
    ],
    fix_review_followups: [],
    fix_events: [],
    reports: [{ id: 'r1', summary: 'Badge clipped', component: 'HUD' }],
  })
  state.db = db
  app = new FakeApp()
  routes.registerLocalFollowupRoutes(app as never)
})

const request = () =>
  db.table('fix_events').push({ fix_attempt_id: F, project_id: P, kind: 'followup', status: 'pending', dedupe_key: `local-ci-repair-request:${F}:${HEAD}` })

describe('local CI repair, handed over from the console', () => {
  it('is not offered until a person asks, then offered as ci_repair at that head', async () => {
    const before = await app.call('GET', '/v1/admin/projects/:id/local-followups', { id: P })
    expect(before.body.data).toEqual({ fixes: [] })
    request()
    const after = await app.call('GET', '/v1/admin/projects/:id/local-followups', { id: P })
    expect(after.body.data).toEqual({
      fixes: [{ fixId: F, reportId: 'r1', prUrl: 'https://github.com/kensaurus/glot.it/pull/12', prNumber: 12, headSha: HEAD, kind: 'ci_repair', findings: 1, round: 1 }],
    })
  })

  it('is not offered once CI there went green', async () => {
    request()
    db.table('ci_jobs')[0].conclusion = 'success'
    const res = await app.call('GET', '/v1/admin/projects/:id/local-followups', { id: P })
    expect(res.body.data).toEqual({ fixes: [] })
  })

  it('the claim returns the CI-repair prompt with the failing check and its log, once per head', async () => {
    request()
    const res = await app.call('POST', '/v1/admin/fixes/:id/local-followup', { id: F })
    expect(res.status).toBe(200)
    const data = res.body.data as { kind: string; branch: string; headSha: string; round: number; findingsSent: number; prompt: string }
    expect(data).toMatchObject({ kind: 'ci_repair', branch: 'mushi/fix-1', headSha: HEAD, round: 1, findingsSent: 1 })
    expect(data.prompt).toContain('make CI green without weakening any test')
    expect(data.prompt).toContain('CI / Build & Test')
    expect(data.prompt).toContain('expected 2 lines, received 3')
    const claim = db.table('fix_events').find((e) => e.dedupe_key === `local-followup:${F}:${HEAD}`)
    expect(claim).toMatchObject({ label: 'Local CI repair started', status: 'pending' })
    const again = await app.call('POST', '/v1/admin/fixes/:id/local-followup', { id: F })
    expect(again.body.error?.code).toBe('ALREADY_FOLLOWED_UP')
  })

  it('without a request, a merge review is still nothing to follow up', async () => {
    const res = await app.call('POST', '/v1/admin/fixes/:id/local-followup', { id: F })
    expect(res.body.error?.code).toBe('NOT_FIX_FIRST')
  })
})
