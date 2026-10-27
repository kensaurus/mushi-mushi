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
 *              PR used both, and with no cloud agent possible says a
 *              person resolves it on GitHub; CI repair and fix-first
 *              follow-ups go to the cloud agent when it can run, else to
 *              the local mushi work lanes (or say why neither can); train
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
  followupsOn: false,
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
  followupsEnabledForProject: async () => ({ enabled: state.followupsOn, enabledAt: null }),
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
  async call(method: string, path: string, body?: unknown, params: Record<string, string> = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1' }
    const c = {
      req: { json: async () => body ?? {}, param: (k: string) => params[k], header: () => undefined, query: (k: string) => state.query[k] },
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
  state.followupsOn = false
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

  it('a conflict agent under the cap hands the row back to the worker when a cloud agent can run', async () => {
    const { app, db, calls } = setup()
    state.followupsOn = true
    db.table('byok_keys').find((k) => k.id === 'k1')!.status = 'active'
    db.table('fix_merge_queue').find((q) => q.id === 'q3')!.conflict_agents = 1
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'conflict_agent', fixIds: [F3] })
    expect((res.body.data as { results: Array<{ ok: boolean }> }).results[0].ok).toBe(true)
    expect(db.table('fix_merge_queue').find((q) => q.id === 'q3')).toMatchObject({ state: 'resolving', cursor_agent_id: null })
    expect(calls).toContain(`run:${P2}`)
  })

  it('with no cloud agent possible, a conflict needs a person on GitHub, with the PR link', async () => {
    const { app, db, calls } = setup()
    db.table('fix_merge_queue').find((q) => q.id === 'q3')!.conflict_agents = 1
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'conflict_agent', fixIds: [F3] })
    const [r] = (res.body.data as { results: Array<{ ok: boolean; message: string }> }).results
    expect(r.ok).toBe(false)
    expect(r.message).toBe(
      'Needs a person: resolve the conflict on GitHub (https://github.com/kensaurus/glot.it/pull/0). Review follow-ups are off for this team, so no conflict agent can run.',
    )
    expect(db.table('fix_merge_queue').find((q) => q.id === 'q3')).toMatchObject({ state: 'resolving', conflict_agents: 1 })
    expect(calls).toEqual([])
  })

  it('CI repair goes to the cloud agent when follow-ups can run there', async () => {
    const { app, db } = setup()
    state.followupsOn = true
    db.table('byok_keys').find((k) => k.id === 'k1')!.status = 'active'
    state.enqueue = { queued: true }
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'ci_repair', fixIds: [F1] })
    expect((res.body.data as { results: Array<{ ok: boolean; message: string }> }).results[0]).toMatchObject({ ok: true, message: 'Queued a cloud CI-repair agent; it starts within 10 minutes.' })
    expect(db.table('fix_events').filter((e) => String(e.dedupe_key ?? '').startsWith('local-ci-repair-request:'))).toHaveLength(0)
  })

  it('CI repair with cloud follow-ups off is handed to the local mushi work lanes, which read the request', async () => {
    const { app, db } = setup()
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'ci_repair', fixIds: [F1] })
    const [r] = (res.body.data as { results: Array<{ ok: boolean; message: string }> }).results
    expect(r).toMatchObject({
      ok: true,
      message: 'Queued for the local mushi work lanes (glot.it): mushi work --followups takes it on its next run. Review follow-ups are off for this team.',
    })
    const req = db.table('fix_events').find((e) => e.dedupe_key === `local-ci-repair-request:${F1}:head-${F1}`)
    expect(req).toMatchObject({ fix_attempt_id: F1, kind: 'followup', status: 'pending', label: 'CI repair handed to the local lanes' })
    // Twice is one request (dedupe key), and still a success.
    const again = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'ci_repair', fixIds: [F1] })
    expect((again.body.data as { results: Array<{ ok: boolean }> }).results[0].ok).toBe(true)
  })

  it('CI repair with follow-ups on but no usable Cursor key also goes local', async () => {
    const { app } = setup()
    state.followupsOn = true
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'ci_repair', fixIds: [F1] })
    // With cloud follow-ups on, a cloud-agent PR is not the local lanes' either: it says why neither can.
    expect((res.body.data as { results: Array<{ ok: boolean; message: string }> }).results[0]).toMatchObject({
      ok: false,
      message: expect.stringContaining('No Cursor key can run cloud agents for this app, and the local mushi work lanes cannot take it'),
    })
  })

  it('a hand-off the local lanes cannot take says why: CI is green', async () => {
    const { app, db } = setup()
    db.table('ci_jobs').find((j) => j.head_sha === `head-${F1}`)!.conclusion = 'success'
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'ci_repair', fixIds: [F1] })
    expect((res.body.data as { results: Array<{ ok: boolean; message: string }> }).results[0]).toMatchObject({
      ok: false,
      message: expect.stringContaining('Review follow-ups are off for this team, and the local mushi work lanes cannot take it: CI on its commit is not failing'),
    })
  })

  it('a fix-first follow-up goes to the local lanes while cloud follow-ups are off', async () => {
    const { app, db } = setup()
    const rv = db.table('fix_reviews').find((r) => r.fix_attempt_id === F1)!
    rv.verdict = 'fix_first'
    rv.findings = [{ issue: 'Fixes one case of three.', severity: 'major' }]
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'followup', fixIds: [F1] })
    expect((res.body.data as { results: Array<{ ok: boolean; message: string }> }).results[0]).toMatchObject({ ok: true, message: expect.stringContaining('Queued for the local mushi work lanes (glot.it)') })
    expect(db.table('fix_events').find((e) => e.dedupe_key === `local-followup-request:${F1}:head-${F1}`)).toBeTruthy()
  })

  it('train retry runs the queue and says when no train could leave yet', async () => {
    const { app, calls } = setup()
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'train_retry', projectId: P1 })
    expect(calls).toEqual([`run:${P1}`])
    const results = (res.body.data as { results: Array<{ id: string; ok: boolean; message: string }> }).results
    expect(results).toEqual([{ id: 'kensaurus/glot.it', ok: false, message: 'No train left: the next one may leave at 16:00 UTC (one train every 360 min).' }])
  })
})

// Report 69fcafcb: /pipeline offered Re-run CI that always 403'd and CI repair
// the server refused for reasons it already knew. Every item now carries the
// refusals the read can see, in the action routes' own words.
type Item = { id: string; blocked: Record<string, string> }
type Group = { id: string; actions: string[]; items: Item[] }

const ROUTE_ACTIONS = ['ci_repair', 'followup', 'conflict_agent', 'remove', 'update_branch', 'mark_ready', 'close']

async function offered(projectId: string | undefined, prepare: (db: FakeDb) => void) {
  const { app, db } = setup()
  prepare(db)
  state.query = projectId ? { projectId } : {}
  const res = await app.call('GET', '/v1/admin/pipeline')
  const stages = (res.body.data as { stages: Array<{ groups: Group[] }> }).stages
  const out: Array<{ fixId: string; action: string; blocked: string | undefined }> = []
  for (const s of stages)
    for (const g of s.groups)
      for (const i of g.items)
        for (const action of g.actions)
          if (ROUTE_ACTIONS.includes(action) && i.id.startsWith('3000000')) out.push({ fixId: i.id, action, blocked: i.blocked[action] })
  return out
}

const twoRounds = (db: FakeDb) => {
  db.table('fix_review_followups').push(
    { id: 'fu1', fix_attempt_id: F1, status: 'completed', kind: 'ci_repair', head_sha_before: 'old-1', cursor_agent_id: 'bc-1' },
    { id: 'fu2', fix_attempt_id: F1, status: 'completed', kind: 'ci_repair', head_sha_before: 'old-2', cursor_agent_id: 'bc-2' },
  )
}

describe('what /pipeline offers is what the action routes do', () => {
  const scenarios: Array<[string, (db: FakeDb) => void]> = [
    ['follow-ups off, no usable Cursor key', () => {}],
    ['CI green on the reviewed head', (db) => {
      db.table('ci_jobs').find((j) => j.head_sha === `head-${F1}`)!.conclusion = 'success'
    }],
    ['both follow-up rounds used', twoRounds],
    ['conflict row under the cap, no cloud agent', (db) => {
      db.table('fix_merge_queue').find((q) => q.id === 'q3')!.conflict_agents = 1
    }],
  ]
  for (const [name, prepare] of scenarios) {
    it(`an offered action is never refused for a reason the read had, and a blocked one is refused with that reason (${name})`, async () => {
      const cases = await offered(undefined, prepare)
      expect(cases.length).toBeGreaterThan(0)
      for (const c of cases) {
        const { app, db } = setup()
        prepare(db)
        const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: c.action, fixIds: [c.fixId], reason: 'Checked by the test' })
        const [r] = (res.body.data as { results: Array<{ ok: boolean; message: string }> }).results
        const seen = { ...c, ok: r.ok, message: r.message }
        if (c.blocked) expect(seen).toMatchObject({ ok: false, message: c.blocked })
        else expect(seen).toMatchObject({ ok: true })
      }
    })
  }

  it('says why CI repair cannot run when both rounds were used', async () => {
    const cases = await offered(P1, twoRounds)
    expect(cases.find((c) => c.fixId === F1 && c.action === 'ci_repair')?.blocked).toBe(
      'Review follow-ups are off for this team, and the local mushi work lanes cannot take it: Both follow-up rounds were used on this pull request; a person decides what happens next.',
    )
  })

  it('Re-run CI is blocked for an app whose token GitHub refused, until its settings change', async () => {
    const read = async (settingsAt: string) => {
      const { app, db } = setup()
      db.table('fix_events').push({ fix_attempt_id: F1, project_id: P1, kind: 'ci_started', status: 'fail', at: '2026-10-26T10:00:00Z', label: 'Re-run refused', dedupe_key: `ci_rerun_refused:${F1}:2026-10-26T10:00:00Z` })
      db.table('project_settings').find((r) => r.project_id === P1)!.updated_at = settingsAt
      state.query = { projectId: P1 }
      const res = await app.call('GET', '/v1/admin/pipeline')
      const ci = (res.body.data as { stages: Array<{ id: string; groups: Group[] }> }).stages.find((s) => s.id === 'ci')!
      return ci.groups.find((g) => g.id === 'ci_red_queued')!.items[0].blocked.rerun_ci
    }
    expect(await read('2026-10-01T00:00:00Z')).toMatch(/^The GitHub token cannot re-run workflows: give it Actions: Read and write/)
    // A settings save after the refusal (a new token) offers it again.
    expect(await read('2026-10-26T11:00:00Z')).toBeUndefined()
  })
})

describe('GET /v1/admin/pipeline/fix/:id', () => {
  it("returns one fix's group, actions, refusals and failing checks", async () => {
    const { app } = setup()
    const res = await app.call('GET', '/v1/admin/pipeline/fix/:id', undefined, { id: F1 })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      stage: 'ci',
      groupId: 'ci_red_queued',
      tone: 'stuck',
      actions: expect.arrayContaining(['ci_repair', 'rerun_ci']),
      item: { id: F1, failingChecks: ['Build & Test'], blocked: {} },
    })
  })

  it("a fix in no group answers with nulls; another team's fix is a 404", async () => {
    const { app, db } = setup()
    const F4 = '3000000d-0000-4000-8000-000000000000'
    db.table('fix_attempts').push(attempt(F4, { pr_state: 'closed' }))
    const none = await app.call('GET', '/v1/admin/pipeline/fix/:id', undefined, { id: F4 })
    expect(none.body.data).toMatchObject({ stage: null, groupId: null, item: null, actions: [] })
    state.accessible = [P2]
    expect((await app.call('GET', '/v1/admin/pipeline/fix/:id', undefined, { id: F1 })).status).toBe(404)
    expect((await app.call('GET', '/v1/admin/pipeline/fix/:id', undefined, { id: 'nope' })).status).toBe(400)
  })
})

describe('local workers on /pipeline (ADR 0048)', () => {
  const C1 = '5000000a-0000-4000-8000-000000000000'
  const seedInfra = (db: FakeDb, over: Record<string, unknown> = {}) => {
    db.table('work_lanes').push({ id: 'lane-1', host_id: 'host-1', project_id: P1, name: 'glot', paused: false, drain: false, stop_at: null, mode: 'fix', model: 'grok-4.7-xhigh-fast' })
    db.table('work_hosts').push({ id: 'host-1', last_heartbeat_at: '2026-10-26T11:59:00Z', revoked_at: null })
    db.table('work_claims').push({
      id: C1, project_id: P1, report_id: 'r-new', lane_id: 'lane-1', host_id: 'host-1', status: 'done', outcome: 'failed', failure_kind: 'infra',
      detail: 'git fetch: Permission denied', auto_requeued: false, claimed_at: '2026-10-26T10:00:00Z', finished_at: '2026-10-26T10:05:00Z', ...over,
    })
  }

  it('lists runs the machine stopped, with Requeue, and counts the registered lane as an opener', async () => {
    const { app, db } = setup()
    seedInfra(db)
    const res = await app.call('GET', '/v1/admin/pipeline')
    const stages = (res.body.data as { stages: Array<{ groups: Array<{ id: string; actions: string[]; items: Array<{ id: string; reportId: string | null }> }> }> }).stages
    const group = stages.flatMap((s) => s.groups).find((g) => g.id === 'local_infra')
    expect(group?.actions).toEqual(['requeue'])
    expect(group?.items.map((i) => [i.id, i.reportId])).toEqual([[C1, 'r-new']])
    const openers = (res.body.data as { dispatchers: Array<{ projectId: string; opener: string; problem: string | null; local: { lanes: number; lanesActive: number; models: string[] } }> }).dispatchers
    const p1 = openers.find((d) => d.projectId === P1)!
    expect(p1.local).toMatchObject({ lanes: 1, lanesActive: 1, models: ['grok-4.7-xhigh-fast'] })
    // Auto-fix is on with no agent key, but a lane takes the app's reports: nothing is left unopened.
    expect(p1.problem).toBeNull()
  })

  it('a run already put back once on its own is not listed', async () => {
    const { app, db } = setup()
    seedInfra(db, { auto_requeued: true })
    const res = await app.call('GET', '/v1/admin/pipeline')
    const stages = (res.body.data as { stages: Array<{ groups: Array<{ id: string }> }> }).stages
    expect(stages.flatMap((s) => s.groups).some((g) => g.id === 'local_infra')).toBe(false)
  })

  it('requeue puts the report at the front of its lane; a viewer is refused', async () => {
    const { app, db } = setup()
    seedInfra(db)
    db.table('work_queue').push({ id: 'q-old', lane_id: 'lane-1', project_id: P1, report_id: 'r-other', position: 1_800_000_000, source: 'console' })
    state.roles = { [P1]: 'viewer' }
    const refused = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'requeue', claimIds: [C1] })
    expect((refused.body.data as { results: Array<{ ok: boolean }> }).results[0]!.ok).toBe(false)
    state.roles = {}
    const res = await app.call('POST', '/v1/admin/pipeline/actions', { action: 'requeue', claimIds: [C1] })
    expect((res.body.data as { results: Array<{ ok: boolean; message: string }> }).results[0]).toMatchObject({ ok: true })
    const queue = [...db.table('work_queue')].sort((a, b) => Number(a.position) - Number(b.position))
    expect(queue.map((q) => q.report_id)).toEqual(['r-new', 'r-other'])
    expect(queue[0]).toMatchObject({ source: 'requeue', lane_id: 'lane-1' })
  })
})
