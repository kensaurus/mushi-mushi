/**
 * FILE: ci-routes.test.ts
 * PURPOSE: The CI routes (Plan 022) through the real handlers on an
 *          in-memory database:
 *            - POST /v1/ingest/runner: strict schema (hashed host ids only,
 *              ≤ 40 runners, no extra keys), 60/min, heartbeat upsert by
 *              (organization, host), job samples stored once;
 *            - GET /v1/admin/ci/overview: scope, refresh=1 runs one live
 *              sync a minute, refreshedAt and queued jobs come back;
 *            - POST /v1/admin/fixes/:id/ci/rerun: viewers refused, 409 while
 *              CI runs, 403 when the token cannot write Actions, a
 *              "Re-ran tests" fix event on success;
 *            - POST /v1/admin/projects/:id/runner-key: mints a key whose only
 *              scope is runner:write, plaintext once; viewers refused, 10/h.
 *          The runner:write gate itself runs on the real middleware in
 *          ci-runner-scope.test.ts.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { hashApiKey, mintProjectApiKey } from '../../supabase/functions/_shared/api-key-mint.ts'

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
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  requireApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) =>
    c.json({ ok: false, error: { code, message } }, status),
  callerProjectIds: async () => [],
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))

let ci: typeof import('../../supabase/functions/api/routes/ci.ts')
beforeAll(async () => {
  ci = await import('../../supabase/functions/api/routes/ci.ts')
})

const NOW = new Date('2026-10-21T09:00:00Z')
const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const FIX = '3000000a-0000-4000-8000-000000000000'
const HOST = 'a'.repeat(64)

type Res = { status: number; body: { ok: boolean; data?: any; error?: { code: string; message: string } } }
type Handler = (c: unknown) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handler: h[h.length - 1] }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handler: h[h.length - 1] }) }
  put(path: string, ...h: Handler[]) { this.routes.push({ method: 'PUT', path, handler: h[h.length - 1] }) }
  async call(method: string, path: string, opts: { body?: unknown; query?: Record<string, string>; params?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'jwt', ...opts.vars }
    const headers: Record<string, string> = {}
    const c = {
      req: {
        json: async () => {
          if (opts.body === 'not json') throw new Error('bad json')
          return opts.body ?? {}
        },
        param: (k: string) => opts.params?.[k],
        header: () => undefined,
        query: (k: string) => opts.query?.[k],
      },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      header: (k: string, v: string) => { headers[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

interface Setup {
  db: FakeDb
  app: FakeApp
  calls: string[]
  rate: { allowed: boolean; unavailable: boolean }
  role: { value: string | null }
  github: Record<string, { status: number; body: unknown }>
  audits: unknown[][]
  orgAudits: unknown[]
}

type DbOpts = Pick<NonNullable<Parameters<typeof makeFakeDb>[1]>, 'failRead' | 'rpcError'> & { rpc?: (fn: string, args: Record<string, unknown>) => unknown }

function setup(seed: Record<string, Array<Record<string, unknown>>> = {}, dbOpts: DbOpts = {}): Setup {
  let db: FakeDb
  let clock = NOW
  db = makeFakeDb(
    {
      projects: [{ id: P1, name: 'glot.it', organization_id: ORG }, { id: P2, name: 'yen-yen', organization_id: ORG }],
      project_repos: [{ project_id: P1, repo_url: 'https://github.com/kensaurus/glot.it', github_app_installation_id: null }],
      ...seed,
    },
    {
      failRead: dbOpts.failRead,
      rpcError: dbOpts.rpcError,
      rpc: (fn, args) => {
        if (dbOpts.rpc && fn !== 'ci_claim_live_sync') return dbOpts.rpc(fn, args)
        if (fn !== 'ci_claim_live_sync') return null
        const rows = db.table('ci_collector_state')
        const row = rows.find((r) => r.project_id === args.p_project_id)
        if (row?.last_live_sync_at && clock.getTime() - Date.parse(String(row.last_live_sync_at)) < 60_000) return false
        if (row) row.last_live_sync_at = clock.toISOString()
        else rows.push({ project_id: args.p_project_id, permissions: {}, last_live_sync_at: clock.toISOString() })
        return true
      },
    },
  )
  const calls: string[] = []
  const rate = { allowed: true, unavailable: false }
  const role = { value: 'member' as string | null }
  const github: Setup['github'] = {}
  const audits: unknown[][] = []
  const orgAudits: unknown[] = []
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push(`${init.method ?? 'GET'} ${url}`)
    const hit = Object.entries(github).find(([k]) => url.includes(k))
    const r = hit?.[1] ?? { status: 200, body: { workflow_runs: [], jobs: [] } }
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status })
  }
  const app = new FakeApp()
  ci.registerCiRoutes(app as never, {
    getServiceClient: () => db as never,
    apiKeyAuth: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    requireRunnerScope: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    adminOrApiKeyRead: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    adminOrApiKeyWrite: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    jwtAuth: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    claimRateLimit: async () => ({
      allowed: rate.unavailable ? false : rate.allowed,
      retryAfterSec: rate.unavailable ? 30 : 60,
      ...(rate.unavailable ? { unavailable: true as const } : {}),
    }),
    callerProjectIds: async (c: any) => (c.get('authMethod') === 'apiKey' ? [P1] : [P1, P2]),
    callerCanAccessProject: async () => ({ allowed: role.value != null, role: role.value }) as never,
    collector: { resolveToken: async () => 'ghp_test', now: () => clock },
    resolveAttemptToken: async () => 'ghp_test',
    fetchPullRequest: (async () => ({ number: 152, draft: false, state: 'open', merged: false, headSha: 'head1' })) as never,
    mintKey: mintProjectApiKey,
    logAudit: (async (...args: unknown[]) => { audits.push(args) }) as never,
    logOrgAudit: (async (_db: unknown, input: unknown) => { orgAudits.push(input) }) as never,
    fetchImpl,
    now: () => clock,
  })
  return Object.assign({ db, app, calls, rate, role, github, audits, orgAudits }, { tick: (ms: number) => { clock = new Date(clock.getTime() + ms) } })
}

const heartbeat = (over: Record<string, unknown> = {}) => ({
  kind: 'heartbeat',
  host: { host_id: HOST, hostname: 'nuc', platform: 'linux', cpu_count: 8, mem_total_mb: 16000, mushi_version: '1.0.0', metrics: { load1: 0.5, swap_used_mb: 10, swap_total_mb: 4096 } },
  runners: [{ name: 'kensaurus-local-glot-1', repo: 'kensaurus/glot.it', service: 'actions.runner.glot.service', active: true, restarts: 0, mem_current_mb: 900, mem_max_mb: 4096, oom_kills: 0 }],
  ...over,
})

describe('POST /v1/ingest/runner', () => {
  const ingest = (s: Setup, body: unknown, projectId: string | null = P1) => s.app.call('POST', '/v1/ingest/runner', { body, vars: { projectId, authMethod: 'apiKey' } })

  it('stores a heartbeat per organization and host, with server time', async () => {
    const s = setup()
    const res = await ingest(s, heartbeat())
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ hostId: HOST, runners: 1 })
    await ingest(s, heartbeat({ host: { ...heartbeat().host, hostname: 'nuc-renamed' } }))
    const hosts = s.db.table('ci_runner_hosts')
    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toMatchObject({ organization_id: ORG, project_id: P1, hostname: 'nuc-renamed', last_heartbeat_at: NOW.toISOString() })
  })

  it('refuses a raw machine id, a long hostname, extra keys and more than 40 runners', async () => {
    const s = setup()
    const rawId = await ingest(s, heartbeat({ host: { ...heartbeat().host, host_id: '3f2c9a0b8d7e6f5a4b3c2d1e0f9a8b7c' } }))
    expect(rawId.status).toBe(400)
    expect(rawId.body.error?.message).toMatch(/sha256/)
    expect((await ingest(s, heartbeat({ host: { ...heartbeat().host, hostname: 'x'.repeat(81) } }))).status).toBe(400)
    expect((await ingest(s, heartbeat({ env: { SECRET: 'x' } }))).status).toBe(400)
    expect((await ingest(s, heartbeat({ host: { ...heartbeat().host, machine_id: 'abc' } }))).status).toBe(400)
    const many = Array.from({ length: 41 }, (_, i) => ({ name: `r${i}`, active: true }))
    expect((await ingest(s, heartbeat({ runners: many }))).status).toBe(400)
    expect((await ingest(s, 'not json')).status).toBe(400)
    expect(s.db.table('ci_runner_hosts')).toHaveLength(0)
  })

  it('accepts a hashed WSL machine id in metrics and refuses a raw one', async () => {
    const s = setup()
    const withId = (machine_id: string) => heartbeat({ host: { ...heartbeat().host, metrics: { ...heartbeat().host.metrics, machine_id } } })
    expect((await ingest(s, withId('f'.repeat(64)))).status).toBe(200)
    expect(s.db.table('ci_runner_hosts')[0].metrics).toMatchObject({ machine_id: 'f'.repeat(64) })
    expect((await ingest(s, withId('b007-1d'))).status).toBe(400)
  })

  it('needs a project key and answers 429 over the limit', async () => {
    const s = setup()
    expect((await ingest(s, heartbeat(), null)).body.error?.code).toBe('PROJECT_KEY_REQUIRED')
    s.rate.allowed = false
    expect((await ingest(s, heartbeat())).status).toBe(429)
  })

  it('answers 503 RATE_LIMIT_UNAVAILABLE when the claim RPC fails', async () => {
    const s = setup()
    s.rate.unavailable = true
    const res = await ingest(s, heartbeat())
    expect(res.status).toBe(503)
    expect(res.body.error?.code).toBe('RATE_LIMIT_UNAVAILABLE')
    expect(s.db.table('ci_runner_hosts')).toHaveLength(0)
  })

  it('stores a job sample once', async () => {
    const s = setup()
    const sample = { kind: 'job', host_id: HOST, runner_name: 'kensaurus-local-glot-1', repo: 'kensaurus/glot.it', run_id: 9001, run_attempt: 1, job_key: '9001-1-build', phase: 'completed', at: '2026-10-21T08:58:00Z', mem_peak_mb: 3900, mem_max_mb: 4096, oom_kills: 1 }
    expect((await ingest(s, sample)).status).toBe(200)
    expect((await ingest(s, sample)).status).toBe(200)
    expect(s.db.table('ci_runner_job_samples')).toHaveLength(1)
    expect(s.db.table('ci_runner_job_samples')[0]).toMatchObject({ organization_id: ORG, oom_kills: 1 })
    expect((await ingest(s, { ...sample, at: '2026-12-01T00:00:00Z' })).body.error?.code).toBe('SAMPLE_OUT_OF_RANGE')
  })
})

describe('GET /v1/admin/ci/overview', () => {
  it('refuses a project the caller cannot read', async () => {
    const s = setup()
    const res = await s.app.call('GET', '/v1/admin/ci/overview', { query: { project_id: '9000000a-0000-4000-8000-000000000000' } })
    expect(res.status).toBe(403)
  })

  it('runs one live sync a minute and returns queued jobs with refreshedAt', async () => {
    const s = setup()
    s.github['/actions/runs?status=queued'] = { status: 200, body: { workflow_runs: [{ id: 5, status: 'queued', created_at: '2026-10-21T08:40:00Z', updated_at: '2026-10-21T08:40:00Z' }] } }
    s.github['/actions/runs/5/jobs'] = {
      status: 200,
      body: { jobs: [{ id: 50, run_id: 5, name: 'build', status: 'queued', conclusion: null, created_at: '2026-10-21T08:40:00Z', runner_name: null, labels: ['self-hosted', 'glot'] }] },
    }
    const first = await s.app.call('GET', '/v1/admin/ci/overview', { query: { refresh: '1' } })
    expect(first.status).toBe(200)
    expect(first.body.data.refreshedAt).toBe(NOW.toISOString())
    expect(first.body.data.jobs[0]).toMatchObject({ status: 'queued', ciKind: 'waiting_for_runner', infra: true, runnerName: null, labels: ['self-hosted', 'glot'] })
    expect(first.body.data.repos[0]).toMatchObject({ repo: 'kensaurus/glot.it', queued: 1 })
    const callsAfterFirst = s.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)
    expect(callsAfterFirst).toBeLessThanOrEqual(12)

    ;(s as unknown as { tick: (ms: number) => void }).tick(20_000)
    const second = await s.app.call('GET', '/v1/admin/ci/overview', { query: { refresh: '1' } })
    expect(second.status).toBe(200)
    expect(s.calls.length).toBe(callsAfterFirst)
    expect(second.body.data.refreshedAt).toBe(NOW.toISOString())

    // Without refresh: no GitHub call at all.
    await s.app.call('GET', '/v1/admin/ci/overview')
    expect(s.calls.length).toBe(callsAfterFirst)
  })
})

describe('POST /v1/admin/fixes/:id/ci/rerun', () => {
  const fix = { id: FIX, project_id: P1, repo_id: null, pr_url: 'https://github.com/kensaurus/glot.it/pull/152', pr_number: 152, commit_sha: 'old' }
  const rerun = (s: Setup) => s.app.call('POST', '/v1/admin/fixes/:id/ci/rerun', { params: { id: FIX } })

  it('re-runs the failed run on the PR head and records the event', async () => {
    const s = setup({ fix_attempts: [fix] })
    s.github['/actions/runs?head_sha=head1'] = { status: 200, body: { workflow_runs: [{ id: 9002, status: 'completed', conclusion: 'success' }, { id: 9001, status: 'completed', conclusion: 'cancelled' }] } }
    s.github['/actions/runs/9001/rerun-failed-jobs'] = { status: 201, body: {} }
    const res = await rerun(s)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ rerun: [{ runId: 9001 }], headSha: 'head1' })
    expect(s.calls).toContain('POST https://api.github.com/repos/kensaurus/glot.it/actions/runs/9001/rerun-failed-jobs')
    expect(s.db.table('fix_events')[0]).toMatchObject({ fix_attempt_id: FIX, kind: 'ci_started', status: 'pending', label: 'Re-ran tests' })
  })

  it('refuses viewers, and answers 409 while CI runs', async () => {
    const s = setup({ fix_attempts: [fix] })
    s.role.value = 'viewer'
    expect((await rerun(s)).status).toBe(403)
    s.role.value = 'member'
    s.github['/actions/runs?head_sha=head1'] = { status: 200, body: { workflow_runs: [{ id: 9003, status: 'in_progress', conclusion: null }] } }
    expect((await rerun(s)).body.error?.code).toBe('CI_RUNNING')
  })

  it('says when the token cannot write Actions, and remembers it so /pipeline stops offering the re-run (69fcafcb)', async () => {
    const s = setup({ fix_attempts: [fix] })
    s.github['/actions/runs?head_sha=head1'] = { status: 200, body: { workflow_runs: [{ id: 9001, status: 'completed', conclusion: 'failure' }] } }
    s.github['/rerun-failed-jobs'] = { status: 403, body: { message: 'Resource not accessible by personal access token' } }
    const res = await rerun(s)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('GITHUB_ACTIONS_WRITE_MISSING')
    const events = s.db.table('fix_events')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ fix_attempt_id: FIX, project_id: P1, kind: 'ci_started', status: 'fail', payload: { rerunRefused: 'actions_write' } })
    expect(String(events[0].dedupe_key)).toMatch(/^ci_rerun_refused:/)
  })
})

describe('POST /v1/admin/projects/:id/runner-key', () => {
  const mint = (s: Setup, body: unknown = { label: 'nuc glot' }) =>
    s.app.call('POST', '/v1/admin/projects/:id/runner-key', { params: { id: P1 }, body })

  it('mints a key whose only scope is runner:write and returns it once', async () => {
    const s = setup()
    const res = await mint(s)
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ scopes: ['runner:write'], label: 'runner:nuc-glot' })
    expect(res.body.data.key).toMatch(/^mushi_[0-9a-f]{32}$/)
    const rows = s.db.table('project_api_keys')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ project_id: P1, scopes: ['runner:write'], label: 'runner:nuc-glot', is_active: true })
    // Only the hash is stored, and it is the hash auth.ts looks keys up by.
    expect(rows[0].key_hash).toBe(await hashApiKey(res.body.data.key))
    expect(JSON.stringify(rows[0])).not.toContain(res.body.data.key)
    expect(s.audits[0]?.[3]).toBe('api_key.created')
  })

  it('refuses viewers, projects the caller cannot reach, and more than 10 an hour', async () => {
    const s = setup()
    s.role.value = 'viewer'
    expect((await mint(s)).status).toBe(403)
    s.role.value = null
    expect((await mint(s)).status).toBe(404)
    s.role.value = 'member'
    s.rate.allowed = false
    expect((await mint(s)).status).toBe(429)
    expect(s.db.table('project_api_keys')).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Plan 022 Phase 7: cost and speed (ADR 0037)
// ─────────────────────────────────────────────────────────────────────────────

const ORG2 = '0000000b-0000-4000-8000-000000000000'
const ciJob = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  project_id: P1,
  repo: 'kensaurus/glot.it',
  workflow_name: 'CI',
  job_name: 'Lint & Build',
  event: 'pull_request',
  head_branch: 'feat/x',
  pr_number: 3,
  run_attempt: 1,
  status: 'completed',
  ci_kind: 'passed',
  runner_name: 'GitHub Actions 1000',
  runner_group_name: 'GitHub Actions',
  runner_kind: 'github_hosted',
  runner_labels: ['ubuntu-latest'],
  queue_seconds: 2,
  duration_seconds: 85,
  started_at: new Date(NOW.getTime() - 3600_000).toISOString(),
  completed_at: new Date(NOW.getTime() - 3600_000 + 85_000).toISOString(),
  gh_created_at: new Date(NOW.getTime() - 3602_000).toISOString(),
  ...over,
})
const MISSING_FN = { code: 'PGRST202', message: 'Could not find the function public.ci_runner_comparison' }
const MISSING_TABLE = { code: '42P01', message: 'relation "public.ci_cost_settings" does not exist' }

describe('GET /v1/admin/ci/compare', () => {
  it('validates project_id and refuses a project the caller cannot read', async () => {
    const s = setup()
    expect((await s.app.call('GET', '/v1/admin/ci/compare', { query: { project_id: 'nope' } })).status).toBe(400)
    const res = await s.app.call('GET', '/v1/admin/ci/compare', { query: { project_id: '1000000c-0000-4000-8000-000000000000' } })
    expect(res.status).toBe(403)
  })

  it('reads the SQL aggregate over a window clamped to 30 days, scoped to the project', async () => {
    const s = setup({}, {
      // ci_cost_facts (the cost rules' job facts) answers its own shape.
      rpc: (fn) =>
        fn === 'ci_cost_facts'
          ? { events: [], prs: [], steps: [], jobs: 0 }
          : { groups: [{ project_id: P1, repo: 'kensaurus/glot.it', runner_class: 'github_hosted', os: 'linux', labels: ['ubuntu-latest'], jobs: '3', billed_minutes: '6', raw_seconds: '255' }], pairs: [], workflows: [], intervals: [], oldest: NOW.toISOString(), jobs: 3 },
    })
    const res = await s.app.call('GET', '/v1/admin/ci/compare', { query: { project_id: P1, days: '99' } })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ source: 'sql', sourceNote: null, window: { days: 30 } })
    expect(res.body.data.rows[0]).toMatchObject({ repo: 'kensaurus/glot.it', billedMinutes: 6, jobs: 3 })
    const call = s.db.rpcCalls.find((r) => r.fn === 'ci_runner_comparison')!
    expect(call.args.project_ids).toEqual([P1])
    expect(Date.parse(String(call.args.p_to)) - Date.parse(String(call.args.p_from))).toBe(30 * 24 * 60 * 60_000)
  })

  it('falls back to the newest jobs when the function is not applied, and to example figures without the settings table', async () => {
    const s = setup(
      { ci_jobs: [ciJob(), ciJob({ duration_seconds: 7, completed_at: new Date(NOW.getTime() - 3600_000 + 7_000).toISOString() })] },
      { rpcError: (fn) => (fn === 'ci_runner_comparison' ? MISSING_FN : null), failRead: (t) => (t === 'ci_cost_settings' ? MISSING_TABLE : null) },
    )
    const res = await s.app.call('GET', '/v1/admin/ci/compare', {})
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('rows')
    expect(res.body.data.sourceNote).toMatch(/not applied yet/)
    expect(res.body.data.settingsWritable).toBe(false)
    expect(res.body.data.settings[0]).toMatchObject({ source: 'default', organizationId: ORG })
    expect(res.body.data.rows[0]).toMatchObject({ jobs: 2, billedMinutes: 3, tinyJobs: 1 })
  })

  it('still answers when only the cost rules\' job facts fail, and says the job-based advice is left out', async () => {
    const s = setup({}, {
      rpc: () => ({ groups: [], pairs: [], workflows: [], intervals: [], oldest: null, jobs: 0 }),
      rpcError: (fn) => (fn === 'ci_cost_facts' ? { code: '57014', message: 'canceling statement due to statement timeout' } : null),
    })
    const res = await s.app.call('GET', '/v1/admin/ci/compare', {})
    expect(res.status).toBe(200)
    expect(res.body.data.sourceNote).toMatch(/job-based cost advice is left out/)
  })

  it('answers 500, never an empty comparison, when the aggregate fails for another reason', async () => {
    const s = setup({}, { rpcError: () => ({ code: '57014', message: 'canceling statement due to statement timeout' }) })
    const res = await s.app.call('GET', '/v1/admin/ci/compare', {})
    expect(res.status).toBe(500)
    expect(res.body.error?.code).toBe('CI_COMPARE_FAILED')
  })

  it('a project-bound key reads only its own project', async () => {
    const s = setup({}, { rpc: () => ({ groups: [], pairs: [], workflows: [], intervals: [], oldest: null, jobs: 0 }) })
    await s.app.call('GET', '/v1/admin/ci/compare', { vars: { authMethod: 'apiKey', projectId: P1 } })
    expect(s.db.rpcCalls.find((r) => r.fn === 'ci_runner_comparison')!.args.project_ids).toEqual([P1])
  })
})

describe('GET/PUT /v1/admin/ci/cost-settings', () => {
  const member = (role: string, org = ORG) => ({ organization_id: org, user_id: 'u1', role })
  const valid = (over: Record<string, unknown> = {}) => ({
    organizationId: ORG,
    currency: 'JPY',
    fxPerUsd: 150,
    wattsIdle: 40,
    wattsLoad: 220,
    pricePerKwh: 31,
    wearPerHour: 5,
    plan: 'pro',
    includedMinutes: 3000,
    selfHostedFeePerMinuteUsd: 0,
    machines: [{ name: 'Alienware', runners: ['aw-', 'alienware-'] }],
    ...over,
  })
  const put = (s: Setup, body: unknown, vars: Record<string, unknown> = {}) => s.app.call('PUT', '/v1/admin/ci/cost-settings', { body, vars })

  it('GET shows the example figures until saved; members may edit, viewers and API keys may not', async () => {
    const s = setup({ organization_members: [member('member')] })
    const res = await s.app.call('GET', '/v1/admin/ci/cost-settings', {})
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ writable: true, canEdit: true, settings: { organizationId: ORG, source: 'default', includedMinutes: 2000 } })
    s.db.table('organization_members')[0].role = 'viewer'
    expect((await s.app.call('GET', '/v1/admin/ci/cost-settings', {})).body.data.canEdit).toBe(false)
    s.db.table('organization_members')[0].role = 'owner'
    expect((await s.app.call('GET', '/v1/admin/ci/cost-settings', { vars: { authMethod: 'apiKey', projectId: P1 } })).body.data.canEdit).toBe(false)
  })

  it('GET says not writable before the table exists, and refuses an organization the caller cannot read', async () => {
    const s = setup({ organization_members: [member('owner')] }, { failRead: (t) => (t === 'ci_cost_settings' ? MISSING_TABLE : null) })
    expect((await s.app.call('GET', '/v1/admin/ci/cost-settings', {})).body.data).toMatchObject({ writable: false, canEdit: false })
    expect((await s.app.call('GET', '/v1/admin/ci/cost-settings', { query: { organization_id: ORG2 } })).status).toBe(403)
    expect((await s.app.call('GET', '/v1/admin/ci/cost-settings', { query: { organization_id: 'x' } })).status).toBe(400)
  })

  it('GET asks which organization when the caller has several', async () => {
    const s = setup({ projects: [{ id: P1, name: 'glot.it', organization_id: ORG }, { id: P2, name: 'yen-yen', organization_id: ORG2 }] })
    const res = await s.app.call('GET', '/v1/admin/ci/cost-settings', {})
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('ORG_REQUIRED')
    expect((await s.app.call('GET', '/v1/admin/ci/cost-settings', { query: { project_id: P2 } })).body.data.settings.organizationId).toBe(ORG2)
  })

  it('PUT saves the figures, audits what changed, and GET reads them back', async () => {
    const s = setup({ organization_members: [member('member')] })
    const res = await put(s, valid())
    expect(res.status).toBe(200)
    expect(res.body.data.settings).toMatchObject({ source: 'yours', currency: 'JPY', fxPerUsd: 150, pricePerKwh: 31, plan: 'pro', machines: [{ name: 'Alienware', runners: ['aw-', 'alienware-'] }] })
    expect(s.db.table('ci_cost_settings')[0]).toMatchObject({ organization_id: ORG, updated_by: 'u1', watts_load: 220 })
    expect(s.orgAudits[0]).toMatchObject({ organizationId: ORG, action: 'settings.updated', resourceType: 'ci_cost_settings', metadata: { first_save: true } })

    await put(s, valid({ pricePerKwh: 28 }))
    expect(s.orgAudits[1]).toMatchObject({ metadata: { changed: ['pricePerKwh'], first_save: false } })
    const back = await s.app.call('GET', '/v1/admin/ci/cost-settings', {})
    expect(back.body.data.settings.pricePerKwh).toBe(28)
  })

  it('PUT refuses viewers, non-members and API keys', async () => {
    const viewer = setup({ organization_members: [member('viewer')] })
    expect((await put(viewer, valid())).status).toBe(403)
    const stranger = setup()
    expect((await put(stranger, valid())).status).toBe(403)
    const key = setup({ organization_members: [member('owner')] })
    const res = await put(key, valid(), { authMethod: 'apiKey', projectId: P1 })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('CONSOLE_ONLY')
    expect(key.db.table('ci_cost_settings')).toHaveLength(0)
  })

  it('PUT enforces the bounds', async () => {
    const s = setup({ organization_members: [member('owner')] })
    const bad: Array<Record<string, unknown>> = [
      { wattsLoad: 99999 },
      { wattsIdle: -1 },
      { wattsIdle: 300, wattsLoad: 200 },
      { pricePerKwh: 1001 },
      { wearPerHour: 10001 },
      { fxPerUsd: 0 },
      { currency: 'yen' },
      { plan: 'gold' },
      { includedMinutes: 1.5 },
      { selfHostedFeePerMinuteUsd: 2 },
      { machines: Array.from({ length: 21 }, (_, i) => ({ name: `m${i}`, runners: ['r'] })) },
      { machines: [{ name: 'x', runners: [] }] },
      { extra: true },
    ]
    for (const over of bad) {
      const res = await put(s, valid(over))
      expect([res.status, over]).toEqual([400, over])
      expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    }
    expect((await put(s, 'not json')).status).toBe(400)
    expect(s.db.table('ci_cost_settings')).toHaveLength(0)
  })

  it('PUT refuses an organization the caller cannot read, and says 409 before the table exists', async () => {
    const s = setup({ organization_members: [member('owner')] }, { failRead: (t) => (t === 'ci_cost_settings' ? MISSING_TABLE : null) })
    expect((await put(s, valid({ organizationId: ORG2 }))).status).toBe(403)
    const res = await put(s, valid())
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('MIGRATION_PENDING')
  })
})
