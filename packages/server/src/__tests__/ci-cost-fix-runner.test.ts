/**
 * FILE: ci-cost-fix-runner.test.ts
 * PURPOSE: One CI cost "Open fix PR" job (_shared/ci-cost-fix-runner.ts,
 *          ADR 0047) on an in-memory database with GitHub injected:
 *            - opens a DRAFT PR with a `ci:` title, `ci` commit type, the
 *              edited workflow, and a body with the change, the reason, the
 *              advice evidence and the estimated saving;
 *            - stores the workflow's billed minutes for the 14 days before
 *              (GitHub-hosted only, each job rounded up to a minute);
 *            - refused / already applied / no repo / no token / missing file
 *              / no workflow write permission end the job in plain words;
 *            - a job is claimed once; a dead `running` job is reclaimed;
 *            - after the merge, minutes per day since are measured and stored.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  // github.ts reads Deno.env when it loads.
  ;(globalThis as { Deno?: unknown }).Deno ??= { env: { get: () => undefined } }
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))

import {
  costFixPrTitle,
  minutesPerDay,
  refreshCostFixMeasurement,
  runCiCostFixJob,
  savingOf,
  toCostFixView,
  workflowNameOf,
  type CostFixCiJobRow,
  type CostFixDeps,
  type CostFixJobRow,
} from '../../supabase/functions/_shared/ci-cost-fix-runner.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const JOB = '4000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-27T12:00:00Z')
const WORKFLOW = 'name: CI\non:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n'

let db: FakeDb

function jobRow(over: Partial<Row> = {}): Row {
  return {
    id: JOB,
    project_id: P,
    requested_by: null,
    repo: 'acme/app',
    workflow_path: '.github/workflows/ci.yml',
    kind: 'skip_drafts',
    status: 'queued',
    workflow_name: null,
    evidence: 'acme/app/.github/workflows/ci.yml runs on pull_request and never checks the draft flag.',
    month_saving_usd: 4.2,
    summary: null,
    error_code: null,
    error: null,
    pr_url: null,
    pr_number: null,
    branch: null,
    commit_sha: null,
    baseline: null,
    measured: null,
    merged_at: null,
    closed_at: null,
    created_at: '2026-10-27T11:59:00Z',
    started_at: null,
    finished_at: null,
    updated_at: '2026-10-27T11:59:00Z',
    ...over,
  }
}

let jobSeq = 0
function ciJob(over: Partial<CostFixCiJobRow> & { project_id?: string } = {}): Row {
  return {
    job_id: ++jobSeq,
    project_id: P,
    repo: 'acme/app',
    workflow_name: 'CI',
    status: 'completed',
    started_at: '2026-10-20T10:00:10Z',
    gh_created_at: '2026-10-20T10:00:00Z',
    duration_seconds: 125,
    runner_kind: 'github_hosted',
    runner_labels: ['ubuntu-latest'],
    runner_name: 'GitHub Actions 12',
    runner_group_name: 'GitHub Actions',
    ...over,
  }
}

function seed(jobs: Row[] = [jobRow()], ciJobs: Row[] = [], maxRows?: number) {
  db = makeFakeDb({
    ci_cost_fix_jobs: jobs,
    project_repos: [{ project_id: P, repo_url: 'https://github.com/acme/app', is_primary: true, default_branch: 'main', github_app_installation_id: 7 }],
    project_settings: [{ project_id: P, github_repo_url: null }],
    ci_jobs: ciJobs,
  }, maxRows ? { maxRows } : {})
}

const createPr = vi.fn()
function deps(over: Partial<CostFixDeps> = {}): CostFixDeps {
  return {
    now: () => NOW,
    resolveToken: async () => 'gh-token',
    baseBranch: async () => ({ branch: 'main', sha: 'b'.repeat(40) }),
    readFile: async () => ({ kind: 'exists', contents: WORKFLOW }),
    requiredChecks: async () => [],
    createPr,
    fetchPr: async () => null,
    ...over,
  }
}

const row = () => db.tables.ci_cost_fix_jobs[0] as unknown as CostFixJobRow

beforeEach(() => {
  createPr.mockReset()
  createPr.mockResolvedValue({ url: 'https://github.com/acme/app/pull/42', number: 42, branch: 'mushi/ci-cost-skip-drafts-x', commitSha: 'c'.repeat(40) })
})

describe('runCiCostFixJob', () => {
  it('opens a draft PR with a ci: title and commit type, and stores the 14-day baseline', async () => {
    seed([jobRow()], [
      ciJob(),
      ciJob({ gh_created_at: '2026-10-21T08:00:00Z', duration_seconds: 59 }),
      // Self-hosted bills nothing; another workflow and another repo do not count.
      ciJob({ runner_kind: 'self_hosted', runner_labels: ['self-hosted'], runner_name: 'aw-1', runner_group_name: 'Default' }),
      ciJob({ workflow_name: 'Deploy' }),
      ciJob({ repo: 'acme/other' }),
      // Today and older than 14 days are outside the window.
      ciJob({ gh_created_at: '2026-10-27T01:00:00Z' }),
      ciJob({ gh_created_at: '2026-10-12T23:00:00Z' }),
    ])
    const res = await runCiCostFixJob(db as never, JOB, deps())
    expect(res).toEqual({ ok: true, status: 'pr_opened', prUrl: 'https://github.com/acme/app/pull/42' })
    const opts = createPr.mock.calls[0][0]
    expect(opts).toMatchObject({
      owner: 'acme',
      repo: 'app',
      defaultBranch: 'main',
      baseSha: 'b'.repeat(40),
      title: 'ci: skip drafts in ci.yml to save Actions minutes',
      category: 'ci',
      markReady: false,
      labels: ['mushi-ci-cost'],
    })
    expect(opts.branch).toMatch(/^mushi\/ci-cost-skip-drafts-2026-10-27-/)
    expect(opts.files).toHaveLength(1)
    expect(opts.files[0].path).toBe('.github/workflows/ci.yml')
    expect(opts.files[0].contents).toContain('ready_for_review')
    expect(opts.files[0].reason).toBe('skip drafts in ci.yml to save Actions minutes')
    expect(opts.body).toContain('### What changed')
    expect(opts.body).toContain('never checks the draft flag')
    expect(opts.body).toContain('about $4.20 a month')
    expect(opts.body).toContain('about 4 billed minutes')
    expect(opts.body).toContain('This is a draft')

    const r = row()
    expect(r).toMatchObject({ status: 'pr_opened', pr_url: 'https://github.com/acme/app/pull/42', pr_number: 42, workflow_name: 'CI', error_code: null })
    expect(r.baseline).toMatchObject({ days: 14, minutes: 4, jobs: 2, complete: true, from: '2026-10-13T00:00:00.000Z', to: '2026-10-27T00:00:00.000Z' })
    expect(r.baseline!.perDay.find((d) => d.day === '2026-10-20')).toEqual({ day: '2026-10-20', minutes: 3, usd: 0.018, jobs: 1 })
    expect(r.finished_at).toBe(NOW.toISOString())
  })

  it('reads every job page by page when the server caps rows per request (Supabase max_rows)', async () => {
    const five = [1, 2, 3, 4, 5].map((d) => ciJob({ gh_created_at: `2026-10-1${d + 3}T10:00:00Z`, duration_seconds: 60 }))
    seed([jobRow()], five, 3)
    await runCiCostFixJob(db as never, JOB, deps())
    expect(row().baseline).toMatchObject({ minutes: 5, jobs: 5 })
  })

  it('a refused edit and an edit already made end without a PR, in plain words', async () => {
    seed([jobRow({ kind: 'weekly_cron' })])
    expect(await runCiCostFixJob(db as never, JOB, deps())).toMatchObject({ ok: true, status: 'refused' })
    expect(row()).toMatchObject({ status: 'refused', error_code: 'TRANSFORM_REFUSED' })
    expect(row().error).toMatch(/no schedule/)

    seed([jobRow({ kind: 'add_concurrency' })])
    const res = await runCiCostFixJob(db as never, JOB, deps({ readFile: async () => ({ kind: 'exists', contents: `${WORKFLOW}concurrency: x\n` }) }))
    expect(res).toMatchObject({ ok: true, status: 'no_change' })
    expect(row().summary).toMatch(/^Already applied: /)
    expect(createPr).not.toHaveBeenCalled()
  })

  it('reads the required checks only for the docs filter, and refuses when the workflow backs one', async () => {
    seed([jobRow({ kind: 'ignore_docs_paths' })])
    const required = vi.fn(async () => ['test'])
    await runCiCostFixJob(db as never, JOB, deps({ requiredChecks: required }))
    expect(required).toHaveBeenCalledWith('gh-token', { owner: 'acme', repo: 'app' }, 'main')
    expect(row()).toMatchObject({ status: 'refused' })
    expect(row().error).toMatch(/`test` is a required check/)

    seed([jobRow()])
    const notAsked = vi.fn(async () => [])
    await runCiCostFixJob(db as never, JOB, deps({ requiredChecks: notAsked }))
    expect(notAsked).not.toHaveBeenCalled()
  })

  it('fails in plain words: repo gone, no token, workflow missing, no workflow write access, GitHub error', async () => {
    const cases: Array<[Partial<CostFixDeps>, Row, string]> = [
      [{}, jobRow({ repo: 'acme/elsewhere' }), 'NO_REPO'],
      [{ resolveToken: async () => null }, jobRow(), 'GITHUB_NOT_CONNECTED'],
      [{ readFile: async () => ({ kind: 'absent' }) }, jobRow(), 'WORKFLOW_NOT_FOUND'],
      [{ readFile: async () => ({ kind: 'unreadable', detail: 'x' }) }, jobRow(), 'WORKFLOW_UNREADABLE'],
      [{ createPr: async () => { throw new Error('GitHub PUT https://api.github.com/repos/acme/app/contents/x → 403: refusing to allow a GitHub App to create or update workflow') } }, jobRow(), 'GITHUB_WORKFLOWS_WRITE_MISSING'],
      [{ createPr: async () => { throw new Error('GitHub POST x → 502: bad gateway') } }, jobRow(), 'GITHUB_ERROR'],
    ]
    for (const [over, job, code] of cases) {
      seed([job])
      const res = await runCiCostFixJob(db as never, JOB, deps(over))
      expect(res, code).toMatchObject({ ok: false, status: 'failed', code })
      expect(row()).toMatchObject({ status: 'failed', error_code: code })
      expect(row().error).not.toMatch(/→|https?:/)
    }
  })

  it('claims a job once; reclaims one a dead run left running', async () => {
    seed([jobRow({ status: 'running', started_at: '2026-10-27T11:58:00Z' })])
    expect(await runCiCostFixJob(db as never, JOB, deps())).toMatchObject({ ok: false, status: 'skipped' })
    expect(createPr).not.toHaveBeenCalled()
    seed([jobRow({ status: 'running', started_at: '2026-10-27T11:00:00Z' })])
    expect(await runCiCostFixJob(db as never, JOB, deps())).toMatchObject({ ok: true, status: 'pr_opened' })
    seed([jobRow({ status: 'pr_opened' })])
    expect(await runCiCostFixJob(db as never, JOB, deps())).toMatchObject({ ok: false, status: 'skipped' })
  })
})

describe('refreshCostFixMeasurement', () => {
  const opened = () =>
    jobRow({
      status: 'pr_opened',
      pr_number: 42,
      pr_url: 'https://github.com/acme/app/pull/42',
      workflow_name: 'CI',
      baseline: { from: 'a', to: 'b', days: 14, complete: true, minutes: 140, usd: 0.84, jobs: 70, perDay: [] },
    })

  it('notices the merge, then stores minutes per whole day since (not complete before 14 days)', async () => {
    seed([opened()], [
      ciJob({ gh_created_at: '2026-10-25T10:00:00Z', duration_seconds: 60 }),
      ciJob({ gh_created_at: '2026-10-26T10:00:00Z', duration_seconds: 60 }),
      // The merge day itself is not measured.
      ciJob({ gh_created_at: '2026-10-24T18:00:00Z', duration_seconds: 600 }),
    ])
    const out = await refreshCostFixMeasurement(db as never, row(), deps({ fetchPr: async () => ({ number: 42, draft: false, state: 'closed', merged: true, mergedAt: '2026-10-24T09:00:00Z' }) }))
    expect(out.merged_at).toBe('2026-10-24T09:00:00Z')
    expect(out.measured).toMatchObject({ days: 2, minutes: 2, complete: false })
    expect(row().measured).toMatchObject({ days: 2, minutes: 2 })
    expect(savingOf(out.baseline, out.measured)).toEqual({ minutesPerDay: 9, usdPerMonth: 1.62, measuredDays: 2 })
    expect(toCostFixView(out).saving).toEqual({ minutesPerDay: 9, usdPerMonth: 1.62, measuredDays: 2 })
  })

  it('records a PR closed without merging, and leaves a complete measurement alone', async () => {
    seed([opened()])
    const closed = await refreshCostFixMeasurement(db as never, row(), deps({ fetchPr: async () => ({ number: 42, draft: false, state: 'closed', merged: false, closedAt: '2026-10-26T00:00:00Z' }) }))
    expect(closed.closed_at).toBe('2026-10-26T00:00:00Z')
    expect(closed.measured).toBeNull()

    const fetchPr = vi.fn()
    const done = { ...(opened() as unknown as CostFixJobRow), merged_at: '2026-10-01T00:00:00Z', measured: { from: 'a', to: 'b', days: 14, complete: true, minutes: 1, usd: 0, jobs: 1, perDay: [] } }
    expect(await refreshCostFixMeasurement(db as never, done, deps({ fetchPr }))).toBe(done)
    expect(fetchPr).not.toHaveBeenCalled()
  })

  it('caps the measurement at 14 days after the merge and marks it complete', async () => {
    seed([opened()])
    const out = await refreshCostFixMeasurement(db as never, { ...row(), merged_at: '2026-10-01T09:00:00Z' }, deps())
    expect(out.measured).toMatchObject({ days: 14, complete: true, from: '2026-10-02T00:00:00.000Z', to: '2026-10-16T00:00:00.000Z' })
  })
})

describe('pure helpers', () => {
  it('names the workflow as GitHub does, and titles each kind', () => {
    expect(workflowNameOf('name: Lint and test\non: push\n', '.github/workflows/ci.yml')).toBe('Lint and test')
    expect(workflowNameOf('on: push\n', '.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml')
    expect(workflowNameOf('on: [', '.github/workflows/x.yml')).toBe('.github/workflows/x.yml')
    expect(costFixPrTitle('add_concurrency', '.github/workflows/ci.yml')).toBe('ci: cancel superseded runs in ci.yml to save Actions minutes')
    expect(costFixPrTitle('weekly_cron', '.github/workflows/nightly.yaml')).toBe('ci: run the schedule weekly in nightly.yaml to save Actions minutes')
    expect(costFixPrTitle('ignore_docs_paths', '.github/workflows/ci.yml')).toBe('ci: skip docs-only changes in ci.yml to save Actions minutes')
  })

  it('minutesPerDay fills every day, rounds each job up, prices macOS higher, skips jobs that never ran', () => {
    const rows = [
      ciJob({ duration_seconds: 1 }),
      ciJob({ duration_seconds: 61, runner_labels: ['macos-15'], runner_name: 'GitHub Actions 3' }),
      ciJob({ started_at: null }),
      ciJob({ status: 'in_progress' }),
    ] as unknown as CostFixCiJobRow[]
    const s = minutesPerDay(rows, new Date('2026-10-19T00:00:00Z'), new Date('2026-10-22T00:00:00Z'), true)
    expect(s.perDay.map((d) => d.day)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21'])
    expect(s.perDay[1]).toEqual({ day: '2026-10-20', minutes: 3, usd: 0.13, jobs: 2 })
    expect(s).toMatchObject({ minutes: 3, jobs: 2, days: 3 })
    expect(savingOf(null, s)).toBeNull()
  })
})
