/**
 * FILE: ci-cost-fix-bundle.test.ts
 * PURPOSE: Several CI cost fixes for one repo in ONE draft PR
 *          (_shared/ci-cost-fix-bundle.ts, ADR 0047 amendment 2026-10-27) on
 *          an in-memory database with GitHub injected:
 *            - one PR, one `ci:` title, one version of each file with every
 *              kind applied in turn, a body listing each change and each
 *              refusal, the 14-day minutes once per workflow;
 *            - two kinds on one file share one measurement (never counted
 *              twice); the other row says so;
 *            - a refused item is listed, never dropped; every item refused or
 *              already applied opens no PR;
 *            - a missing file fails its items only; no workflow write access
 *              fails the changed items, refusals stay refusals;
 *            - claimed once; a reclaim after a lost finish reuses the branch;
 *            - a bundle row is never run on its own;
 *            - after the merge the PR is read once for the whole bundle.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  ;(globalThis as { Deno?: unknown }).Deno ??= { env: { get: () => undefined } }
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))

import {
  bundleStatusOf,
  costFixBundleBranch,
  costFixBundlePrTitle,
  refreshCostFixBundle,
  runCiCostFixBundle,
  toCostFixBundleView,
} from '../../supabase/functions/_shared/ci-cost-fix-bundle.ts'
import { refreshCostFixMeasurement, runCiCostFixJob, type CostFixDeps, type CostFixJobRow } from '../../supabase/functions/_shared/ci-cost-fix-runner.ts'

const P = '1000000a-0000-4000-8000-000000000000'
const BUNDLE = '5000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-27T12:00:00Z')
const CI = 'name: CI\non:\n  pull_request:\n  push:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n'
const NIGHTLY = "name: Nightly\non:\n  schedule:\n    - cron: '0 3 * * *'\njobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm audit\n"
const DEPLOY = 'name: Deploy\non:\n  push:\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx vercel deploy --prod\n'
const FILES: Record<string, string> = {
  '.github/workflows/ci.yml': CI,
  '.github/workflows/nightly.yml': NIGHTLY,
  '.github/workflows/deploy.yml': DEPLOY,
}

let db: FakeDb
let seq = 0
function item(workflow_path: string, kind: string, over: Partial<Row> = {}): Row {
  seq++
  return {
    id: `4000000${seq.toString(16)}-0000-4000-8000-000000000000`,
    project_id: P,
    requested_by: null,
    repo: 'acme/app',
    workflow_path,
    kind,
    status: 'queued',
    workflow_name: null,
    evidence: `${workflow_path} evidence`,
    month_saving_usd: null,
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
    bundle_id: BUNDLE,
    ...over,
  }
}

function ciJob(workflow_name: string, gh_created_at = '2026-10-20T10:00:00Z'): Row {
  return {
    job_id: ++seq,
    project_id: P,
    repo: 'acme/app',
    workflow_name,
    status: 'completed',
    started_at: gh_created_at,
    gh_created_at,
    duration_seconds: 120,
    runner_kind: 'github_hosted',
    runner_labels: ['ubuntu-latest'],
    runner_name: 'GitHub Actions 1',
    runner_group_name: 'GitHub Actions',
  }
}

function seed(jobs: Row[], ciJobs: Row[] = []) {
  db = makeFakeDb({
    ci_cost_fix_jobs: jobs,
    project_repos: [{ project_id: P, repo_url: 'https://github.com/acme/app', is_primary: true, default_branch: 'main', github_app_installation_id: 7 }],
    project_settings: [{ project_id: P, github_repo_url: null }],
    ci_jobs: ciJobs,
  })
}

const createPr = vi.fn()
function deps(over: Partial<CostFixDeps> = {}): CostFixDeps {
  return {
    now: () => NOW,
    resolveToken: async () => 'gh-token',
    baseBranch: async () => ({ branch: 'main', sha: 'b'.repeat(40) }),
    readFile: async (_t, _r, _b, path) => (FILES[path] ? { kind: 'exists', contents: FILES[path] } : { kind: 'absent' }),
    requiredChecks: async () => [],
    createPr,
    fetchPr: async () => null,
    ...over,
  }
}

const rows = () => db.tables.ci_cost_fix_jobs as unknown as CostFixJobRow[]
const byKind = (path: string, kind: string) => rows().find((r) => r.workflow_path === path && r.kind === kind)!

beforeEach(() => {
  seq = 0
  createPr.mockReset()
  createPr.mockImplementation(async (opts: { branch: string }) => ({ url: 'https://github.com/acme/app/pull/77', number: 77, branch: opts.branch, commitSha: 'c'.repeat(40) }))
})

describe('runCiCostFixBundle', () => {
  it('opens ONE draft PR: every kind applied to each file in turn, one ci: title, a body per workflow', async () => {
    seed(
      [
        item('.github/workflows/ci.yml', 'skip_drafts', { month_saving_usd: 3 }),
        item('.github/workflows/ci.yml', 'add_concurrency'),
        item('.github/workflows/nightly.yml', 'weekly_cron', { month_saving_usd: 1.5 }),
      ],
      [ciJob('CI'), ciJob('CI', '2026-10-21T10:00:00Z'), ciJob('Nightly')],
    )
    const res = await runCiCostFixBundle(db as never, BUNDLE, deps())
    expect(res).toMatchObject({ ok: true, status: 'pr_opened', prUrl: 'https://github.com/acme/app/pull/77' })
    expect(createPr).toHaveBeenCalledTimes(1)
    const opts = createPr.mock.calls[0][0]
    expect(opts).toMatchObject({ title: 'ci: 3 fixes in 2 workflows to save Actions minutes', category: 'ci', markReady: false, labels: ['mushi-ci-cost'], branch: costFixBundleBranch(BUNDLE) })
    // One entry per file; ci.yml carries both edits.
    expect(opts.files.map((f: { path: string }) => f.path)).toEqual(['.github/workflows/ci.yml', '.github/workflows/nightly.yml'])
    expect(opts.files[0].contents).toContain('concurrency:')
    expect(opts.files[0].contents).toContain('ready_for_review')
    expect(opts.files[1].contents).toContain("cron: '0 3 * * 1'")
    expect(opts.body).toContain('### `.github/workflows/ci.yml`')
    expect(opts.body).toContain('### `.github/workflows/nightly.yml`')
    expect(opts.body).toContain('**Cancel superseded runs.**')
    expect(opts.body).toContain('**Skip drafts.**')
    expect(opts.body).toContain('about $4.50 a month, plus 1 change Mushi could not price')
    expect(opts.body).toContain('about 4 billed minutes')
    expect(opts.body).not.toContain('### Not changed')

    for (const r of rows()) expect(r).toMatchObject({ status: 'pr_opened', pr_url: 'https://github.com/acme/app/pull/77', pr_number: 77, error_code: null })
    // ci.yml is measured once, on its first kind in order (add_concurrency); skip_drafts says so.
    expect(byKind('.github/workflows/ci.yml', 'add_concurrency').baseline).toMatchObject({ minutes: 4, jobs: 2 })
    expect(byKind('.github/workflows/ci.yml', 'skip_drafts').baseline).toBeNull()
    expect(byKind('.github/workflows/ci.yml', 'skip_drafts').summary).toMatch(/measured once, on that fix/)
    expect(byKind('.github/workflows/nightly.yml', 'weekly_cron').baseline).toMatchObject({ minutes: 2, jobs: 1 })
  })

  it('a refused item is listed in the PR body and the result, never dropped', async () => {
    seed([item('.github/workflows/ci.yml', 'skip_drafts'), item('.github/workflows/deploy.yml', 'add_concurrency')])
    const res = await runCiCostFixBundle(db as never, BUNDLE, deps())
    expect(res.ok && res.status).toBe('pr_opened')
    if (res.ok) expect(res.items.map((i) => i.status).sort()).toEqual(['pr_opened', 'refused'])
    const opts = createPr.mock.calls[0][0]
    expect(opts.title).toBe('ci: skip drafts in ci.yml to save Actions minutes')
    expect(opts.files).toHaveLength(1)
    expect(opts.body).toContain('### Not changed')
    expect(opts.body).toMatch(/deploy\.yml`, cancel superseded runs: This workflow looks like it deploys/)
    expect(byKind('.github/workflows/deploy.yml', 'add_concurrency')).toMatchObject({ status: 'refused', error_code: 'TRANSFORM_REFUSED', pr_url: null })
  })

  it('opens no PR when every item is refused or already applied', async () => {
    seed([item('.github/workflows/deploy.yml', 'add_concurrency'), item('.github/workflows/deploy.yml', 'weekly_cron')])
    const res = await runCiCostFixBundle(db as never, BUNDLE, deps())
    expect(res).toMatchObject({ ok: true, status: 'nothing_opened' })
    expect(createPr).not.toHaveBeenCalled()
    expect(rows().map((r) => r.status)).toEqual(['refused', 'refused'])
    expect(bundleStatusOf(rows())).toBe('nothing_opened')
  })

  it('reads the required checks once for the bundle, and refuses the kinds that need them when they are unknown', async () => {
    const required = vi.fn(async () => null)
    seed([item('.github/workflows/ci.yml', 'skip_drafts'), item('.github/workflows/ci.yml', 'ignore_docs_paths'), item('.github/workflows/ci.yml', 'add_concurrency')])
    await runCiCostFixBundle(db as never, BUNDLE, deps({ requiredChecks: required }))
    expect(required).toHaveBeenCalledTimes(1)
    expect(byKind('.github/workflows/ci.yml', 'skip_drafts').status).toBe('refused')
    expect(byKind('.github/workflows/ci.yml', 'ignore_docs_paths').status).toBe('refused')
    expect(byKind('.github/workflows/ci.yml', 'add_concurrency').status).toBe('pr_opened')
  })

  it('a missing file fails its items only; the rest still open the PR', async () => {
    seed([item('.github/workflows/gone.yml', 'skip_drafts'), item('.github/workflows/ci.yml', 'add_concurrency')])
    const res = await runCiCostFixBundle(db as never, BUNDLE, deps())
    expect(res).toMatchObject({ ok: true, status: 'pr_opened' })
    expect(byKind('.github/workflows/gone.yml', 'skip_drafts')).toMatchObject({ status: 'failed', error_code: 'WORKFLOW_NOT_FOUND' })
    expect(createPr.mock.calls[0][0].body).toMatch(/gone\.yml`, skip drafts: The workflow file is not on the default branch/)
  })

  it('no workflow write access fails the changed items in plain words; refusals stay refusals', async () => {
    seed([item('.github/workflows/ci.yml', 'skip_drafts'), item('.github/workflows/deploy.yml', 'add_concurrency')])
    const res = await runCiCostFixBundle(
      db as never,
      BUNDLE,
      deps({ createPr: async () => { throw new Error('GitHub PUT https://api.github.com/repos/acme/app/contents/x → 403: refusing to allow a GitHub App to create or update workflow') } }),
    )
    expect(res).toMatchObject({ ok: false, status: 'failed', code: 'GITHUB_WORKFLOWS_WRITE_MISSING' })
    expect(byKind('.github/workflows/ci.yml', 'skip_drafts')).toMatchObject({ status: 'failed', error_code: 'GITHUB_WORKFLOWS_WRITE_MISSING' })
    expect(byKind('.github/workflows/ci.yml', 'skip_drafts').error).not.toMatch(/→|https?:/)
    expect(byKind('.github/workflows/deploy.yml', 'add_concurrency').status).toBe('refused')
  })

  it('fails every item when the repo or the token is gone', async () => {
    seed([item('.github/workflows/ci.yml', 'skip_drafts'), item('.github/workflows/ci.yml', 'add_concurrency')])
    expect(await runCiCostFixBundle(db as never, BUNDLE, deps({ resolveToken: async () => null }))).toMatchObject({ ok: false, code: 'GITHUB_NOT_CONNECTED' })
    expect(rows().map((r) => r.error_code)).toEqual(['GITHUB_NOT_CONNECTED', 'GITHUB_NOT_CONNECTED'])
    seed([item('.github/workflows/ci.yml', 'skip_drafts', { repo: 'acme/elsewhere' })])
    expect(await runCiCostFixBundle(db as never, BUNDLE, deps())).toMatchObject({ ok: false, code: 'NO_REPO' })
  })

  it('claims a bundle once; a reclaim after a lost finish pushes to the same branch (no second PR)', async () => {
    seed([item('.github/workflows/ci.yml', 'skip_drafts')])
    await runCiCostFixBundle(db as never, BUNDLE, deps())
    expect(await runCiCostFixBundle(db as never, BUNDLE, deps())).toMatchObject({ ok: false, status: 'skipped' })
    expect(createPr).toHaveBeenCalledTimes(1)
    // The finish write was lost: the row is still `running`, and older than the stale window.
    Object.assign(rows()[0], { status: 'running', started_at: '2026-10-27T11:00:00Z', pr_url: null })
    expect(await runCiCostFixBundle(db as never, BUNDLE, deps())).toMatchObject({ ok: true, status: 'pr_opened' })
    expect(createPr).toHaveBeenCalledTimes(2)
    expect(createPr.mock.calls[1][0].branch).toBe(createPr.mock.calls[0][0].branch)
  })

  it('a lost pr_opened write leaves every changed row running, and the reclaim pushes ALL their edits again', async () => {
    seed([item('.github/workflows/ci.yml', 'skip_drafts'), item('.github/workflows/ci.yml', 'add_concurrency')])
    // The one update that opens the rows fails once (the function died, or the write was lost).
    let failOpen = true
    const flaky = {
      from(table: string) {
        const q = db.from(table)
        const update = q.update.bind(q)
        q.update = (payload: Row) => {
          if (failOpen && payload.status === 'pr_opened') {
            failOpen = false
            return { in: () => ({ eq: async () => ({ data: null, error: { message: 'connection reset' } }) }) } as never
          }
          return update(payload)
        }
        return q
      },
    }
    await runCiCostFixBundle(flaky as never, BUNDLE, deps())
    // Never a mix: neither row says opened while the branch could lose its edit.
    expect(rows().map((r) => r.status)).toEqual(['running', 'running'])
    for (const r of rows()) r.started_at = '2026-10-27T11:00:00Z'
    expect(await runCiCostFixBundle(db as never, BUNDLE, deps())).toMatchObject({ ok: true, status: 'pr_opened' })
    const second = createPr.mock.calls[1][0]
    expect(second.branch).toBe(createPr.mock.calls[0][0].branch)
    // The file pushed again carries both edits, not just one.
    expect(second.files[0].contents).toContain('concurrency:')
    expect(second.files[0].contents).toContain('ready_for_review')
    expect(rows().map((r) => r.status)).toEqual(['pr_opened', 'pr_opened'])
  })

  it('a bundle row is never run on its own (that would open a second PR)', async () => {
    const one = item('.github/workflows/ci.yml', 'skip_drafts')
    seed([one])
    expect(await runCiCostFixJob(db as never, one.id as string, deps())).toMatchObject({ ok: false, status: 'skipped' })
    expect(createPr).not.toHaveBeenCalled()
    expect(rows()[0].status).toBe('queued')
  })
})

describe('after the merge', () => {
  const opened = (kind: string, baseline: unknown) =>
    item('.github/workflows/ci.yml', kind, {
      status: 'pr_opened',
      pr_number: 77,
      pr_url: 'https://github.com/acme/app/pull/77',
      workflow_name: 'CI',
      baseline,
    })
  const BASE = { from: 'a', to: 'b', days: 14, complete: true, minutes: 140, usd: 0.84, jobs: 70, perDay: [] }

  it('reads the PR once for the whole bundle and measures each workflow once', async () => {
    seed([opened('add_concurrency', BASE), opened('skip_drafts', null)], [ciJob('CI', '2026-10-25T10:00:00Z')])
    const fetchPr = vi.fn(async () => ({ number: 77, draft: false, state: 'closed', merged: true, mergedAt: '2026-10-24T09:00:00Z' }))
    const out = await refreshCostFixBundle(db as never, rows(), deps({ fetchPr: fetchPr as never }))
    expect(fetchPr).toHaveBeenCalledTimes(1)
    expect(out.every((r) => r.merged_at === '2026-10-24T09:00:00Z')).toBe(true)
    expect(out[0].measured).toMatchObject({ days: 2, minutes: 2 })
    // The shared row stores no measurement of its own: the saving is never counted twice.
    expect(out[1].measured).toBeNull()
    const view = toCostFixBundleView(BUNDLE, out)
    expect(view).toMatchObject({ status: 'pr_opened', prNumber: 77, repo: 'acme/app' })
    expect(view.items.filter((i) => i.saving != null)).toHaveLength(1)
    expect(view.measuredUsdPerMonth).toBe(view.items[0].saving!.usdPerMonth)
  })

  it('refreshCostFixMeasurement skips a shared bundle row but still notices the merge', async () => {
    seed([opened('skip_drafts', null)], [ciJob('CI', '2026-10-25T10:00:00Z')])
    const out = await refreshCostFixMeasurement(db as never, rows()[0], deps({ fetchPr: async () => ({ number: 77, draft: false, state: 'closed', merged: true, mergedAt: '2026-10-24T09:00:00Z' }) }))
    expect(out.merged_at).toBe('2026-10-24T09:00:00Z')
    expect(out.measured).toBeNull()
  })
})

describe('pure helpers', () => {
  it('titles a bundle by its changes', () => {
    expect(costFixBundlePrTitle([{ kind: 'weekly_cron', workflowPath: '.github/workflows/n.yml' }])).toBe('ci: run the schedule weekly in n.yml to save Actions minutes')
    expect(costFixBundlePrTitle([
      { kind: 'skip_drafts', workflowPath: '.github/workflows/ci.yml' },
      { kind: 'add_concurrency', workflowPath: '.github/workflows/ci.yml' },
    ])).toBe('ci: 2 fixes in ci.yml to save Actions minutes')
    expect(costFixBundleBranch(BUNDLE)).toBe('mushi/ci-cost-bundle-5000000a0000')
  })

  it('derives the bundle state from its rows', () => {
    expect(bundleStatusOf([{ status: 'pr_opened' }, { status: 'running' }])).toBe('running')
    expect(bundleStatusOf([{ status: 'queued' }])).toBe('queued')
    expect(bundleStatusOf([{ status: 'refused' }, { status: 'pr_opened' }])).toBe('pr_opened')
    expect(bundleStatusOf([{ status: 'refused' }, { status: 'failed' }])).toBe('failed')
    expect(bundleStatusOf([{ status: 'refused' }, { status: 'no_change' }])).toBe('nothing_opened')
  })
})
