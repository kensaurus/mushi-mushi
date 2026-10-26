/**
 * FILE: pipeline-routes.test.ts
 * PURPOSE: The console pipeline routes (api/routes/pipeline.ts, served by
 *          api-ext) through the real handlers on an in-memory database:
 *            - GET /v1/admin/pipeline: one app or every app the caller can
 *              open; a queued PR that is red on its own head is a CI problem;
 *              intake rejects read "not recorded" (null), never 0;
 *            - POST /v1/admin/pipeline/actions: viewers and other teams are
 *              refused per item; close and remove need a reason, kept as a
 *              team note on the report; a conflict agent is refused once the
 *              PR used both; CI repair says why it was not queued; train
 *              retry says honestly when no train could leave.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({
  db: null as unknown,
  accessible: [] as string[],
  roles: {} as Record<string, string>,
  query: {} as Record<string, string>,
  enqueue: { queued: false, reason: 'followups_off' } as { queued: boolean; reason?: string; error?: string },
  finalized: [] as string[],
}))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/fix-merge.ts', () => ({
  finalizeFixClosedUnmerged: async (_db: unknown, a: { id: string }) => {
    state.finalized.push(a.id)
    return { justClosed: true, reportStatus: 'classified' }
  },
}))
vi.mock('../../supabase/functions/_shared/review-followup-db.ts', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  enqueueReviewFollowup: async () => state.enqueue,
}))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  enumerateAccessibleProjectIds: async () => state.accessible,
  userCanAccessProject: async (_db: unknown, _user: string, projectId: string) => ({
    allowed: state.accessible.includes(projectId),
    role: state.accessible.includes(projectId) ? (state.roles[projectId] ?? 'member') : null,
  }),
}))

let routes: typeof import('../../supabase/functions/api/routes/pipeline.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/pipeline.ts')
})

const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const F1 = '3000000a-0000-4000-8000-000000000000'
const F2 = '3000000b-0000-4000-8000-000000000000'
const F3 = '3000000c-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-26T12:00:00Z')

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown> | null; error?: { code: string; message?: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handlers: h }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handlers: h }) }
  async call(method: string, path: string, body?: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1' }
    const c = {
      req: { json: async () => body ?? {}, param: () => undefined, header: () => undefined, query: (k: string) => state.query[k] },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

const attempt = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  project_id: P1,
  report_id: `r-${id}`,
  status: 'completed',
  agent: 'cursor_cloud',
  branch: 'mushi/fix',
  branch_name: 'mushi/fix',
  pr_url: `https://github.com/kensaurus/glot.it/pull/${id.slice(-1)}`,
  pr_number: 1,
  pr_state: 'open',
  commit_sha: `head-${id}`,
  check_run_conclusion: 'failure',
  error: null,
  summary: 'Fix',
  created_at: '2026-10-23T00:00:00Z',
  completed_at: '2026-10-23T00:10:00Z',
  merged_at: null,
  repo_id: null,
  ...over,
})

function setup() {
  const calls: string[] = []
  const deps = {
    token: async () => 'gh-token',
    pullHead: async () => ({ headSha: 'live-head', draft: false, state: 'open', merged: false }),
    updateBranch: async (_t: string, _r: unknown, n: number, head: string | null) => {
      calls.push(`update:${n}:${head}`)
      return true
    },
    markReady: async () => ({ ok: true, alreadyReady: false }),
    closePull: async (_t: string, _r: unknown, n: number) => {
      calls.push(`close:${n}`)
      return true
    },
    runQueue: async (p: string) => {
      calls.push(`run:${p}`)
      return true
    },
    now: () => NOW,
  }
  const db: FakeDb = makeFakeDb({
    projects: [
      { id: P1, name: 'glot.it', owner_id: 'owner-1', organization_id: 'org-1' },
      { id: P2, name: 'yen-yen', owner_id: 'owner-2', organization_id: 'org-1' },
    ],
    reports: [
      { id: `r-${F1}`, project_id: P1, status: 'fixing', title: 'Badge clipped', summary: null, description: null, created_at: '2026-10-22T00:00:00Z', processing_error: null },
      { id: 'r-new', project_id: P1, status: 'new', title: 'Crash on start', summary: null, description: null, created_at: '2026-10-26T09:00:00Z', processing_error: null },
    ],
    fix_attempts: [attempt(F1), attempt(F2, { pr_state: 'draft', check_run_conclusion: null, commit_sha: null }), attempt(F3, { project_id: P2 })],
    fix_reviews: [
      { fix_attempt_id: F2, status: 'completed', verdict: 'merge', summary: 'Good', findings: [], error: null, head_sha: null, completed_at: '2026-10-23T01:00:00Z', created_at: '2026-10-23T00:20:00Z', id: 'rv2', project_id: P1, report_id: `r-${F2}` },
      { fix_attempt_id: F1, status: 'completed', verdict: 'merge', summary: 'Good', findings: [], error: null, head_sha: `head-${F1}`, completed_at: '2026-10-23T01:00:00Z', created_at: '2026-10-23T00:20:00Z', id: 'rv1', project_id: P1, report_id: `r-${F1}` },
    ],
    fix_merge_queue: [
      { id: 'q1', fix_attempt_id: F1, project_id: P1, repo: 'kensaurus/glot.it', pr_number: 1, state: 'queued', detail: 'Approved; waits for the next release train.', queued_at: '2026-10-23T02:00:00Z', agent_started_at: null, conflict_agents: 0 },
      { id: 'q3', fix_attempt_id: F3, project_id: P2, repo: 'kensaurus/yen-yen', pr_number: 3, state: 'resolving', detail: 'Conflicts with the base branch.', queued_at: '2026-10-23T02:00:00Z', agent_started_at: '2026-10-24T00:00:00Z', conflict_agents: 2 },
    ],
    ci_jobs: [
      { project_id: P1, head_sha: `head-${F1}`, job_id: 1, job_name: 'Build & Test', workflow_name: 'CI', run_id: 1, run_attempt: 1, repo: 'kensaurus/glot.it', status: 'completed', conclusion: 'failure', ci_kind: 'code_failure', infra: false, gh_created_at: '2026-10-23T00:30:00Z', steps: [] },
    ],
    release_trains: [
      { id: 't1', project_id: P1, repo: 'kensaurus/glot.it', pr_number: 900, state: 'failed', members: [{ prNumber: 1 }], attempt: 1, detail: 'CI failed: Build & Test.', created_at: '2026-10-26T10:00:00Z', merged_at: null },
    ],
    project_settings: [
      { project_id: P1, train_interval_minutes: 360, autofix_enabled: true },
      { project_id: P2, autofix_enabled: false },
    ],
    organization_members: [{ organization_id: 'org-1', user_id: 'owner-1', role: 'owner' }],
    byok_keys: [
      { id: 'k1', provider_slug: 'cursor', project_id: null, organization_id: null, owner_user_id: 'owner-1', status: 'disabled', spend_down_enabled: false, exhausted_until: null },
      { id: 'k2', provider_slug: 'anthropic', project_id: P1, organization_id: null, owner_user_id: null, status: 'active', spend_down_enabled: false, exhausted_until: null },
    ],
    fix_dispatch_jobs: [],
    report_ingest_rejections: [
      { project_id: P1, day: '2026-10-26', stage: 'submission', reason: 'fingerprintHash:invalid_string', sdk_package: '@mushi-mushi/react-native', count: 4, last_at: '2026-10-26T07:00:00Z' },
      { project_id: P2, day: '2026-10-24', stage: 'body', reason: 'description:too_small', sdk_package: '', count: 1, last_at: '2026-10-24T07:00:00Z' },
    ],
    deploy_observations: [],
    fix_events: [
      { fix_attempt_id: F1, at: '2026-10-25T08:00:00Z', label: 'Release train: CI failed' },
      { fix_attempt_id: F1, at: '2026-10-26T09:00:00Z', label: 'CI finished: failed' },
      { fix_attempt_id: F1, at: '2026-10-20T09:00:00Z', label: 'Too old to read' },
    ],
    fix_review_followups: [],
    report_comments: [],
  })
  state.db = db
  state.accessible = [P1, P2]
  state.roles = {}
  state.query = {}
  state.finalized = []
  state.enqueue = { queued: false, reason: 'followups_off' }
  const app = new FakeApp()
  routes.registerPipelineRoutes(app as never, deps as never)
  return { app, db, calls }
}

type Stage = { id: string; count: number; stuck: number; groups: Array<{ id: string; label: string; items: Array<{ id: string; failingChecks: string[]; title: string; lastEventAt: string | null; lastEventLabel: string | null }> }> }

describe('GET /v1/admin/pipeline', () => {
  it('reads one app: the red queued PR is a CI problem, the draft never ran CI, the new report waits', async () => {
    const { app } = setup()
    state.query = { projectId: P1 }
    const res = await app.call('GET', '/v1/admin/pipeline')
    expect(res.status).toBe(200)
    const data = res.body.data as { stages: Stage[]; trains: Array<{ repo: string; failed: number }>; intake: unknown; projects: Array<{ name: string }> }
    const byId = Object.fromEntries(data.stages.map((s) => [s.id, s]))
    const ci = byId.ci.groups.find((g) => g.id === 'ci_red_queued')!
    expect(ci.label).toBe('1 PR: their own CI is red, yet they wait for a release train')
    expect(ci.items[0]).toMatchObject({ id: F1, failingChecks: ['Build & Test'], title: 'Badge clipped', lastEventAt: '2026-10-26T09:00:00Z', lastEventLabel: 'CI finished: failed' })
    // Auto-fix on, the only Cursor key off: a red group first in Fix PR.
    expect(byId.pr.groups.map((g) => g.id)).toEqual(['autofix_no_agent', 'draft_no_ci'])
    expect(byId.pr.groups[0].label).toBe('1 app: auto-fix is on but has no agent key; 0 dispatches in 48h')
    const d = (res.body.data as { dispatchers: Array<{ name: string; opener: string; server: { agentKeys: number; offKeys: number } }> }).dispatchers
    expect(d).toEqual([expect.objectContaining({ name: 'glot.it', opener: 'server', server: expect.objectContaining({ agentKeys: 0, offKeys: 1 }) })])
    expect(byId.reported.groups.map((g) => g.id)).toEqual(['intake_rejected', 'triage_slow'])
    expect(byId.reported.groups[0].label).toBe('4 reports: rejected at intake (400) in 7 days')
    // P2's PR is not in this app's picture.
    expect(byId.train.count).toBe(0)
    expect(data.trains).toMatchObject([{ repo: 'kensaurus/glot.it', failed: 1 }])
    // P2's rejections are another app's; counting began on 10-24.
    expect(data.intake).toEqual({
      since: '2026-10-24',
      apps: [{ projectId: P1, rejected: 4, byReason: [{ reason: 'fingerprintHash:invalid_string', count: 4 }], sdkPackages: ['@mushi-mushi/react-native'], lastAt: '2026-10-26T07:00:00Z' }],
    })
    expect(data.projects.map((p) => p.name)).toEqual(['glot.it'])
  })

  it('all apps: every app the caller can open, including a conflict row that used both agents', async () => {
    const { app } = setup()
    const res = await app.call('GET', '/v1/admin/pipeline')
    const stages = (res.body.data as { stages: Stage[] }).stages
    const train = stages.find((s) => s.id === 'train')!
    expect(train.groups.map((g) => g.id)).toEqual(['conflict_capped'])
    expect(train.stuck).toBe(1)
  })

  it('intake reads "not recorded" (null) while nothing was ever counted', async () => {
    const { app, db } = setup()
    db.table('report_ingest_rejections').length = 0
    state.query = { projectId: P1 }
    const res = await app.call('GET', '/v1/admin/pipeline')
    expect((res.body.data as { intake: unknown }).intake).toBeNull()
  })

  it('an app the caller cannot open is a 404', async () => {
    const { app } = setup()
    state.accessible = [P2]
    state.query = { projectId: P1 }
    expect((await app.call('GET', '/v1/admin/pipeline')).status).toBe(404)
  })
})

describe('POST /v1/admin/pipeline/actions', () => {
  it('rejects an unknown action and too many ids', async () => {
    const { app } = setup()
    expect((await app.call('POST', '/v1/admin/pipeline/actions', { action: 'merge_now', fixIds: [F1] })).status).toBe(400)
    const many = Array.from({ length: 11 }, (_, i) => `3000000a-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect((await app.call('POST', '/v1/admin/pipeline/actions', { action: 'mark_ready', fixIds: many })).status).toBe(400)
  })

  it('close needs a reason, closes on GitHub, takes it out of the queue and keeps the reason as a team note', async () => {
    const { app, db, calls } = setup()
    expect((await app.call('POST', '/v1/admin/pipeline/actions', { action: 'close', fixIds: [F1] })).body.error?.code).toBe('REASON_REQUIRED')
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'close', fixIds: [F1], reason: 'Fixed by hand in #44' })
    const [r] = (res.body.data as { results: Array<{ ok: boolean; message: string }> }).results
    expect(r.ok).toBe(true)
    expect(calls).toContain('close:1')
    expect(state.finalized).toEqual([F1])
    expect(db.table('fix_merge_queue').find((q) => q.id === 'q1')?.state).toBe('removed')
    const note = db.table('report_comments')[0]
    expect(note).toMatchObject({ report_id: `r-${F1}`, visible_to_reporter: false, author_kind: 'admin' })
    expect(String(note.body)).toContain('Fixed by hand in #44')
  })

  it('a viewer is refused per item and nothing changes', async () => {
    const { app, calls } = setup()
    state.roles = { [P1]: 'viewer' }
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'update_branch', fixIds: [F1] })
    const [r] = (res.body.data as { results: Array<{ ok: boolean; message: string }> }).results
    expect(r).toMatchObject({ ok: false, message: 'Viewers cannot change fixes.' })
    expect(calls).toEqual([])
  })

  it('update branch is pinned to the head GitHub reports', async () => {
    const { app, calls } = setup()
    await app.call('POST', '/v1/admin/pipeline/actions', { action: 'update_branch', fixIds: [F1] })
    expect(calls).toEqual(['update:1:live-head'])
  })

  it('a conflict agent is refused once the PR used both', async () => {
    const { app, db } = setup()
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'conflict_agent', fixIds: [F3] })
    const [r] = (res.body.data as { results: Array<{ ok: boolean; message: string }> }).results
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Both conflict agents')
    expect(db.table('fix_merge_queue').find((q) => q.id === 'q3')?.state).toBe('resolving')
  })

  it('a conflict agent under the cap hands the row back to the worker', async () => {
    const { app, db, calls } = setup()
    db.table('fix_merge_queue').find((q) => q.id === 'q3')!.conflict_agents = 1
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'conflict_agent', fixIds: [F3] })
    expect((res.body.data as { results: Array<{ ok: boolean }> }).results[0].ok).toBe(true)
    expect(db.table('fix_merge_queue').find((q) => q.id === 'q3')).toMatchObject({ state: 'resolving', cursor_agent_id: null })
    expect(calls).toContain(`run:${P2}`)
  })

  it('CI repair says, in plain words, why it was not queued', async () => {
    const { app } = setup()
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'ci_repair', fixIds: [F1] })
    const [r] = (res.body.data as { results: Array<{ ok: boolean; message: string }> }).results
    expect(r).toMatchObject({ ok: false, message: 'Not queued. Review follow-ups are turned off for this organization.' })
    state.enqueue = { queued: true }
    const ok = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'ci_repair', fixIds: [F1] })
    expect((ok.body.data as { results: Array<{ ok: boolean }> }).results[0].ok).toBe(true)
  })

  it('train retry runs the queue and says when no train could leave yet', async () => {
    const { app, calls } = setup()
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'train_retry', projectId: P1 })
    expect(calls).toEqual([`run:${P1}`])
    const results = (res.body.data as { results: Array<{ id: string; ok: boolean; message: string }> }).results
    expect(results).toEqual([{ id: 'kensaurus/glot.it', ok: false, message: 'No train left: the next one may leave at 16:00 UTC (one train every 360 min).' }])
  })
})
