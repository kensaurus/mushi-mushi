/**
 * FILE: pipeline-view.test.ts
 * PURPOSE: The console's pipeline picture (/pipeline): each open item lands in
 *          one stage and one plain-English group, its age is the time it
 *          entered that stage (never `updated_at`), a PR's own red CI wins
 *          over "waiting for the next train", a test machine stop is not a
 *          code failure, and `skipped` is not green.
 */
import { describe, expect, it } from 'vitest'
import {
  buildDispatchers,
  buildPipeline,
  dispatcherGroup,
  withDispatcherGroup,
  failedChecksFromDetail,
  queueDetailKind,
  summarizeTrains,
  type AttemptRow,
  type PipelineInput,
  type QueueRow,
  type ReviewRow,
} from '../../supabase/functions/_shared/pipeline-view.ts'
import type { CiJobForRepair } from '../../supabase/functions/_shared/review-followup.ts'

const NOW = new Date('2026-10-26T12:00:00Z')
const P = '00000000-0000-4000-8000-000000000001'

const attempt = (over: Partial<AttemptRow> = {}): AttemptRow => ({
  id: 'f1',
  project_id: P,
  report_id: 'r1',
  status: 'completed',
  agent: 'cursor_cloud',
  pr_url: 'https://github.com/Kensaurus/Glot.it/pull/12',
  pr_number: 12,
  pr_state: 'open',
  commit_sha: 'h1',
  check_run_conclusion: 'success',
  error: null,
  summary: 'Fix the badge',
  created_at: '2026-10-24T00:00:00Z',
  completed_at: '2026-10-24T00:30:00Z',
  merged_at: null,
  ...over,
})

const review = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  fix_attempt_id: 'f1',
  status: 'completed',
  verdict: 'merge',
  summary: 'Looks right.',
  findings: [],
  error: null,
  completed_at: '2026-10-24T01:00:00Z',
  created_at: '2026-10-24T00:40:00Z',
  ...over,
})

const queue = (over: Partial<QueueRow> = {}): QueueRow => ({
  id: 'q1',
  fix_attempt_id: 'f1',
  project_id: P,
  repo: 'kensaurus/glot.it',
  pr_number: 12,
  state: 'queued',
  detail: 'Approved; waits for the next release train.',
  queued_at: '2026-10-24T02:00:00Z',
  agent_started_at: null,
  conflict_agents: 0,
  ...over,
})

const job = (over: Partial<CiJobForRepair> = {}): CiJobForRepair => ({
  job_id: 1,
  job_name: 'Build & Test',
  workflow_name: 'CI',
  run_id: 10,
  run_attempt: 1,
  repo: 'kensaurus/glot.it',
  status: 'completed',
  conclusion: 'success',
  ci_kind: 'code_failure',
  infra: false,
  gh_created_at: '2026-10-24T00:10:00Z',
  steps: [],
  ...over,
})

function run(over: Partial<PipelineInput> = {}) {
  return buildPipeline({
    now: NOW,
    reports: [],
    attempts: [attempt()],
    reviews: [review()],
    queue: [],
    followups: [],
    ciJobs: new Map([['h1', [job()]]]),
    deploys: [],
    ...over,
  })
}

function group(stages: ReturnType<typeof run>, id: string) {
  for (const s of stages) for (const g of s.groups) if (g.id === id) return { stage: s, group: g }
  return null
}

describe('buildPipeline', () => {
  it('a queued PR whose own CI is red is a CI problem, not "waiting for the next train"', () => {
    const red = job({ conclusion: 'failure', job_name: 'Lint & Build' })
    const stages = run({ queue: [queue()], ciJobs: new Map([['h1', [red]]]) })
    const hit = group(stages, 'ci_red_queued')
    expect(hit?.stage.id).toBe('ci')
    expect(hit?.group.tone).toBe('stuck')
    expect(hit?.group.label).toBe('1 PR: their own CI is red, yet they wait for a release train')
    expect(hit?.group.items[0].failingChecks).toEqual(['Lint & Build'])
    expect(hit?.group.actions).toContain('ci_repair')
    expect(group(stages, 'next_train')).toBeNull()
  })

  it('reads the latest attempt of each job: a re-run that passed is green', () => {
    const first = job({ conclusion: 'failure', run_attempt: 1 })
    const rerun = job({ conclusion: 'success', run_attempt: 2, gh_created_at: '2026-10-24T03:00:00Z' })
    const stages = run({ queue: [queue()], ciJobs: new Map([['h1', [first, rerun]]]) })
    expect(group(stages, 'next_train')?.stage.id).toBe('train')
    expect(group(stages, 'ci_red_queued')).toBeNull()
  })

  it('a test machine stop is not a code failure: re-run, never CI repair', () => {
    const stopped = job({ conclusion: 'failure', infra: true, ci_kind: 'infra' })
    const hit = group(run({ ciJobs: new Map([['h1', [stopped]]]) }), 'ci_infra')
    expect(hit?.group.actions).toEqual(['rerun_ci'])
  })

  it('skipped is not green', () => {
    const stages = run({ attempts: [attempt({ check_run_conclusion: 'skipped' })], ciJobs: new Map() })
    expect(group(stages, 'ci_never_ran')?.stage.id).toBe('ci')
    expect(group(stages, 'not_queued')).toBeNull()
  })

  it('a draft whose CI never ran is stuck at the PR stage, with Mark ready', () => {
    const stages = run({ attempts: [attempt({ pr_state: 'draft', check_run_conclusion: null })], ciJobs: new Map() })
    const hit = group(stages, 'draft_no_ci')
    expect(hit?.stage.id).toBe('pr')
    expect(hit?.group.label).toBe('1 draft: CI never ran')
    expect(hit?.group.actions).toContain('mark_ready')
  })

  it('a reviewed draft with a red check summary is a draft, never "CI is red" with CI repair', () => {
    // Host gates fail a draft on purpose; ci_jobs not collected yet.
    const stages = run({ attempts: [attempt({ pr_state: 'draft', check_run_conclusion: 'failure' })], ciJobs: new Map() })
    expect(group(stages, 'draft_no_ci')?.group.actions).toEqual(['mark_ready', 'close'])
    expect(group(stages, 'ci_red')).toBeNull()
    // A held draft stays a review decision.
    expect(group(run({ attempts: [attempt({ pr_state: 'draft' })], reviews: [review({ verdict: 'hold' })] }), 'hold')).not.toBeNull()
    // An unreviewed draft waits for the review first.
    expect(group(run({ attempts: [attempt({ pr_state: 'draft' })], reviews: [] }), 'review_slow')).not.toBeNull()
  })

  it('each item carries its latest fix event', () => {
    const events = [
      { fix_attempt_id: 'f1', at: '2026-10-25T00:00:00Z', label: 'Older' },
      { fix_attempt_id: 'f1', at: '2026-10-26T00:00:00Z', label: 'Merge queue: waiting for CI' },
    ]
    const item = group(run({ queue: [queue()], events }), 'next_train')!.group.items[0]
    expect(item).toMatchObject({ lastEventAt: '2026-10-26T00:00:00Z', lastEventLabel: 'Merge queue: waiting for CI' })
  })

  it('time in stage comes from when it entered the stage, not updated_at', () => {
    const stages = run({ queue: [queue({ queued_at: '2026-10-24T02:00:00Z' })] })
    const train = stages.find((s) => s.id === 'train')!
    expect(train.oldestAt).toBe('2026-10-24T02:00:00Z')
  })

  it('a conflict row untouched past the agent timeout is stuck, and capped rows offer no new agent', () => {
    const q = queue({ state: 'resolving', agent_started_at: '2026-10-24T05:00:00Z', conflict_agents: 2, detail: 'Conflicts with the base branch; a Cursor agent merges it in.' })
    const hit = group(run({ queue: [q] }), 'conflict_capped')
    expect(hit?.group.tone).toBe('stuck')
    expect(hit?.group.items[0].since).toBe('2026-10-24T05:00:00Z')
    expect(hit?.group.actions).not.toContain('conflict_agent')
    expect(hit?.group.actions).toContain('update_branch')

    const fresh = queue({ state: 'resolving', agent_started_at: '2026-10-24T05:00:00Z', conflict_agents: 1 })
    expect(group(run({ queue: [fresh] }), 'conflict_stuck')?.group.actions).toContain('conflict_agent')
  })

  it('the follow-ups link on a red-CI group shows only where follow-ups are off', () => {
    const red = new Map([['h1', [job({ conclusion: 'failure' })]]])
    expect(group(run({ ciJobs: red }), 'ci_red')?.group.settings).not.toBeNull()
    expect(group(run({ ciJobs: red, followupsOn: new Set([P]) }), 'ci_red')?.group.settings).toBeNull()
  })

  it('a held row says follow-ups are off and links the exact setting', () => {
    const q = queue({ state: 'blocked', detail: 'Merge conflict. Review follow-ups are off, so no agent may push to the branch.' })
    const hit = group(run({ queue: [q] }), 'held_followups_off')
    expect(hit?.group.settings?.to).toBe('/settings?tab=byok#review-followups')
  })

  it('Opus hold and fix first sit at the review stage, with the findings as evidence', () => {
    const findings = [{ issue: 'Fixes one of three cases.', severity: 'major' }]
    const hold = group(run({ reviews: [review({ verdict: 'hold', findings })] }), 'hold')
    expect(hold?.stage.id).toBe('review')
    expect(hold?.group.items[0].review?.findings).toEqual(['major: Fixes one of three cases.'])

    const working = run({ reviews: [review({ verdict: 'fix_first' })], followups: [{ fix_attempt_id: 'f1', status: 'running', kind: 'findings' }] })
    expect(group(working, 'fix_first_working')?.group.tone).toBe('moving')
    expect(group(run({ reviews: [review({ verdict: 'fix_first' })] }), 'fix_first')?.group.tone).toBe('stuck')
  })

  it('an unreviewed PR becomes stuck after two hours', () => {
    const stages = run({ reviews: [] })
    expect(group(stages, 'review_slow')?.group.actions).toEqual(['re_review'])
  })

  it('green and approved but not queued is stuck, with Queue to merge', () => {
    expect(group(run(), 'not_queued')?.group.actions).toContain('queue_merge')
  })

  it('reports: not triaged after an hour, and triaged with no fix', () => {
    const reports = [
      { id: 'r9', project_id: P, status: 'new', title: 'Crash', summary: null, description: null, created_at: '2026-10-26T09:00:00Z', processing_error: null },
      { id: 'r8', project_id: P, status: 'classified', title: null, summary: 'Button clipped', description: null, created_at: '2026-10-26T11:00:00Z', processing_error: null },
      { id: 'r1', project_id: P, status: 'classified', title: 'Has a PR', summary: null, description: null, created_at: '2026-10-20T00:00:00Z', processing_error: null },
    ]
    const stages = run({ reports })
    expect(group(stages, 'triage_slow')?.group.items.map((i) => i.id)).toEqual(['r9'])
    expect(group(stages, 'no_fix')?.group.items.map((i) => i.id)).toEqual(['r8'])
    // r1 has an open PR: it is not "waiting for a fix".
    expect(group(stages, 'no_fix_old')).toBeNull()
  })

  it('merged fixes count as deployed only when a deploy was seen after the merge', () => {
    const merged = attempt({ pr_state: 'merged', merged_at: '2026-10-25T00:00:00Z' })
    const none = run({ attempts: [merged] })
    expect(group(none, 'merged')?.group.label).toBe('1 fix: merged (this app records no deploys)')
    const seen = run({ attempts: [merged], deploys: [{ project_id: P, observed_version: '1.2.0', ok: true, observed_at: '2026-10-25T02:00:00Z' }] })
    expect(group(seen, 'deployed')?.stage.id).toBe('deployed')
    const before = run({ attempts: [merged], deploys: [{ project_id: P, observed_version: '1.1.0', ok: true, observed_at: '2026-10-20T00:00:00Z' }] })
    expect(group(before, 'not_deployed')?.group.tone).toBe('stuck')
  })

  it('stage totals: count and stuck add up over groups', () => {
    const stages = run({
      attempts: [attempt(), attempt({ id: 'f2', commit_sha: 'h2', pr_number: 13 })],
      reviews: [review(), review({ fix_attempt_id: 'f2', verdict: 'hold' })],
      queue: [queue()],
    })
    const review_ = stages.find((s) => s.id === 'review')!
    expect(review_.count).toBe(1)
    expect(review_.stuck).toBe(1)
    const train = stages.find((s) => s.id === 'train')!
    expect(train.count).toBe(1)
    expect(train.stuck).toBe(0)
  })
})

describe('helpers', () => {
  it('queueDetailKind reads the worker sentences', () => {
    expect(queueDetailKind('Its release train failed CI; it goes in a later one while Mushi finds the cause.')).toBe('train_failed')
    expect(queueDetailKind('Approved; waits for the next release train.')).toBe('next_train')
    expect(queueDetailKind(null)).toBe('next_train')
    expect(queueDetailKind('CI failed: Quality Gate, Build & Typecheck.')).toBe('ci_failed')
    expect(queueDetailKind('Something new')).toBe('other')
  })

  it('failedChecksFromDetail splits the train detail', () => {
    expect(failedChecksFromDetail('CI failed: gate, Checks (security, conventions, coverage).')).toEqual(['gate', 'Checks (security', 'conventions', 'coverage)'])
    expect(failedChecksFromDetail('CI failed: Build & Test.')).toEqual(['Build & Test'])
    expect(failedChecksFromDetail('Merged 3 fixes.')).toEqual([])
  })

  it('summarizeTrains tallies failures per repo, newest first', () => {
    const t = (id: string, state: string, at: string, detail: string | null = null) => ({ id, project_id: P, repo: 'k/a', pr_number: 1, state, members: [{}, {}], attempt: 1, detail, created_at: at, merged_at: null })
    const [s] = summarizeTrains([
      t('1', 'failed', '2026-10-25T00:00:00Z', 'CI failed: Build & Test.'),
      t('2', 'failed', '2026-10-25T06:00:00Z', 'CI failed: Build & Test, Lint.'),
      t('3', 'merged', '2026-10-25T12:00:00Z'),
      t('4', 'testing', '2026-10-26T00:00:00Z'),
    ])
    expect(s).toMatchObject({ repo: 'k/a', merged: 1, failed: 2, active: 1 })
    expect(s.topFailures[0]).toEqual({ check: 'Build & Test', count: 2 })
    expect(s.trains.map((x) => x.id)).toEqual(['4', '3', '2', '1'])
    expect(s.trains[0].members).toBe(2)
  })
})

describe('who opens fixes', () => {
  const ORG = 'org-1'
  const projects = [
    { id: P, name: 'lets-talk', organization_id: ORG, owner_id: 'u-owner' },
    { id: 'p2', name: 'glot.it', organization_id: ORG, owner_id: 'u-owner' },
    { id: 'p3', name: 'quiet', organization_id: null, owner_id: 'u-x' },
  ]
  const base = {
    now: NOW,
    projects,
    orgOwners: new Map([[ORG, new Set(['u-owner'])]]),
    autofixOn: new Set([P, 'p2']),
    cursorKeys: [{ project_id: null, organization_id: null, owner_user_id: 'u-owner', status: 'disabled', spend_down_enabled: false, exhausted_until: null }],
    jobs: [] as Array<{ project_id: string; created_at: string }>,
    attempts: [
      { project_id: P, agent: 'mcp', status: 'running', created_at: '2026-10-26T09:00:00Z' },
      { project_id: P, agent: 'cursor_cloud', status: 'completed', created_at: '2026-10-24T01:00:00Z' },
    ],
  }

  it('auto-fix on with only a disabled universal key: no agent key, 0 dispatches, local lane still runs', () => {
    const [lets, glot, quiet] = buildDispatchers(base)
    expect(lets).toMatchObject({
      opener: 'both',
      server: { agentKeys: 0, offKeys: 1, dispatches48h: 0, lastAt: '2026-10-24T01:00:00Z' },
      local: { runs24h: 1, running: 1, lastAt: '2026-10-26T09:00:00Z' },
      problem: 'Auto-fix is on but has no agent key (1 Cursor key off or spend-down off); 0 dispatches in 48h',
    })
    expect(glot.opener).toBe('nobody')
    // Auto-fix off and a key that does not serve it: no problem to report.
    expect(quiet).toMatchObject({ autofixOn: false, opener: 'nobody', problem: null, server: { agentKeys: 0, offKeys: 0 } })
  })

  it('an active spend-down key that dispatched recently is healthy; one that did not is flagged', () => {
    const live = { ...base, cursorKeys: [{ ...base.cursorKeys[0], status: 'active', spend_down_enabled: true }] }
    expect(buildDispatchers({ ...live, jobs: [{ project_id: P, created_at: '2026-10-26T10:00:00Z' }] })[0]).toMatchObject({ problem: null, server: { agentKeys: 1, dispatches24h: 1 } })
    expect(buildDispatchers(live)[0].problem).toBe('Auto-fix has an agent key but dispatched nothing in 48h')
    // A key Cursor refused for usage is not usable until it is back.
    const tired = { ...live, cursorKeys: [{ ...live.cursorKeys[0], exhausted_until: '2026-10-26T18:00:00Z' }] }
    expect(buildDispatchers(tired)[0].server.agentKeys).toBe(0)
  })

  it('becomes a red group first in the Fix PR stage, linking the spend-down switch', () => {
    const group = dispatcherGroup(buildDispatchers(base), NOW)!
    expect(group).toMatchObject({ id: 'autofix_no_agent', tone: 'stuck', count: 2, settings: { to: '/credits#cursor-fix-bugs' } })
    expect(group.label).toBe('2 apps: auto-fix is on but has no agent key; 0 dispatches in 48h')
    expect(group.items.find((i) => i.id === P)?.queueDetail).toBe('Local mushi work lanes opened 1 in 24h (1 running).')
    const stages = withDispatcherGroup(run(), group)
    const pr = stages.find((s) => s.id === 'pr')!
    expect(pr.groups[0].id).toBe('autofix_no_agent')
    expect(pr.stuck).toBe(2)
    expect(dispatcherGroup([], NOW)).toBeNull()
  })
})
