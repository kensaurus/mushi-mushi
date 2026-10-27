/**
 * FILE: ci-jobs.test.ts
 * PURPOSE: GitHub job → ci_jobs row, the call budget, and the storage rules
 *          (Plan 022): a finished job never goes back to queued, an
 *          annotation-proved infra verdict survives a later read without
 *          annotations, and runners seen in jobs are noted without
 *          overwriting the runner list's rows.
 */

import { describe, expect, it } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  ciGithub,
  ciJobRow,
  collectRunJobs,
  listRepoRunners,
  repoFullName,
  runnerRowsFromList,
  upsertCiJobs,
  type GhJob,
  type GhRun,
} from '../../supabase/functions/_shared/ci-jobs.ts'

const NOW = new Date('2026-10-21T09:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const REPO = 'kensaurus/glot.it'

const RUN: GhRun = {
  id: 9001,
  run_attempt: 1,
  name: 'CI',
  event: 'pull_request',
  status: 'completed',
  conclusion: 'cancelled',
  head_branch: 'MUSHI-abc-cursor-cloud',
  head_sha: 'abc123',
  created_at: '2026-10-21T06:41:10Z',
  updated_at: '2026-10-21T06:58:41Z',
  pull_requests: [{ number: 152 }],
}

const OOM_JOB: GhJob = {
  id: 501,
  run_id: 9001,
  run_attempt: 1,
  name: 'build',
  workflow_name: 'CI',
  status: 'completed',
  conclusion: 'cancelled',
  created_at: '2026-10-21T06:41:12Z',
  started_at: '2026-10-21T06:41:15Z',
  completed_at: '2026-10-21T06:58:40Z',
  runner_id: 31,
  runner_name: 'kensaurus-local-glot-1',
  runner_group_name: 'Default',
  labels: ['self-hosted', 'linux', 'glot'],
  html_url: 'https://github.com/kensaurus/glot.it/actions/runs/9001/job/501',
  check_run_url: 'https://api.github.com/repos/kensaurus/glot.it/check-runs/7001',
  steps: [
    { name: 'Set up job', status: 'completed', conclusion: 'success', started_at: '2026-10-21T06:41:15Z', completed_at: '2026-10-21T06:41:20Z' },
    { name: 'pnpm build', status: 'completed', conclusion: 'cancelled', started_at: '2026-10-21T06:43:02Z', completed_at: '2026-10-21T06:58:40Z' },
  ],
}

const LOST = 'The self-hosted runner: kensaurus-local-glot-1 lost communication with the server.'

function fakeGithub(routes: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    const hit = Object.entries(routes).find(([k]) => url.includes(k))
    const r = hit?.[1] ?? { status: 404, body: { message: 'Not Found' } }
    return new Response(JSON.stringify(r.body), { status: r.status })
  }
  return { calls, fetchImpl }
}

describe('ciJobRow', () => {
  it('maps the OOM-killed glot job with its run, steps and verdict', () => {
    const row = ciJobRow({ projectId: P1, repo: REPO, job: OOM_JOB, run: RUN, annotations: [LOST], source: 'poll', now: NOW })!
    expect(row).toMatchObject({
      project_id: P1,
      repo: REPO,
      run_id: 9001,
      job_id: 501,
      pr_number: 152,
      event: 'pull_request',
      ci_kind: 'runner_lost',
      infra: true,
      runner_kind: 'self_hosted',
      runner_name: 'kensaurus-local-glot-1',
      queue_seconds: 3,
      duration_seconds: 1045,
      started_at: '2026-10-21T06:41:15Z',
    })
    expect(row.steps).toEqual([
      { name: 'Set up job', conclusion: 'success', seconds: 5 },
      { name: 'pnpm build', conclusion: 'cancelled', seconds: 938 },
    ])
  })

  it('drops the started_at GitHub fills on a job no runner took', () => {
    const row = ciJobRow({
      projectId: P1,
      repo: REPO,
      job: { ...OOM_JOB, runner_id: 0, runner_name: null, steps: [], started_at: OOM_JOB.created_at },
      source: 'poll',
      now: NOW,
    })!
    expect(row.started_at).toBeNull()
    expect(row.runner_name).toBeNull()
  })

  it('refuses a job without an id or a creation time', () => {
    expect(ciJobRow({ projectId: P1, repo: REPO, job: { ...OOM_JOB, id: undefined as unknown as number }, source: 'poll', now: NOW })).toBeNull()
    expect(ciJobRow({ projectId: P1, repo: REPO, job: { ...OOM_JOB, created_at: null, started_at: null }, source: 'poll', now: NOW })).toBeNull()
  })
})

describe('repoFullName', () => {
  it('reads URLs and full names', () => {
    expect(repoFullName('https://github.com/kensaurus/glot.it')).toBe('kensaurus/glot.it')
    expect(repoFullName('https://github.com/kensaurus/glot.it.git')).toBe('kensaurus/glot.it')
    expect(repoFullName('kensaurus/glot.it')).toBe('kensaurus/glot.it')
    expect(repoFullName('not a repo')).toBeNull()
  })
})

describe('collectRunJobs', () => {
  it('reads jobs and one annotation, stores the runner_lost verdict and notes the runner', async () => {
    const db = makeFakeDb()
    const { calls, fetchImpl } = fakeGithub({
      '/actions/runs/9001/jobs': { status: 200, body: { jobs: [OOM_JOB] } },
      '/check-runs/7001/annotations': { status: 200, body: [{ title: '', message: LOST }] },
    })
    const gh = ciGithub('t', 10, fetchImpl)
    const out = await collectRunJobs(db as never, gh, { projectId: P1, repo: REPO, runs: [RUN], source: 'poll', now: NOW })
    expect(out.complete).toBe(true)
    expect(calls).toHaveLength(2)
    expect(db.table('ci_jobs')).toHaveLength(1)
    expect(db.table('ci_jobs')[0]).toMatchObject({ ci_kind: 'runner_lost', infra: true })
    expect(db.table('ci_runners')[0]).toMatchObject({ runner_name: 'kensaurus-local-glot-1', source: 'jobs', last_job_at: '2026-10-21T06:41:15Z' })
  })

  it('stops when the budget is spent', async () => {
    const db = makeFakeDb()
    const { calls, fetchImpl } = fakeGithub({ '/jobs': { status: 200, body: { jobs: [] } } })
    const gh = ciGithub('t', 1, fetchImpl)
    const out = await collectRunJobs(db as never, gh, { projectId: P1, repo: REPO, runs: [RUN, { ...RUN, id: 9002 }], source: 'poll', now: NOW })
    expect(calls).toHaveLength(1)
    expect(out.complete).toBe(false)
    expect(gh.budget).toEqual({ remaining: 0, used: 1 })
  })
})

describe('upsertCiJobs', () => {
  const base = () => ciJobRow({ projectId: P1, repo: REPO, job: OOM_JOB, run: RUN, annotations: [LOST], source: 'poll', now: NOW })!

  it('never moves a finished job back to queued', async () => {
    const db = makeFakeDb({ ci_jobs: [base()] })
    const late = ciJobRow({ projectId: P1, repo: REPO, job: { ...OOM_JOB, status: 'queued', conclusion: null }, source: 'webhook', now: NOW })!
    await upsertCiJobs(db as never, [late])
    expect(db.table('ci_jobs')[0]).toMatchObject({ status: 'completed', ci_kind: 'runner_lost' })
  })

  it('keeps an annotation-proved infra verdict when a later read had no annotation', async () => {
    const db = makeFakeDb({ ci_jobs: [base()] })
    const reread = ciJobRow({ projectId: P1, repo: REPO, job: OOM_JOB, run: RUN, annotations: null, source: 'webhook', now: NOW })!
    expect(reread.ci_kind).toBe('cancelled')
    await upsertCiJobs(db as never, [reread])
    expect(db.table('ci_jobs')).toHaveLength(1)
    expect(db.table('ci_jobs')[0]).toMatchObject({ ci_kind: 'runner_lost', infra: true, source: 'webhook' })
  })
})

describe('runner list', () => {
  it('reports missing on 403 and maps runners when allowed', async () => {
    const denied = fakeGithub({ '/actions/runners': { status: 403, body: { message: 'Resource not accessible' } } })
    expect((await listRepoRunners(ciGithub('t', 5, denied.fetchImpl), REPO)).status).toBe('missing')
    const ok = fakeGithub({ '/actions/runners': { status: 200, body: { runners: [{ id: 31, name: 'kensaurus-local-glot-1', os: 'Linux', status: 'online', busy: true, labels: [{ name: 'self-hosted' }, { name: 'glot' }] }] } } })
    const list = await listRepoRunners(ciGithub('t', 5, ok.fetchImpl), REPO)
    expect(runnerRowsFromList(P1, REPO, list.runners, NOW)[0]).toMatchObject({ status: 'online', busy: true, labels: ['self-hosted', 'glot'], source: 'github_api' })
  })
})
