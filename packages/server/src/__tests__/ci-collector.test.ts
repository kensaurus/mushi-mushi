/**
 * FILE: ci-collector.test.ts
 * PURPOSE: The ci-jobs-collector tick and the overview live sync (Plan 022):
 *            - runs updated in the last 2 h are read, finished runs already
 *              stored are not read again;
 *            - a refused runner list is recorded 'missing' and not asked
 *              again until a day later;
 *            - the 40-call tick budget is shared, least recently collected
 *              project first;
 *            - jobs older than 30 days are deleted;
 *            - the live sync claims each project once a minute (a second
 *              call within 60 s makes no GitHub call) and spends at most 12
 *              calls per request.
 */

import { describe, expect, it } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import {
  COLLECTOR_CALLS_PER_TICK,
  LIVE_SYNC_CALLS_PER_REQUEST,
  liveSyncProjects,
  runCiCollector,
  settleStaleLiveJobs,
  type CollectorDeps,
} from '../../supabase/functions/_shared/ci-collector.ts'

const NOW = new Date('2026-10-21T09:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'

const run = (id: number, status: string, updatedMinAgo: number) => ({
  id,
  name: 'CI',
  event: 'push',
  status,
  conclusion: status === 'completed' ? 'success' : null,
  head_branch: 'main',
  head_sha: `sha${id}`,
  created_at: new Date(NOW.getTime() - (updatedMinAgo + 5) * 60_000).toISOString(),
  updated_at: new Date(NOW.getTime() - updatedMinAgo * 60_000).toISOString(),
})

const job = (id: number, runId: number, status: string) => ({
  id,
  run_id: runId,
  name: `job ${id}`,
  status,
  conclusion: status === 'completed' ? 'success' : null,
  created_at: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
  started_at: status === 'queued' ? null : new Date(NOW.getTime() - 19 * 60_000).toISOString(),
  completed_at: status === 'completed' ? new Date(NOW.getTime() - 10 * 60_000).toISOString() : null,
  runner_name: status === 'queued' ? null : 'kensaurus-local-glot-1',
  labels: ['self-hosted', 'glot'],
})

function github(opts: { runs?: unknown[]; runners?: { status: number; body: unknown } } = {}) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    const m = /\/actions\/runs\/(\d+)\/jobs/.exec(url)
    if (m) {
      const id = Number(m[1])
      const r = (opts.runs ?? []).find((x) => (x as { id: number }).id === id) as { status: string } | undefined
      return new Response(JSON.stringify({ jobs: [job(id * 10, id, r?.status ?? 'completed')] }), { status: 200 })
    }
    if (url.includes('/actions/runners')) {
      const r = opts.runners ?? { status: 403, body: { message: 'Resource not accessible by personal access token' } }
      return new Response(JSON.stringify(r.body), { status: r.status })
    }
    if (url.includes('/actions/runs?')) {
      const status = new URL(url).searchParams.get('status')
      const runs = (opts.runs ?? []).filter((r) => !status || (r as { status: string }).status === status)
      return new Response(JSON.stringify({ workflow_runs: runs }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }
  return { calls, fetchImpl }
}

function deps(fetchImpl: CollectorDeps['fetchImpl'], now = NOW): CollectorDeps {
  return { resolveToken: async () => 'ghp_test', fetchImpl, now: () => now }
}

/** ci_claim_live_sync on the fake: true once per project per 60 s. */
function claimRpc(db: () => FakeDb, clock: () => Date) {
  return (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'ci_claim_live_sync') return null
    const rows = db().table('ci_collector_state')
    const row = rows.find((r) => r.project_id === args.p_project_id)
    const nowMs = clock().getTime()
    if (row && row.last_live_sync_at && nowMs - Date.parse(String(row.last_live_sync_at)) < Number(args.p_min_interval_seconds) * 1000) return false
    if (row) row.last_live_sync_at = clock().toISOString()
    else rows.push({ project_id: args.p_project_id, permissions: {}, last_live_sync_at: clock().toISOString() })
    return true
  }
}

describe('runCiCollector', () => {
  it('reads runs of the last 2 h, records a refused runner list, and skips stored finished runs', async () => {
    const db = makeFakeDb({ project_repos: [{ project_id: P1, repo_url: 'https://github.com/kensaurus/glot.it', github_app_installation_id: null }] })
    const gh = github({ runs: [run(1, 'completed', 30), run(2, 'in_progress', 5), run(3, 'completed', 300)] })
    const first = await runCiCollector(db as never, deps(gh.fetchImpl))
    // runs list + runner list + jobs of run 1 and run 2 (run 3 is outside the window).
    expect(gh.calls).toHaveLength(4)
    expect(first.stored).toBe(2)
    expect(db.table('ci_jobs').map((j) => j.run_id).sort()).toEqual([1, 2])
    const state = db.table('ci_collector_state')[0]
    expect(state.permissions).toMatchObject({ 'kensaurus/glot.it': { jobs: 'ok', runners: 'missing' } })

    gh.calls.length = 0
    await runCiCollector(db as never, deps(gh.fetchImpl, new Date(NOW.getTime() + 10 * 60_000)))
    // The refused runner list is not asked again; finished run 1 is not re-read; running run 2 is.
    expect(gh.calls.some((u) => u.includes('/actions/runners'))).toBe(false)
    expect(gh.calls.filter((u) => u.includes('/jobs'))).toEqual([expect.stringContaining('/actions/runs/2/jobs')])
  })

  it('shares the tick budget, least recently collected project first', async () => {
    const repos = Array.from({ length: 12 }, (_, i) => ({ project_id: i === 0 ? P1 : `2000000${i.toString(16)}-0000-4000-8000-000000000000`, repo_url: `https://github.com/acme/app${i}`, github_app_installation_id: null }))
    const db = makeFakeDb({
      project_repos: repos,
      // P1 was collected most recently, so it goes last and is left out this tick.
      ci_collector_state: [{ project_id: P1, permissions: {}, last_collected_at: NOW.toISOString() }],
    })
    const gh = github({ runs: [run(1, 'in_progress', 5), run(2, 'in_progress', 5)] })
    const out = await runCiCollector(db as never, deps(gh.fetchImpl))
    expect(gh.calls.length).toBeLessThanOrEqual(COLLECTOR_CALLS_PER_TICK)
    expect(out.calls).toBe(gh.calls.length)
    expect(out.skippedForBudget).toBeGreaterThan(0)
    expect(gh.calls.some((u) => u.includes('/acme/app0/'))).toBe(false)
  })

  it('deletes jobs older than 30 days', async () => {
    const db = makeFakeDb({
      project_repos: [],
      ci_jobs: [
        { project_id: P1, job_id: 1, gh_created_at: '2026-09-01T00:00:00Z' },
        { project_id: P1, job_id: 2, gh_created_at: '2026-10-20T00:00:00Z' },
      ],
      ci_runner_job_samples: [{ at: '2026-09-01T00:00:00Z' }, { at: '2026-10-21T08:00:00Z' }],
    })
    await runCiCollector(db as never, deps(github().fetchImpl))
    expect(db.table('ci_jobs').map((j) => j.job_id)).toEqual([2])
    expect(db.table('ci_runner_job_samples')).toHaveLength(1)
  })
})

describe('liveSyncProjects', () => {
  it('syncs queued and running runs, then does no GitHub call within 60 s', async () => {
    let clock = NOW
    let db: FakeDb
    db = makeFakeDb(
      { project_repos: [{ project_id: P1, repo_url: 'https://github.com/kensaurus/glot.it', github_app_installation_id: null }] },
      { rpc: claimRpc(() => db, () => clock) },
    )
    const gh = github({ runs: [run(1, 'queued', 1), run(2, 'in_progress', 1), run(3, 'completed', 5), run(4, 'completed', 40)] })
    const first = await liveSyncProjects(db as never, deps(gh.fetchImpl, clock), [P1])
    expect(first.synced).toEqual([P1])
    expect(first.refreshedAt).toBe(NOW.toISOString())
    // 3 run lists + jobs of runs 1, 2 and 3 (run 4 finished 40 min ago).
    expect(gh.calls).toHaveLength(6)
    expect(db.table('ci_jobs').find((j) => j.run_id === 1)).toMatchObject({ status: 'queued', runner_name: null, runner_labels: ['self-hosted', 'glot'] })

    gh.calls.length = 0
    clock = new Date(NOW.getTime() + 30_000)
    const second = await liveSyncProjects(db as never, deps(gh.fetchImpl, clock), [P1])
    expect(gh.calls).toHaveLength(0)
    expect(second.synced).toEqual([])
    expect(second.refreshedAt).toBe(NOW.toISOString())

    clock = new Date(NOW.getTime() + 61_000)
    const third = await liveSyncProjects(db as never, deps(gh.fetchImpl, clock), [P1])
    expect(third.synced).toEqual([P1])
  })

  it('spends at most 12 GitHub calls per request', async () => {
    let db: FakeDb
    db = makeFakeDb(
      {
        project_repos: [
          { project_id: P1, repo_url: 'https://github.com/kensaurus/glot.it', github_app_installation_id: null },
          { project_id: P2, repo_url: 'https://github.com/kensaurus/yen-yen', github_app_installation_id: null },
        ],
      },
      { rpc: claimRpc(() => db, () => NOW) },
    )
    const runs = Array.from({ length: 20 }, (_, i) => run(100 + i, 'queued', 1))
    const gh = github({ runs })
    const out = await liveSyncProjects(db as never, deps(gh.fetchImpl), [P1, P2])
    expect(gh.calls).toHaveLength(LIVE_SYNC_CALLS_PER_REQUEST)
    expect(out.calls).toBe(LIVE_SYNC_CALLS_PER_REQUEST)
  })
})

describe('settleStaleLiveJobs', () => {
  const REPO = 'kensaurus/tsumagoi'
  const stored = (jobId: number, status: string, updatedMinAgo: number, extra: Record<string, unknown> = {}) => ({
    project_id: P1,
    repo: REPO,
    run_id: 900,
    run_attempt: 1,
    job_id: jobId,
    job_name: `job ${jobId}`,
    status,
    conclusion: null,
    ci_kind: status === 'in_progress' ? 'running' : 'queued',
    event: 'pull_request',
    pr_number: 844,
    gh_created_at: new Date(NOW.getTime() - 9 * 60 * 60_000).toISOString(),
    updated_at: new Date(NOW.getTime() - updatedMinAgo * 60_000).toISOString(),
    ...extra,
  })

  function jobsApi(answers: Record<number, { status: number; body?: unknown }>) {
    const calls: string[] = []
    const fetchImpl = async (url: string) => {
      calls.push(url)
      const m = /\/actions\/jobs\/(\d+)$/.exec(url)
      const a = m ? answers[Number(m[1])] : undefined
      if (!a) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify(a.body ?? { message: 'Not Found' }), { status: a.status })
    }
    return { calls, fetchImpl }
  }

  const finished = (id: number) => ({
    ...job(id, 900, 'completed'),
    run_attempt: 1,
    head_branch: 'cursor/fix',
    completed_at: new Date(NOW.getTime() - 8 * 60 * 60_000).toISOString(),
  })

  it('re-reads a job stored as running for hours, and keeps its PR and event', async () => {
    const db = makeFakeDb({
      project_repos: [{ project_id: P1, repo_url: `https://github.com/${REPO}`, github_app_installation_id: null }],
      ci_jobs: [stored(11, 'in_progress', 9 * 60)],
    })
    const gh = jobsApi({ 11: { status: 200, body: finished(11) } })
    const n = await settleStaleLiveJobs(db as never, deps(gh.fetchImpl), { calls: 5, now: NOW })
    expect(n).toBe(1)
    expect(gh.calls).toEqual([`https://api.github.com/repos/${REPO}/actions/jobs/11`])
    expect(db.table('ci_jobs')[0]).toMatchObject({ job_id: 11, status: 'completed', conclusion: 'success', ci_kind: 'passed', pr_number: 844, event: 'pull_request' })
  })

  it('closes a job GitHub no longer has instead of asking for it forever', async () => {
    const db = makeFakeDb({
      project_repos: [{ project_id: P1, repo_url: `https://github.com/${REPO}`, github_app_installation_id: null }],
      ci_jobs: [stored(12, 'queued', 60)],
    })
    const gh = jobsApi({ 12: { status: 404 } })
    await settleStaleLiveJobs(db as never, deps(gh.fetchImpl), { calls: 5, now: NOW })
    expect(db.table('ci_jobs')[0]).toMatchObject({ status: 'completed', ci_kind: 'cancelled', infra_detail: expect.stringContaining('no longer has this job') })
  })

  it('leaves recently refreshed and finished jobs alone, and stays inside its budget', async () => {
    const db = makeFakeDb({
      project_repos: [{ project_id: P1, repo_url: `https://github.com/${REPO}`, github_app_installation_id: null }],
      ci_jobs: [
        stored(21, 'in_progress', 3),
        stored(22, 'completed', 600, { conclusion: 'success', ci_kind: 'passed' }),
        stored(23, 'in_progress', 120),
        stored(24, 'in_progress', 90),
        stored(25, 'queued', 60),
      ],
    })
    const gh = jobsApi({ 23: { status: 200, body: finished(23) }, 24: { status: 200, body: finished(24) }, 25: { status: 200, body: finished(25) } })
    await settleStaleLiveJobs(db as never, deps(gh.fetchImpl), { calls: 2, now: NOW })
    // Oldest stale first, two calls: 23 then 24; 21 is fresh, 22 finished, 25 waits for the next tick.
    expect(gh.calls.map((u) => u.split('/').pop())).toEqual(['23', '24'])
    expect(db.table('ci_jobs').find((j) => j.job_id === 25)).toMatchObject({ status: 'queued' })
  })

  it('runs after every collector tick', async () => {
    const db = makeFakeDb({
      project_repos: [{ project_id: P1, repo_url: `https://github.com/${REPO}`, github_app_installation_id: null }],
      ci_jobs: [stored(31, 'in_progress', 600)],
    })
    const base = github({ runs: [] })
    const fetchImpl = async (url: string) => (/\/actions\/jobs\/31$/.test(url) ? new Response(JSON.stringify(finished(31)), { status: 200 }) : base.fetchImpl(url))
    const summary = await runCiCollector(db as never, deps(fetchImpl))
    expect(summary.settled).toBe(1)
    expect(db.table('ci_jobs')[0]).toMatchObject({ status: 'completed' })
  })
})

