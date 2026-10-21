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
 *              "Re-ran tests" fix event on success.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

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
}))
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
  rate: { allowed: boolean }
  role: { value: string | null }
  github: Record<string, { status: number; body: unknown }>
}

function setup(seed: Record<string, Array<Record<string, unknown>>> = {}): Setup {
  let db: FakeDb
  let clock = NOW
  db = makeFakeDb(
    {
      projects: [{ id: P1, name: 'glot.it', organization_id: ORG }, { id: P2, name: 'yen-yen', organization_id: ORG }],
      project_repos: [{ project_id: P1, repo_url: 'https://github.com/kensaurus/glot.it', github_app_installation_id: null }],
      ...seed,
    },
    {
      rpc: (fn, args) => {
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
  const rate = { allowed: true }
  const role = { value: 'member' as string | null }
  const github: Setup['github'] = {}
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
    adminOrApiKeyRead: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    adminOrApiKeyWrite: (async (_c: unknown, next: () => Promise<void>) => next()) as never,
    claimRateLimit: async () => ({ allowed: rate.allowed, retryAfterSec: 60 }),
    callerProjectIds: async (c: any) => (c.get('authMethod') === 'apiKey' ? [P1] : [P1, P2]),
    callerCanAccessProject: async () => ({ allowed: role.value != null, role: role.value }) as never,
    collector: { resolveToken: async () => 'ghp_test', now: () => clock },
    resolveAttemptToken: async () => 'ghp_test',
    fetchPullRequest: (async () => ({ number: 152, draft: false, state: 'open', merged: false, headSha: 'head1' })) as never,
    fetchImpl,
    now: () => clock,
  })
  return Object.assign({ db, app, calls, rate, role, github }, { tick: (ms: number) => { clock = new Date(clock.getTime() + ms) } })
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

  it('needs a project key and answers 429 over the limit', async () => {
    const s = setup()
    expect((await ingest(s, heartbeat(), null)).body.error?.code).toBe('PROJECT_KEY_REQUIRED')
    s.rate.allowed = false
    expect((await ingest(s, heartbeat())).status).toBe(429)
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

  it('says when the token cannot write Actions', async () => {
    const s = setup({ fix_attempts: [fix] })
    s.github['/actions/runs?head_sha=head1'] = { status: 200, body: { workflow_runs: [{ id: 9001, status: 'completed', conclusion: 'failure' }] } }
    s.github['/rerun-failed-jobs'] = { status: 403, body: { message: 'Resource not accessible by personal access token' } }
    const res = await rerun(s)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('GITHUB_ACTIONS_WRITE_MISSING')
    expect(s.db.table('fix_events')).toHaveLength(0)
  })
})
