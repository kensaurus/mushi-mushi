/**
 * FILE: ci-cost-rules.test.ts
 * PURPOSE: The cost rules that read workflow YAML with the billed minutes
 *          Mushi recorded (_shared/ci-cost-rules.ts, through adviseCiCost).
 *          Every rule fires on its evidence, prices its saving from billed
 *          minutes at list price (0 on a public repo), carries an autofix
 *          only where marked, and stays silent without its data:
 *            cron_too_frequent, missing_path_filter, push_reruns_pr_checks,
 *            duplicate_gate, no_affected_only, abandoned_pr_minutes,
 *            macos_on_pr.
 *          Also: cronRunsPerWeek, the autofix on no_cancel_in_progress and
 *          drafts_not_skipped (adviseCi), and aggregateCostFacts, the
 *          TypeScript mirror of the SQL function ci_cost_facts.
 */

import { describe, expect, it } from 'vitest'
import { adviseCi, adviseCiCost, type CostAdvisorInput } from '../../supabase/functions/_shared/ci-advisor.ts'
import { cronRunsPerWeek } from '../../supabase/functions/_shared/ci-cost-rules.ts'
import { aggregateCostFacts, readCostFacts, type CostFactEvent, type CostFactJobRow, type CostFacts } from '../../supabase/functions/_shared/ci-cost-facts.ts'

const NOW = new Date('2026-10-27T09:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const REPO = 'acme/app'

const ev = (over: Partial<CostFactEvent>): CostFactEvent => ({
  project_id: P1,
  repo: REPO,
  workflow_name: 'CI',
  job_name: 'test',
  event: 'pull_request',
  branch_kind: 'other',
  runner_class: 'github_hosted',
  os: 'linux',
  jobs: 10,
  runs: 10,
  billed_minutes: 100,
  ...over,
})

const facts = (over: Partial<CostFacts> = {}): CostFacts => ({ events: [], prs: [], steps: [], jobs: 0, ...over })

function input(over: Partial<CostAdvisorInput> = {}): CostAdvisorInput {
  return {
    now: NOW,
    spanDays: 30,
    repos: [{ projectId: P1, repo: REPO, visibility: 'private' }],
    rows: [],
    machines: [],
    workflows: [],
    variableNames: {},
    parsed: new Map(),
    pinned: [],
    tinyJobs: [],
    facts: facts(),
    pullRequests: [],
    ...over,
  }
}

const wf = (path: string, text: string) => ({ projectId: P1, repo: REPO, path, text })
const byRule = (advice: ReturnType<typeof adviseCiCost>, rule: string) => advice.filter((a) => a.id.startsWith(`${rule}:`))

describe('cronRunsPerWeek', () => {
  it('counts runs a week for the forms GitHub accepts, and gives up on what it cannot read', () => {
    expect(cronRunsPerWeek('*/30 * * * *')).toBe(336)
    expect(cronRunsPerWeek('0 3 * * *')).toBe(7)
    expect(cronRunsPerWeek('17 3 * * 1')).toBe(1)
    expect(cronRunsPerWeek('0 9 * * MON-FRI')).toBe(5)
    expect(cronRunsPerWeek('0 0,12 * * 0,7')).toBe(2)
    expect(cronRunsPerWeek('0 4 1 * *')).toBeCloseTo(0.23, 2)
    expect(cronRunsPerWeek('0 4 1 6 *')).toBeNull()
    expect(cronRunsPerWeek('@daily')).toBeNull()
    expect(cronRunsPerWeek('0 25 * * *')).toBeNull()
  })
})

describe('cron_too_frequent', () => {
  const yaml = "name: Freshness\non:\n  schedule:\n    - cron: '0 * * * *'\n  workflow_dispatch:\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node check.mjs\n"

  it('fires on a schedule more often than weekly, prices the runs a weekly schedule drops, and offers weekly_cron', () => {
    const advice = adviseCiCost(input({ workflows: [wf('.github/workflows/fresh.yml', yaml)], facts: facts({ events: [ev({ workflow_name: 'Freshness', job_name: 'check', event: 'schedule', runs: 600, billed_minutes: 600 })] }) }))
    const [a] = byRule(advice, 'cron_too_frequent')
    expect(a.title).toBe('.github/workflows/fresh.yml runs on a schedule 168 times a week')
    expect(a.evidence).toContain('Mushi recorded 600 scheduled runs that billed 600 min in 30 days')
    // 600 min × $0.006, keeping 30/7 ≈ 4.3 of 600 runs.
    expect(a.monthSavingUsd).toBeCloseTo(3.57, 2)
    expect(a.autofix).toEqual({ kind: 'weekly_cron', projectId: P1, repo: REPO, workflowPath: '.github/workflows/fresh.yml' })
  })

  it('stays silent for a weekly schedule, without recorded runs, or with an unreadable cron; saves 0 on a public repo', () => {
    const weekly = yaml.replace("'0 * * * *'", "'17 3 * * 1'")
    const sched = facts({ events: [ev({ workflow_name: 'Freshness', job_name: 'check', event: 'schedule', runs: 4, billed_minutes: 8 })] })
    expect(byRule(adviseCiCost(input({ workflows: [wf('f.yml', weekly)], facts: sched })), 'cron_too_frequent')).toEqual([])
    expect(byRule(adviseCiCost(input({ workflows: [wf('f.yml', yaml)], facts: facts() })), 'cron_too_frequent')).toEqual([])
    expect(byRule(adviseCiCost(input({ workflows: [wf('f.yml', yaml)], facts: null })), 'cron_too_frequent')).toEqual([])
    expect(byRule(adviseCiCost(input({ workflows: [wf('f.yml', yaml.replace("'0 * * * *'", "'0 4 1 6 *'"))], facts: sched })), 'cron_too_frequent')).toEqual([])
    const pub = adviseCiCost(input({ repos: [{ projectId: P1, repo: REPO, visibility: 'public' }], workflows: [wf('f.yml', yaml)], facts: sched }))
    expect(byRule(pub, 'cron_too_frequent')[0].monthSavingUsd).toBe(0)
  })
})

describe('missing_path_filter', () => {
  const yaml = 'name: CI\non:\n  pull_request:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n'
  const pr = (number: number, docsOnly: boolean | null) => ({ repo: REPO, number, merged: true, state: 'closed', closedAt: '2026-10-20T00:00:00Z', headRef: 'x', docsOnly })
  const prFacts = facts({
    prs: [
      { project_id: P1, repo: REPO, pr_number: 1, workflow_name: 'CI', runner_class: 'github_hosted', os: 'linux', jobs: 2, billed_minutes: 50 },
      { project_id: P1, repo: REPO, pr_number: 2, workflow_name: 'CI', runner_class: 'github_hosted', os: 'linux', jobs: 2, billed_minutes: 50 },
      { project_id: P1, repo: REPO, pr_number: 3, workflow_name: 'CI', runner_class: 'github_hosted', os: 'linux', jobs: 2, billed_minutes: 50 },
    ],
  })

  it('fires when docs-only pull requests ran the workflow, prices their minutes, and offers ignore_docs_paths', () => {
    const [a] = byRule(adviseCiCost(input({ workflows: [wf('ci.yml', yaml)], facts: prFacts, pullRequests: [pr(1, true), pr(2, false), pr(3, null)] })), 'missing_path_filter')
    expect(a.evidence).toContain('1 of the 2 pull requests Mushi checked that ran ci.yml in 30 days changed only documentation (#1); they billed 50 min.')
    expect(a.monthSavingUsd).toBe(0.3)
    expect(a.autofix).toMatchObject({ kind: 'ignore_docs_paths', workflowPath: 'ci.yml' })
  })

  it('offers no autofix when push already filters paths (GitHub refuses both on one event)', () => {
    const withPush = yaml.replace('on:\n', "on:\n  push:\n    paths: ['src/**']\n")
    const [a] = byRule(adviseCiCost(input({ workflows: [wf('ci.yml', withPush)], facts: prFacts, pullRequests: [pr(1, true)] })), 'missing_path_filter')
    expect(a.autofix).toBeNull()
  })

  it('stays silent with a paths filter, without docs-only pull requests, or without pull request states', () => {
    const filtered = yaml.replace('    branches: [main]\n', "    paths-ignore: ['**/*.md']\n")
    expect(byRule(adviseCiCost(input({ workflows: [wf('ci.yml', filtered)], facts: prFacts, pullRequests: [pr(1, true)] })), 'missing_path_filter')).toEqual([])
    expect(byRule(adviseCiCost(input({ workflows: [wf('ci.yml', yaml)], facts: prFacts, pullRequests: [pr(1, false)] })), 'missing_path_filter')).toEqual([])
    expect(byRule(adviseCiCost(input({ workflows: [wf('ci.yml', yaml)], facts: prFacts, pullRequests: null })), 'missing_path_filter')).toEqual([])
  })
})

describe('push_reruns_pr_checks', () => {
  it('fires when jobs that ran on pull requests ran again on push to the default branch, without an autofix', () => {
    const f = facts({ events: [ev({}), ev({ event: 'push', branch_kind: 'default', billed_minutes: 200 }), ev({ job_name: 'deploy', event: 'push', branch_kind: 'default', billed_minutes: 30 })] })
    const [a] = byRule(adviseCiCost(input({ facts: f })), 'push_reruns_pr_checks')
    expect(a.evidence).toContain('test ran on pull requests and again on push to the default branch: 200 min')
    expect(a.evidence).not.toContain('deploy')
    expect(a.monthSavingUsd).toBe(1.2)
    expect(a.autofix).toBeNull()
    expect(a.fix).toContain('merge_group')
  })

  it('stays silent when the default-branch jobs never ran on a pull request', () => {
    const f = facts({ events: [ev({ event: 'push', branch_kind: 'default' }), ev({ job_name: 'lint' })] })
    expect(byRule(adviseCiCost(input({ facts: f })), 'push_reruns_pr_checks')).toEqual([])
  })
})

describe('duplicate_gate', () => {
  const a = 'name: CI\non: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm install\n      - run: pnpm typecheck\n'
  const b = 'name: Lint\non:\n  pull_request:\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm install\n      - name: Types\n        run: pnpm   typecheck\n'

  it('fires on the same command in two jobs on one event, priced from the cheaper copy\'s step times', () => {
    const f = facts({
      steps: [
        { project_id: P1, repo: REPO, workflow_name: 'CI', job_name: 'test', os: 'linux', step_name: 'Run pnpm typecheck', runs: 20, seconds: 3000 },
        { project_id: P1, repo: REPO, workflow_name: 'Lint', job_name: 'lint', os: 'linux', step_name: 'Types', runs: 20, seconds: 1200 },
      ],
    })
    const [d] = byRule(adviseCiCost(input({ workflows: [wf('ci.yml', a), wf('lint.yml', b)], facts: f })), 'duplicate_gate')
    expect(d.title).toBe('The same check runs twice on pull_request')
    expect(d.evidence).toContain('`pnpm typecheck` runs in ci.yml · test and lint.yml · lint')
    expect(d.monthSavingUsd).toBe(0.12)
    expect(d.autofix).toBeNull()
  })

  it('leaves the saving unpriced without step times, and stays silent on install steps or different events', () => {
    const [d] = byRule(adviseCiCost(input({ workflows: [wf('ci.yml', a), wf('lint.yml', b)] })), 'duplicate_gate')
    expect(d.monthSavingUsd).toBeNull()
    expect(d.evidence).toContain('not priced')
    const onPush = b.replace('  pull_request:\n', '  push:\n')
    expect(byRule(adviseCiCost(input({ workflows: [wf('ci.yml', a), wf('lint.yml', onPush)] })), 'duplicate_gate')).toEqual([])
    const onlyInstall = b.replace('      - name: Types\n        run: pnpm   typecheck\n', '')
    expect(byRule(adviseCiCost(input({ workflows: [wf('ci.yml', a), wf('lint.yml', onlyInstall)] })), 'duplicate_gate')).toEqual([])
  })
})

describe('no_affected_only', () => {
  const yaml = 'name: CI\non: [pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm turbo run build test\n'

  it('fires on turbo over every package on pull requests, with the minutes at stake and no priced saving', () => {
    const [a] = byRule(adviseCiCost(input({ workflows: [wf('ci.yml', yaml)], facts: facts({ events: [ev({ job_name: 'build', billed_minutes: 500 })] }) })), 'no_affected_only')
    expect(a.evidence).toContain('500 min in 30 days ($3.00 a month at list price)')
    expect(a.monthSavingUsd).toBeNull()
    expect(a.fix).toContain('--affected')
    expect(a.autofix).toBeNull()
  })

  it('stays silent with --affected or --filter, with nx affected, or without pull request minutes', () => {
    const f = facts({ events: [ev({ job_name: 'build' })] })
    expect(byRule(adviseCiCost(input({ workflows: [wf('ci.yml', yaml.replace('build test', 'build test --affected'))], facts: f })), 'no_affected_only')).toEqual([])
    expect(byRule(adviseCiCost(input({ workflows: [wf('ci.yml', yaml.replace('build test', 'build --filter=web'))], facts: f })), 'no_affected_only')).toEqual([])
    expect(byRule(adviseCiCost(input({ workflows: [wf('ci.yml', yaml.replace('pnpm turbo run build test', 'npx nx affected -t test'))], facts: f })), 'no_affected_only')).toEqual([])
    expect(byRule(adviseCiCost(input({ workflows: [wf('ci.yml', yaml)], facts: facts() })), 'no_affected_only')).toEqual([])
  })
})

describe('abandoned_pr_minutes', () => {
  const pr = (number: number, merged: boolean, headRef: string, closedAt = '2026-10-20T00:00:00Z') => ({ repo: REPO, number, merged, state: 'closed', closedAt, headRef, docsOnly: null })
  const row = (pr_number: number, billed_minutes: number) => ({ project_id: P1, repo: REPO, pr_number, workflow_name: 'CI', runner_class: 'github_hosted' as const, os: 'linux' as const, jobs: 3, billed_minutes })

  it('fires on minutes billed to pull requests closed without merging, naming the agent share', () => {
    const f = facts({ prs: [row(1, 40), row(2, 60), row(3, 500)] })
    const [a] = byRule(adviseCiCost(input({ facts: f, pullRequests: [pr(1, false, 'cursor/mushi-fix-1'), pr(2, false, 'feature/x'), pr(3, true, 'feature/y')] })), 'abandoned_pr_minutes')
    expect(a.title).toBe('Pull requests nobody merged billed 100 min on acme/app')
    expect(a.evidence).toContain('2 pull requests closed without merging in 30 days billed 100 min, 40 min of it on Mushi agent branches (#1, #2')
    expect(a.monthSavingUsd).toBe(0.6)
    expect(a.autofix).toBeNull()
  })

  it('stays silent for merged, old or unread pull requests, and under 10 minutes', () => {
    const f = facts({ prs: [row(1, 40), row(2, 5)] })
    expect(byRule(adviseCiCost(input({ facts: f, pullRequests: [pr(1, true, 'x')] })), 'abandoned_pr_minutes')).toEqual([])
    expect(byRule(adviseCiCost(input({ facts: f, pullRequests: [pr(1, false, 'x', '2026-08-01T00:00:00Z')] })), 'abandoned_pr_minutes')).toEqual([])
    expect(byRule(adviseCiCost(input({ facts: f, pullRequests: [pr(2, false, 'x')] })), 'abandoned_pr_minutes')).toEqual([])
    expect(byRule(adviseCiCost(input({ facts: f, pullRequests: null })), 'abandoned_pr_minutes')).toEqual([])
  })
})

describe('macos_on_pr', () => {
  it('fires on GitHub-hosted macOS jobs on pull requests, priced at the macOS rate', () => {
    const f = facts({ events: [ev({ workflow_name: 'iOS', job_name: 'build-ios', os: 'macos', billed_minutes: 400 }), ev({})] })
    const [a] = byRule(adviseCiCost(input({ facts: f })), 'macos_on_pr')
    expect(a.title).toBe('iOS runs macOS jobs on pull requests')
    expect(a.monthSavingUsd).toBe(24.8)
    expect(a.severity).toBe('high')
  })

  it('stays silent for macOS on release pushes or self-hosted Macs', () => {
    const f = facts({ events: [ev({ os: 'macos', event: 'push', branch_kind: 'default' }), ev({ os: 'macos', runner_class: 'self_hosted' })] })
    expect(byRule(adviseCiCost(input({ facts: f })), 'macos_on_pr')).toEqual([])
  })
})

describe('autofix on the workflow rules of adviseCi', () => {
  const base = { now: NOW, jobs: [], runners: [], hosts: [], samples: [], repoWatchedSince: {} }

  it('offers add_concurrency without a group and skip_drafts on pull_request, only when the project is known', () => {
    const yaml = 'on:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n'
    const advice = adviseCi({ ...base, workflows: [{ projectId: P1, repo: REPO, path: 'ci.yml', text: yaml }] })
    expect(advice.find((a) => a.id.startsWith('no_cancel_in_progress:'))?.autofix).toEqual({ kind: 'add_concurrency', projectId: P1, repo: REPO, workflowPath: 'ci.yml' })
    expect(advice.find((a) => a.id.startsWith('drafts_not_skipped:'))?.autofix).toEqual({ kind: 'skip_drafts', projectId: P1, repo: REPO, workflowPath: 'ci.yml' })
    const anon = adviseCi({ ...base, workflows: [{ repo: REPO, path: 'ci.yml', text: yaml }] })
    expect(anon.every((a) => !a.autofix)).toBe(true)
  })

  it('leaves a concurrency group without cancel-in-progress, and pull_request_target, to a person', () => {
    const yaml = 'on:\n  pull_request_target:\nconcurrency:\n  group: ci\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n'
    const advice = adviseCi({ ...base, workflows: [{ projectId: P1, repo: REPO, path: 'ci.yml', text: yaml }] })
    expect(advice.find((a) => a.id.startsWith('no_cancel_in_progress:'))?.autofix).toBeNull()
    expect(advice.find((a) => a.id.startsWith('drafts_not_skipped:'))?.autofix).toBeNull()
  })
})

describe('aggregateCostFacts (the mirror of ci_cost_facts)', () => {
  const job = (over: Partial<CostFactJobRow>): CostFactJobRow => ({
    project_id: P1,
    repo: REPO,
    workflow_name: 'CI',
    job_name: 'test',
    event: 'pull_request',
    head_branch: 'feature/x',
    pr_number: 4,
    run_id: 1,
    status: 'completed',
    started_at: '2026-10-26T00:00:00Z',
    duration_seconds: 61,
    runner_kind: 'github_hosted',
    runner_labels: ['ubuntu-latest'],
    runner_name: 'GitHub Actions 2',
    runner_group_name: 'GitHub Actions',
    steps: [{ name: 'Run pnpm test', seconds: 50 }],
    gh_created_at: '2026-10-26T00:00:00Z',
    ...over,
  })

  it('groups billed minutes by event and branch kind, per pull request and per hosted step', () => {
    const f = aggregateCostFacts([
      job({}),
      job({ run_id: 2, head_branch: 'cursor/mushi-fix-9', pr_number: 5 }),
      job({ run_id: 3, event: 'push', head_branch: 'main', pr_number: null }),
      job({ run_id: 4, status: 'in_progress', duration_seconds: null, started_at: null }),
      job({ run_id: 5, runner_kind: 'self_hosted', runner_labels: ['self-hosted'], runner_group_name: 'Default', steps: [{ name: 'Run pnpm test', seconds: 30 }] }),
      job({ run_id: 6, gh_created_at: '2026-01-01T00:00:00Z' }),
    ], { from: new Date('2026-10-01T00:00:00Z'), to: NOW })
    expect(f.jobs).toBe(5)
    const other = f.events.find((e) => e.event === 'pull_request' && e.branch_kind === 'other' && e.runner_class === 'github_hosted')!
    expect(other).toMatchObject({ jobs: 2, runs: 2, billed_minutes: 2 })
    expect(f.events.find((e) => e.branch_kind === 'agent')).toMatchObject({ billed_minutes: 2, runs: 1 })
    expect(f.events.find((e) => e.event === 'push')).toMatchObject({ branch_kind: 'default', billed_minutes: 2 })
    expect(f.prs.find((p) => p.pr_number === 4 && p.runner_class === 'github_hosted')).toMatchObject({ billed_minutes: 2, jobs: 1 })
    expect(f.steps).toEqual([expect.objectContaining({ step_name: 'Run pnpm test', runs: 4, seconds: 200 })])
  })

  it('reads the SQL function jsonb defensively', () => {
    expect(readCostFacts(null)).toBeNull()
    expect(readCostFacts({ events: [{ repo: REPO, billed_minutes: '12', runner_class: 'x', os: 'macos', branch_kind: 'agent' }], prs: [{ pr_number: 0 }], jobs: '3' })).toEqual({
      events: [{ project_id: '', repo: REPO, workflow_name: '', job_name: '', event: '', branch_kind: 'agent', runner_class: 'unknown', os: 'macos', jobs: 0, runs: 0, billed_minutes: 12 }],
      prs: [],
      steps: [],
      jobs: 3,
    })
  })
})
