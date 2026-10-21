/**
 * FILE: ci-advisor.test.ts
 * PURPOSE: The CI advice rules (Plan 022 Phase 4) fire on their evidence and
 *          stay silent without it, including the two security rules: a
 *          runner named like the Shai-Hulud worm's backdoor, and a new
 *          self-hosted runner no heartbeat lists. Also the overview builder:
 *          every queued / running job is returned first, whatever the
 *          200-job limit.
 */

import { describe, expect, it } from 'vitest'
import { adviseCi, percentile, slowSteps, type AdvisorInput, type AdvisorJob } from '../../supabase/functions/_shared/ci-advisor.ts'
import { buildCiOverview, OVERVIEW_JOB_LIMIT, type JobRow, type OverviewRows } from '../../supabase/functions/_shared/ci-overview.ts'

const NOW = new Date('2026-10-21T09:00:00Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString()
const DAY = 24 * 60
const REPO = 'kensaurus/glot.it'

const job = (over: Partial<AdvisorJob> = {}): AdvisorJob => ({
  repo: REPO,
  jobName: 'build',
  status: 'completed',
  ciKind: 'passed',
  infra: false,
  runnerName: 'kensaurus-local-glot-1',
  runnerKind: 'self_hosted',
  labels: ['self-hosted'],
  queueSeconds: 30,
  durationSeconds: 600,
  createdAt: ago(60),
  ...over,
})

const base = (over: Partial<AdvisorInput> = {}): AdvisorInput => ({
  now: NOW,
  jobs: [],
  runners: [],
  hosts: [],
  samples: [],
  workflows: [],
  repoWatchedSince: {},
  ...over,
})

const ids = (input: AdvisorInput) => adviseCi(input).map((a) => a.id.split(':')[0])

describe('percentile', () => {
  it('uses nearest rank', () => {
    expect(percentile([], 95)).toBeNull()
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
  })
})

describe('adviseCi', () => {
  it('is silent without data', () => {
    expect(adviseCi(base())).toEqual([])
  })

  it('flags a long self-hosted queue and one busy runner', () => {
    const jobs = Array.from({ length: 6 }, () => job({ queueSeconds: 20 * 60 }))
    const advice = adviseCi(base({ jobs }))
    expect(advice.map((a) => a.id)).toEqual(expect.arrayContaining(['queue_p95_self_hosted', `single_runner_busy:${REPO}`]))
    expect(advice.find((a) => a.id === 'queue_p95_self_hosted')).toMatchObject({ severity: 'medium', evidence: expect.stringContaining('Queue p95 20 min over 6') })
    expect(ids(base({ jobs: jobs.map((j) => ({ ...j, queueSeconds: 60 })) }))).not.toContain('queue_p95_self_hosted')
  })

  it('flags a high infra share with the runner that lost most', () => {
    const jobs = [...Array.from({ length: 8 }, () => job()), job({ ciKind: 'runner_lost', infra: true }), job({ ciKind: 'runner_lost', infra: true })]
    const a = adviseCi(base({ jobs })).find((x) => x.id === 'infra_share')!
    expect(a).toMatchObject({ severity: 'high', runner: 'kensaurus-local-glot-1' })
    expect(a.evidence).toContain('2 of 10 finished jobs (20%)')
  })

  it('flags an OOM kill (high) and memory near the cap (medium), and swap pressure', () => {
    const samples = [
      { hostId: 'h1', runnerName: 'kensaurus-local-glot-1', repo: REPO, at: ago(DAY), memPeakMb: 3900, memMaxMb: 4096, oomKills: 1 },
      { hostId: 'h1', runnerName: 'kensaurus-local-yen-1', repo: 'kensaurus/yen-yen', at: ago(DAY), memPeakMb: 3800, memMaxMb: 4096, oomKills: 0 },
      { hostId: 'h1', runnerName: 'old', repo: REPO, at: ago(10 * DAY), memPeakMb: 1, memMaxMb: 4096, oomKills: 3 },
    ]
    const hosts = [{ hostId: 'h1', hostname: 'nuc', lastHeartbeatAt: ago(1), metrics: { swapUsedMb: 3000, swapTotalMb: 4096 }, runners: [] }]
    const advice = adviseCi(base({ samples, hosts }))
    expect(advice.find((a) => a.id === 'oom_kill:h1:kensaurus-local-glot-1')).toMatchObject({ severity: 'high', evidence: expect.stringContaining('1 OOM kill on kensaurus-local-glot-1 (nuc)') })
    expect(advice.find((a) => a.id === 'memory_near_cap:h1:kensaurus-local-yen-1')).toMatchObject({ severity: 'medium' })
    expect(advice.some((a) => a.id.startsWith('oom_kill:h1:old'))).toBe(false)
    expect(advice.find((a) => a.id === 'swap_pressure:h1')?.evidence).toContain('73%')
    // High first.
    expect(advice[0].severity).toBe('high')
  })

  it('flags a stale host only when it lists runners', () => {
    const host = { hostId: 'h1', hostname: 'nuc', lastHeartbeatAt: ago(30), metrics: {}, runners: [{ name: 'r1', memCurrentMb: null, memMaxMb: null, oomKills: null }] }
    expect(ids(base({ hosts: [host] }))).toContain('host_stale')
    expect(ids(base({ hosts: [{ ...host, runners: [] }] }))).not.toContain('host_stale')
    expect(ids(base({ hosts: [{ ...host, lastHeartbeatAt: ago(2) }] }))).not.toContain('host_stale')
  })

  it('reads workflows: no cancel-in-progress, drafts not skipped, no cache', () => {
    const bare = 'on:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: self-hosted\n    steps:\n      - uses: actions/setup-node@v4\n      - run: pnpm install\n'
    expect(ids(base({ workflows: [{ repo: REPO, path: '.github/workflows/ci.yml', text: bare }] }))).toEqual(
      expect.arrayContaining(['no_cancel_in_progress', 'drafts_not_skipped', 'no_dependency_cache']),
    )
    const good =
      "on:\n  pull_request:\n    types: [opened, synchronize, ready_for_review]\nconcurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\njobs:\n  build:\n    if: github.event.pull_request.draft == false\n    runs-on: self-hosted\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          cache: pnpm\n      - run: pnpm install\n"
    expect(ids(base({ workflows: [{ repo: REPO, path: '.github/workflows/ci.yml', text: good }] }))).toEqual([])
    const groupNoCancel = 'on: [push]\nconcurrency:\n  group: ci\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: [{ run: echo }]\n'
    expect(adviseCi(base({ workflows: [{ repo: REPO, path: 'w.yml', text: groupNoCancel }] }))[0].evidence).toContain('without cancel-in-progress')
  })

  it('lists the slowest steps with at least 3 runs', () => {
    const steps = (s: number) => [{ name: 'pnpm build', conclusion: 'success', seconds: s }, { name: 'checkout', conclusion: 'success', seconds: 2 }]
    const jobs = [job({ steps: steps(300) }), job({ steps: steps(320) }), job({ steps: steps(280) })]
    expect(slowSteps(jobs)[0]).toEqual({ repo: REPO, job: 'build', step: 'pnpm build', p50s: 300, runs: 3 })
    expect(adviseCi(base({ jobs })).find((a) => a.id === 'slow_steps')?.evidence).toContain('pnpm build: 5 min (3 runs)')
    expect(slowSteps(jobs.slice(0, 2))).toEqual([])
  })

  describe('security', () => {
    it('flags a runner named like the Shai-Hulud backdoor, from the runner list or a job', () => {
      const fromList = adviseCi(base({ runners: [{ repo: REPO, name: 'SHA1HULUD', kind: 'self_hosted', labels: ['self-hosted'], firstSeenAt: ago(60) }] }))
      expect(fromList[0]).toMatchObject({
        id: `rogue_runner_name:${REPO}:SHA1HULUD`,
        severity: 'high',
        fix: 'Remove it in GitHub → Settings → Actions → Runners, rotate your GitHub and npm tokens.',
        runner: 'SHA1HULUD',
      })
      expect(ids(base({ jobs: [job({ runnerName: 'shai-hulud-2' })] }))).toContain('rogue_runner_name')
      expect(ids(base({ jobs: [job({ runnerName: 'shaihulud' })] }))).toContain('rogue_runner_name')
      // Flagged as rogue, not also as unknown.
      const both = adviseCi(base({
        runners: [{ repo: REPO, name: 'SHA1HULUD', kind: 'self_hosted', labels: [], firstSeenAt: ago(60) }],
        repoWatchedSince: { [REPO]: ago(10 * DAY) },
      }))
      expect(both.map((a) => a.id.split(':')[0])).toEqual(['rogue_runner_name'])
    })

    const newRunner = { repo: REPO, name: 'build-box-7', kind: 'self_hosted' as const, labels: ['self-hosted', 'linux'], firstSeenAt: ago(2 * DAY) }

    it('flags a new self-hosted runner no heartbeat lists, with its first job', () => {
      const a = adviseCi(base({
        runners: [newRunner],
        jobs: [job({ runnerName: 'build-box-7', createdAt: ago(2 * DAY - 5) })],
        repoWatchedSince: { [REPO]: ago(20 * DAY) },
      })).find((x) => x.id.startsWith('unknown_runner'))!
      expect(a).toMatchObject({ severity: 'medium', fix: 'If you did not add this machine, remove it.', repo: REPO, runner: 'build-box-7' })
      expect(a.evidence).toContain(`first job ${ago(2 * DAY - 5)} in ${REPO}`)
    })

    it('does not flag a runner a host heartbeat lists, a mushi- labelled one, an old one, or the first collection', () => {
      const watched = { [REPO]: ago(20 * DAY) }
      const host = { hostId: 'h1', hostname: 'nuc', lastHeartbeatAt: ago(1), metrics: {}, runners: [{ name: 'build-box-7', memCurrentMb: null, memMaxMb: null, oomKills: null }] }
      expect(ids(base({ runners: [newRunner], hosts: [host], repoWatchedSince: watched }))).not.toContain('unknown_runner')
      expect(ids(base({ runners: [{ ...newRunner, labels: ['self-hosted', 'mushi-nuc'] }], repoWatchedSince: watched }))).not.toContain('unknown_runner')
      expect(ids(base({ runners: [{ ...newRunner, firstSeenAt: ago(9 * DAY) }], repoWatchedSince: watched }))).not.toContain('unknown_runner')
      expect(ids(base({ runners: [newRunner], repoWatchedSince: { [REPO]: newRunner.firstSeenAt } }))).not.toContain('unknown_runner')
      expect(ids(base({ runners: [{ ...newRunner, kind: 'github_hosted' }], repoWatchedSince: watched }))).not.toContain('unknown_runner')
    })
  })
})

describe('buildCiOverview', () => {
  const P1 = '1000000a-0000-4000-8000-000000000000'
  let n = 0
  const row = (over: Partial<JobRow> = {}): JobRow => {
    n++
    return {
      id: `j${n}`,
      project_id: P1,
      repo: REPO,
      run_id: 1000 + n,
      run_attempt: 1,
      job_id: n,
      workflow_name: 'CI',
      job_name: 'build',
      head_branch: 'main',
      pr_number: null,
      status: 'completed',
      conclusion: 'success',
      ci_kind: 'passed',
      infra: false,
      infra_detail: null,
      runner_name: 'kensaurus-local-glot-1',
      runner_kind: 'self_hosted',
      runner_labels: ['self-hosted', 'glot'],
      queue_seconds: 10,
      duration_seconds: 300,
      gh_created_at: ago(n),
      started_at: ago(n),
      completed_at: ago(n),
      html_url: null,
      steps: [],
      ...over,
    }
  }
  const rows = (over: Partial<OverviewRows> = {}): OverviewRows => ({
    projects: [{ id: P1, name: 'glot.it', organization_id: 'o1' }],
    repoBindings: [{ project_id: P1, repo: REPO }],
    unfinished: [],
    finished: [],
    runners: [],
    hosts: [],
    samples: [],
    permissions: { [REPO]: { jobs: 'ok', runners: 'missing' } },
    lastLiveSyncAt: null,
    workflows: [],
    ...over,
  })
  const opts = { now: NOW, days: 7, from: new Date(NOW.getTime() - 7 * DAY * 60_000), refreshedAt: '2026-10-21T08:59:30Z' }

  it('returns every queued / running job first, then the newest finished, up to 200', () => {
    const unfinished = [
      row({ status: 'queued', conclusion: null, ci_kind: 'waiting_for_runner', infra: true, runner_name: null, queue_seconds: 900, started_at: null, completed_at: null }),
      row({ status: 'in_progress', conclusion: null, ci_kind: 'running' }),
    ]
    const finished = Array.from({ length: 400 }, () => row())
    const o = buildCiOverview(rows({ unfinished, finished }), opts)
    expect(o.jobs).toHaveLength(OVERVIEW_JOB_LIMIT)
    expect(o.jobs.slice(0, 2).map((j) => j.status)).toEqual(['queued', 'in_progress'])
    expect(o.jobs[0]).toMatchObject({ runnerName: null, labels: ['self-hosted', 'glot'], ciKind: 'waiting_for_runner', infra: true })
    expect(o.repos[0]).toMatchObject({ projectName: 'glot.it', queued: 1, running: 1, jobs7d: 402 })
    expect(o.refreshedAt).toBe('2026-10-21T08:59:30Z')
    expect(o.permissions).toEqual({ jobs: 'ok', runners: 'missing' })

    // More unfinished jobs than the limit: all of them still come back.
    const many = Array.from({ length: 230 }, () => row({ status: 'queued', conclusion: null, ci_kind: 'queued' }))
    expect(buildCiOverview(rows({ unfinished: many, finished }), opts).jobs).toHaveLength(230)
  })

  it('links hosts to runners by name and joins the job memory peak', () => {
    const j = row({ run_id: 77, runner_name: 'kensaurus-local-glot-1' })
    const o = buildCiOverview(rows({
      finished: [j, row({ ci_kind: 'runner_lost', infra: true, conclusion: 'cancelled' }), row({ ci_kind: 'code_failure', conclusion: 'failure' })],
      runners: [{ project_id: P1, repo: REPO, runner_name: 'kensaurus-local-glot-1', status: 'online', busy: false, labels: ['self-hosted'], kind: 'self_hosted', first_seen_at: ago(DAY * 3), last_job_at: ago(1) }],
      hosts: [{
        organization_id: 'o1', project_id: null, host_id: 'a'.repeat(64), hostname: 'nuc', platform: 'linux', cpu_count: 8, mem_total_mb: 16000,
        last_heartbeat_at: ago(30), metrics: { load1: 1.5, swap_used_mb: 100, swap_total_mb: 4096 }, mushi_version: '1.0.0',
        runners: [{ name: 'kensaurus-local-glot-1', repo: REPO, service: 'actions.runner.glot.service', active: true, restarts: 0, mem_current_mb: 900, mem_max_mb: 4096, oom_kills: 0 }],
      }, {
        organization_id: 'o1', project_id: null, host_id: 'b'.repeat(64), hostname: 'unrelated', platform: 'macos', cpu_count: null, mem_total_mb: null,
        last_heartbeat_at: ago(1), metrics: {}, mushi_version: null, runners: [{ name: 'other', repo: 'someone/else', active: true }],
      }],
      samples: [{ host_id: 'a'.repeat(64), runner_name: 'kensaurus-local-glot-1', repo: REPO, run_id: 77, run_attempt: 1, phase: 'completed', at: ago(1), mem_peak_mb: 3500, mem_max_mb: 4096, oom_kills: 0 }],
    }), opts)
    expect(o.hosts).toHaveLength(1)
    expect(o.hosts[0]).toMatchObject({ hostname: 'nuc', stale: true, metrics: { load1: 1.5, swapUsedMb: 100, swapTotalMb: 4096 } })
    expect(o.runners[0]).toMatchObject({ name: 'kensaurus-local-glot-1', hostId: 'a'.repeat(64), infraFailures7d: 1 })
    expect(o.jobs.find((x) => x.runId === 77)?.memPeakMb).toBe(3500)
    expect(o.stats).toMatchObject({ jobs: 3, infraFailures: 1, codeFailures: 1, passRate: 0.333 })
    expect(o.advice.map((a) => a.id)).toContain(`host_stale:${'a'.repeat(64)}`)
  })
})
