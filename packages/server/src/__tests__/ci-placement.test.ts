/**
 * FILE: ci-placement.test.ts
 * PURPOSE: `_shared/ci-placement.ts` (Plan 022 Phase 7b, ADR 0037):
 *            - only LINUX_RUNNER and RUNNER_<WORKFLOW> may be written;
 *            - the CI agreement: no paid GitHub-hosted minutes on private
 *              repos (allowed repos excepted, unknown visibility counts as
 *              private), external controllers own their repos, standby
 *              runners are never a target;
 *            - which jobs move with a variable and which stay, with reasons;
 *            - the preview: payload with the compare-and-set state, warnings
 *              (no online runner, fork risk on public repos, recent outside
 *              change, nothing moves, main/Dependabot stay), blocks;
 *            - the post-change watch over the next 10 jobs.
 */

import { describe, expect, it } from 'vitest'
import {
  buildPlacementPreview,
  classifyPlacementJobs,
  evaluateWatch,
  isAllowedPlacementVariable,
  matchesPattern,
  normalizePolicy,
  payloadProblem,
  policyVerdict,
  revertPayload,
  targetOf,
  variableMatches,
  workflowVariableName,
  type CiRunnerPolicy,
  type PreviewInput,
  type WatchJob,
} from '../../supabase/functions/_shared/ci-placement.ts'
import { parseRepoWorkflows } from '../../supabase/functions/_shared/ci-runs-on.ts'

const ORG = '0000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-22T12:00:00Z')

const CI = `name: CI
on: pull_request
jobs:
  lint:
    name: Lint
    runs-on: \${{ (github.actor != 'dependabot[bot]' && github.ref != 'refs/heads/main' && vars.LINUX_RUNNER) || 'ubuntu-24.04' }}
    steps: []
  bundle:
    name: Bundle
    runs-on: \${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}
    steps: []
  visual:
    name: Visual
    runs-on: ubuntu-latest # pixel baselines are captured on hosted
    steps: []
  e2e:
    name: E2E
    runs-on: \${{ vars.RUNNER_E2E || 'ubuntu-latest' }}
    steps: []
  matrix:
    name: Matrix
    runs-on: \${{ matrix.os }}
    steps: []
  local:
    name: Local
    runs-on: [self-hosted, alienware]
    steps: []
`
const parsed = parseRepoWorkflows([{ path: '.github/workflows/ci.yml', text: CI }])

function policy(over: Partial<CiRunnerPolicy> = {}): CiRunnerPolicy {
  return {
    organizationId: ORG,
    noPaidHostedOnPrivate: true,
    hostedAllowedRepos: ['AtPeak-Co-Ltd/pck', 'kensaurus/mushi-mushi'],
    externalControllers: [{ name: 'kci dispatcher', owner: 'sbc-visual', repos: ['kensaurus/solo-boss-cloud_backend', 'kensaurus/tsumagoi'], note: null }],
    standbyRunners: ['kensaurus-local-*'],
    sourceNote: 'CI-AGREEMENT.md, 2026-10-22',
    updatedAt: null,
    ...over,
  }
}

const runners = [
  { runner_name: 'alienware-yen-yen-1', status: 'online', busy: false, labels: ['self-hosted', 'kensaurus-local'] },
  { runner_name: 'kensaurus-local-yen-yen-1', status: 'online', busy: false, labels: ['self-hosted', 'nuc-standby'] },
]

describe('allowlist', () => {
  it('allows LINUX_RUNNER and RUNNER_<WORKFLOW> only', () => {
    expect(isAllowedPlacementVariable('LINUX_RUNNER')).toBe(true)
    expect(isAllowedPlacementVariable('RUNNER_E2E')).toBe(true)
    for (const bad of ['EXPO_PUBLIC_API_URL', 'linux_runner', 'RUNNER_', 'RUNNER_e2e', 'LINUX_RUNNER_X', 'GITHUB_TOKEN', '', null, 7]) {
      expect(isAllowedPlacementVariable(bad)).toBe(false)
    }
    expect(workflowVariableName('.github/workflows/e2e-mobile.yml')).toBe('RUNNER_E2E_MOBILE')
    expect(isAllowedPlacementVariable(workflowVariableName('.github/workflows/ci.yml'))).toBe(true)
  })

  it('refuses payloads that are not exactly a runner change', () => {
    const ok = { repo: 'kensaurus/yen-yen', name: 'LINUX_RUNNER', value: 'kensaurus-local', expected: { exists: false, value: null, updatedAt: null }, jobs: [], expectedLabels: [] }
    expect(payloadProblem(ok, 'set_actions_variable')).toBeNull()
    expect(payloadProblem({ ...ok, name: 'EXPO_PUBLIC_API_URL' }, 'set_actions_variable')).toMatch(/only changes LINUX_RUNNER/)
    expect(payloadProblem({ ...ok, value: 'two labels' }, 'set_actions_variable')).toMatch(/one runner label/)
    expect(payloadProblem({ ...ok, value: 'x' }, 'delete_actions_variable')).toMatch(/no value/)
    expect(payloadProblem({ ...ok, expected: null }, 'set_actions_variable')).toMatch(/compare-and-set/)
    expect(payloadProblem({ ...ok, expected: { exists: true } }, 'set_actions_variable')).toMatch(/expected current value/)
    expect(payloadProblem({ ...ok, repo: 'no-slash' }, 'set_actions_variable')).toMatch(/owner\/repo/)
    expect(payloadProblem(ok, 'drop_table')).toMatch(/Unknown action/)
    expect(payloadProblem(null, 'set_actions_variable')).toMatch(/not an object/)
  })
})

describe('policy', () => {
  it('normalizes a stored row and drops malformed controllers', () => {
    const p = normalizePolicy({
      organization_id: ORG,
      no_paid_hosted_on_private: true,
      hosted_allowed_repos: ['kensaurus/mushi-mushi', 'bad repo', 'kensaurus/mushi-mushi'],
      external_controllers: [{ name: 'kci dispatcher', owner: 'sbc-visual', repos: ['kensaurus/tsumagoi', 'nope'] }, { name: '', repos: ['a/b'] }, { name: 'x', repos: [] }, 'junk'],
      standby_runners: ['kensaurus-local-*'],
    })!
    expect(p.hostedAllowedRepos).toEqual(['kensaurus/mushi-mushi'])
    expect(p.externalControllers).toEqual([{ name: 'kci dispatcher', owner: 'sbc-visual', repos: ['kensaurus/tsumagoi'], note: null }])
    expect(normalizePolicy(null)).toBeNull()
  })

  it('with no policy, everything is allowed', () => {
    expect(policyVerdict(null, { repo: 'a/b', visibility: 'private', target: { kind: 'github_hosted', label: 'ubuntu-latest' }, runners: [] }).allowed).toBe(true)
  })

  it('refuses GitHub-hosted on a private repo, and on an unconfirmed one, unless the repo is allowed', () => {
    const v = policyVerdict(policy(), { repo: 'kensaurus/yen-yen', visibility: 'private', target: { kind: 'github_hosted', label: 'ubuntu-24.04' }, runners })
    expect(v).toMatchObject({ allowed: false, code: 'POLICY_NO_PAID_HOSTED' })
    expect(v.reason).toContain('CI-AGREEMENT.md, 2026-10-22')
    expect(policyVerdict(policy(), { repo: 'kensaurus/yen-yen', visibility: 'unknown', target: { kind: 'github_hosted', label: null }, runners }).reason).toMatch(/counts as private/)
    expect(policyVerdict(policy(), { repo: 'AtPeak-Co-Ltd/pck', visibility: 'private', target: { kind: 'github_hosted', label: 'ubuntu-latest' }, runners }).allowed).toBe(true)
    expect(policyVerdict(policy(), { repo: 'kensaurus/glot.it', visibility: 'public', target: { kind: 'github_hosted', label: 'ubuntu-latest' }, runners }).allowed).toBe(true)
    expect(policyVerdict(policy({ noPaidHostedOnPrivate: false }), { repo: 'kensaurus/yen-yen', visibility: 'private', target: { kind: 'github_hosted', label: 'ubuntu-latest' }, runners }).allowed).toBe(true)
  })

  it('refuses any change on a repo an external controller manages, and names it', () => {
    const v = policyVerdict(policy(), { repo: 'kensaurus/Tsumagoi', visibility: 'private', target: { kind: 'self_hosted', label: 'kensaurus-local' }, runners })
    expect(v).toMatchObject({ allowed: false, code: 'EXTERNAL_CONTROLLER', controller: { name: 'kci dispatcher', owner: 'sbc-visual' } })
    expect(v.reason).toContain('managed by kci dispatcher (sbc-visual)')
  })

  it('never targets a standby runner: by label pattern, or when every runner with the label is standby', () => {
    expect(policyVerdict(policy(), { repo: 'kensaurus/yen-yen', visibility: 'private', target: { kind: 'self_hosted', label: 'kensaurus-local-glot-1' }, runners }).code).toBe('POLICY_STANDBY_TARGET')
    expect(policyVerdict(policy(), { repo: 'kensaurus/yen-yen', visibility: 'private', target: { kind: 'self_hosted', label: 'nuc-standby' }, runners }).code).toBe('POLICY_STANDBY_TARGET')
    expect(policyVerdict(policy(), { repo: 'kensaurus/yen-yen', visibility: 'private', target: { kind: 'self_hosted', label: 'kensaurus-local' }, runners }).allowed).toBe(true)
    expect(matchesPattern('Kensaurus-Local-glot-1', 'kensaurus-local-*')).toBe(true)
    expect(matchesPattern('kensaurus-local', 'kensaurus-local-*')).toBe(false)
    expect(matchesPattern('a.b', 'a.b')).toBe(true)
    expect(matchesPattern('axb', 'a.b')).toBe(false)
  })

  it('reads the target from the value or, with no variable, the fallback label', () => {
    expect(targetOf(null, 'ubuntu-24.04')).toEqual({ kind: 'github_hosted', label: 'ubuntu-24.04' })
    expect(targetOf('', null)).toEqual({ kind: 'github_hosted', label: null })
    expect(targetOf(null, 'alienware')).toEqual({ kind: 'self_hosted', label: 'alienware' })
    expect(targetOf('kensaurus-local', 'ubuntu-latest')).toEqual({ kind: 'self_hosted', label: 'kensaurus-local' })
    expect(targetOf('ubuntu-latest', null)).toEqual({ kind: 'github_hosted', label: 'ubuntu-latest' })
  })
})

describe('classifyPlacementJobs', () => {
  it('moves the jobs that read the variable and keeps the others, each with a reason', () => {
    const jobs = classifyPlacementJobs(parsed, 'LINUX_RUNNER')
    expect(jobs.moves.map((m) => [m.job, m.fallback, m.mainStays, m.dependabotStays])).toEqual([
      ['Lint', 'ubuntu-24.04', true, true],
      ['Bundle', 'ubuntu-24.04', false, false],
    ])
    const stays = Object.fromEntries(jobs.stays.map((s) => [s.job, s]))
    expect(stays.Visual).toMatchObject({ why: 'pinned_hosted', detail: 'Pinned to GitHub: pixel baselines are captured on hosted' })
    expect(stays.E2E).toMatchObject({ why: 'other_variable', detail: 'Reads vars.RUNNER_E2E, not vars.LINUX_RUNNER.' })
    expect(stays.Matrix.why).toBe('expression')
    expect(stays.Local).toMatchObject({ why: 'pinned_self_hosted' })
    expect(classifyPlacementJobs(parsed, 'RUNNER_E2E').moves.map((m) => m.job)).toEqual(['E2E'])
  })
})

function input(over: Partial<PreviewInput> = {}): PreviewInput {
  return {
    projectId: 'p1',
    repo: 'kensaurus/yen-yen',
    visibility: 'private',
    variable: 'LINUX_RUNNER',
    value: 'kensaurus-local',
    current: { exists: false, value: null, updatedAt: null },
    parsed,
    policy: policy(),
    runners,
    waitP95ByLabel: { 'kensaurus-local': 191 },
    cost: { monthCostDelta: -12.3, currency: 'USD', note: 'From the cost comparison' },
    now: NOW,
    ...over,
  }
}

describe('buildPlacementPreview', () => {
  it('yen-yen today: set LINUX_RUNNER, two jobs move, the payload carries the current state for the compare-and-set', () => {
    const p = buildPlacementPreview(input())
    expect(p.blocked).toBeNull()
    expect(p.action).toBe('set_actions_variable')
    expect(p.now.target).toEqual({ kind: 'github_hosted', label: 'ubuntu-24.04' })
    expect(p.next.target).toEqual({ kind: 'self_hosted', label: 'kensaurus-local' })
    expect(p.target).toEqual({ label: 'kensaurus-local', runners: 1, online: 1, busy: 0, waitP95s: 191 })
    expect(p.payload).toEqual({
      repo: 'kensaurus/yen-yen',
      name: 'LINUX_RUNNER',
      value: 'kensaurus-local',
      expected: { exists: false, value: null, updatedAt: null },
      jobs: [{ workflow: 'CI', job: 'Lint' }, { workflow: 'CI', job: 'Bundle' }],
      expectedLabels: ['kensaurus-local'],
      fallbackLabels: ['ubuntu-24.04'],
    })
    expect(p.warnings.join(' ')).toMatch(/Runs on main and Dependabot updates keep using GitHub/)
    expect(p.warnings.join(' ')).toMatch(/Jobs already queued keep the runner/)
    expect(p.cost?.monthCostDelta).toBe(-12.3)
  })

  it('blocks GitHub-hosted on a private repo under the agreement, with the reason, and builds no payload', () => {
    const p = buildPlacementPreview(input({ value: null, current: { exists: true, value: 'kensaurus-local', updatedAt: '2026-10-21T15:11:00Z' } }))
    expect(p.action).toBe('delete_actions_variable')
    expect(p.blocked?.code).toBe('POLICY_NO_PAID_HOSTED')
    expect(p.payload).toBeNull()
    expect(p.warnings.join(' ')).toMatch(/GitHub-hosted minutes are billed/)
  })

  it('blocks an external controller\'s repo and a standby target', () => {
    expect(buildPlacementPreview(input({ repo: 'kensaurus/tsumagoi' })).blocked?.code).toBe('EXTERNAL_CONTROLLER')
    expect(buildPlacementPreview(input({ value: 'kensaurus-local-glot-1' })).blocked?.code).toBe('POLICY_STANDBY_TARGET')
  })

  it('blocks a variable outside the allowlist, a bad label, an unreadable variable, and no change', () => {
    expect(buildPlacementPreview(input({ variable: 'EXPO_PUBLIC_API_URL' })).blocked?.code).toBe('VARIABLE_NOT_ALLOWED')
    expect(buildPlacementPreview(input({ value: 'a label' })).blocked?.code).toBe('VALIDATION_ERROR')
    const unreadable = buildPlacementPreview(input({ current: null }))
    expect(unreadable.blocked?.code).toBe('VARIABLE_UNREADABLE')
    expect(unreadable.blocked?.message).toMatch(/Variables: read/)
    expect(buildPlacementPreview(input({ current: { exists: true, value: 'kensaurus-local', updatedAt: '2026-10-01T00:00:00Z' } })).blocked?.code).toBe('NO_CHANGE')
    expect(buildPlacementPreview(input({ value: null, policy: null })).blocked?.code).toBe('NO_CHANGE')
  })

  it('warns about a label no runner has, an offline label, fork PRs on a public repo, and a recent outside change', () => {
    expect(buildPlacementPreview(input({ value: 'ghost' })).warnings.join(' ')).toMatch(/No runner Mushi has seen carries the label “ghost”/)
    const offline = buildPlacementPreview(input({ runners: [{ ...runners[0], status: 'offline' }] }))
    expect(offline.warnings.join(' ')).toMatch(/is online right now/)
    expect(buildPlacementPreview(input({ visibility: 'public', policy: null })).warnings.join(' ')).toMatch(/a pull request from a fork could run code/)
    const recent = buildPlacementPreview(input({ current: { exists: true, value: 'old-label', updatedAt: '2026-10-22T09:00:00Z' } }))
    expect(recent.warnings.join(' ')).toMatch(/last changed 3 hours ago/)
    expect(recent.payload?.expected).toEqual({ exists: true, value: 'old-label', updatedAt: '2026-10-22T09:00:00Z' })
  })

  it('says when nothing would move, or the workflows were never read', () => {
    expect(buildPlacementPreview(input({ variable: 'RUNNER_DEPLOY' })).warnings.join(' ')).toMatch(/No job in this repo's workflows reads vars.RUNNER_DEPLOY/)
    expect(buildPlacementPreview(input({ parsed: null })).warnings.join(' ')).toMatch(/has not read this repo's workflow files/)
  })

  it('a revert puts the previous value back, expecting what Mushi left', () => {
    const done = buildPlacementPreview(input()).payload!
    const r = revertPayload(done, { exists: true, value: 'kensaurus-local', updatedAt: '2026-10-22T12:01:00Z' })
    // Back to no variable: the jobs land on their fallbacks again.
    expect(r).toMatchObject({ value: null, expected: { exists: true, value: 'kensaurus-local', updatedAt: '2026-10-22T12:01:00Z' }, expectedLabels: ['ubuntu-24.04'], fallbackLabels: ['ubuntu-24.04'] })
    const set = revertPayload({ ...done, expected: { exists: true, value: 'old', updatedAt: 'x' } }, { exists: true, value: 'kensaurus-local', updatedAt: 'y' })
    expect(set).toMatchObject({ value: 'old', expectedLabels: ['old'] })
  })
})

describe('variableMatches (compare-and-set)', () => {
  it('needs the same existence, value and updated_at', () => {
    const v = { exists: true, value: 'a', updatedAt: 't1' }
    expect(variableMatches(v, { ...v })).toBe(true)
    expect(variableMatches(v, { ...v, value: 'b' })).toBe(false)
    expect(variableMatches(v, { ...v, updatedAt: 't2' })).toBe(false)
    expect(variableMatches(v, { exists: false, value: null, updatedAt: null })).toBe(false)
    expect(variableMatches({ exists: false, value: null, updatedAt: null }, { exists: false, value: null, updatedAt: null })).toBe(true)
    expect(variableMatches({ exists: false, value: null, updatedAt: null }, v)).toBe(false)
  })
})

describe('evaluateWatch', () => {
  const watch = { jobs: [{ workflow: 'CI', job: 'Lint' }], expectedLabels: ['kensaurus-local'], startedAt: '2026-10-22T12:00:00Z' }
  const j = (min: number, over: Partial<WatchJob> = {}): WatchJob => ({
    workflow_name: 'CI', job_name: 'Lint', runner_labels: ['kensaurus-local'], queue_seconds: 30, head_branch: 'feat/x',
    gh_created_at: new Date(Date.parse(watch.startedAt) + min * 60_000).toISOString(), html_url: `https://gh/${min}`, ...over,
  })

  it('watches until 10 moved jobs ran where expected, then says ok', () => {
    expect(evaluateWatch(watch, [j(1), j(2)], NOW)).toMatchObject({ status: 'watching', jobsSeen: 2 })
    expect(evaluateWatch(watch, Array.from({ length: 12 }, (_, i) => j(i + 1)), NOW)).toMatchObject({ status: 'ok', jobsSeen: 10 })
  })

  it('alerts on a job that asked for another label, or waited over 30 minutes', () => {
    const r = evaluateWatch(watch, [j(1), j(2, { runner_labels: ['ubuntu-24.04'] }), j(3, { queue_seconds: 2400 })], NOW)
    expect(r.status).toBe('alert')
    expect(r.unexpected).toEqual([{ job: 'Lint', labels: ['ubuntu-24.04'], url: 'https://gh/2' }])
    expect(r.slow).toEqual([{ job: 'Lint', queueSeconds: 2400, url: 'https://gh/3' }])
  })

  it('ignores jobs before the change, other jobs, and main / Dependabot runs', () => {
    const r = evaluateWatch(watch, [j(-5, { runner_labels: ['x'] }), j(1, { job_name: 'Visual', runner_labels: ['ubuntu-latest'] }), j(2, { head_branch: 'main', runner_labels: ['ubuntu-24.04'] }), j(3, { head_branch: 'dependabot/npm/x', runner_labels: ['ubuntu-24.04'] })], NOW)
    expect(r).toMatchObject({ status: 'watching', jobsSeen: 0 })
  })

  it('expires after a week with no matching job', () => {
    expect(evaluateWatch(watch, [], new Date('2026-10-30T12:00:00Z')).status).toBe('expired')
  })
})

describe('security review fixes (ADR 0037)', () => {
  it('matches standby patterns linearly, even pathological ones', () => {
    const t0 = Date.now()
    expect(matchesPattern('a'.repeat(100), `${'*a'.repeat(50)}*c`)).toBe(false)
    expect(Date.now() - t0).toBeLessThan(200)
    expect(matchesPattern('kensaurus-local-glot-1', 'kensaurus-local-**')).toBe(true)
    expect(matchesPattern('abc', '*')).toBe(true)
    expect(matchesPattern('', '*')).toBe(true)
    expect(matchesPattern('abc', 'a*c*')).toBe(true)
    expect(matchesPattern('abd', 'a*c')).toBe(false)
  })

  it('a delete with mixed fallbacks is refused when any job would land on paid GitHub', () => {
    const MIXED = `name: CI
on: pull_request
jobs:
  a:
    runs-on: \${{ vars.LINUX_RUNNER || 'kensaurus-local' }}
    steps: []
  b:
    runs-on: \${{ vars.LINUX_RUNNER || 'kensaurus-local' }}
    steps: []
  c:
    runs-on: \${{ vars.LINUX_RUNNER || 'ubuntu-latest' }}
    steps: []
`
    const p = buildPlacementPreview(input({ value: null, parsed: parseRepoWorkflows([{ path: 'ci.yml', text: MIXED }]), current: { exists: true, value: 'kensaurus-local', updatedAt: '2026-10-01T00:00:00Z' } }))
    expect(p.blocked?.code).toBe('POLICY_NO_PAID_HOSTED')
    const ok = buildPlacementPreview(input({ value: null, policy: policy({ noPaidHostedOnPrivate: false }), parsed: parseRepoWorkflows([{ path: 'ci.yml', text: MIXED }]), current: { exists: true, value: 'kensaurus-local', updatedAt: '2026-10-01T00:00:00Z' } }))
    expect(ok.payload?.fallbackLabels).toEqual(['kensaurus-local', 'ubuntu-latest'])
    expect(ok.payload?.expectedLabels).toEqual(['kensaurus-local', 'ubuntu-latest'])
  })

  it('an unknown target label is refused under the no-spend rule, not on public repos or without a policy', () => {
    expect(buildPlacementPreview(input({ value: 'linux-16core' })).blocked?.code).toBe('POLICY_UNKNOWN_TARGET')
    expect(buildPlacementPreview(input({ value: 'linux-16core', visibility: 'public' })).blocked).toBeNull()
    expect(buildPlacementPreview(input({ value: 'linux-16core', policy: null })).blocked).toBeNull()
    // A GitHub-hosted (larger) runner carrying the label does not prove it is yours.
    const larger = [{ runner_name: 'GitHub Actions 3', status: 'online', labels: ['linux-16core'], kind: 'github_hosted' }]
    expect(buildPlacementPreview(input({ value: 'linux-16core', runners: larger })).blocked?.code).toBe('POLICY_UNKNOWN_TARGET')
  })
})
