import { describe, expect, it } from 'vitest'
import type { CiJob, CiJobType } from './ciTypes'
import { recentFailed, runningLong, waitingByRepo } from './ciAttention'

const NOW = Date.parse('2026-11-07T12:00:00Z')
const ago = (s: number) => new Date(NOW - s * 1000).toISOString()
let n = 0
const job = (over: Partial<CiJob> = {}): CiJob => ({
  id: `j${++n}`,
  projectId: 'p1',
  repo: 'acme/web',
  runId: n,
  jobId: n,
  workflowName: 'CI',
  jobName: 'Lint & Build',
  headBranch: 'fix',
  prNumber: 7,
  status: 'completed',
  conclusion: 'success',
  ciKind: 'passed',
  infra: false,
  infraDetail: null,
  runnerName: 'aw-web-1',
  runnerKind: 'self_hosted',
  labels: ['kensaurus-local'],
  queueSeconds: 10,
  durationSeconds: 300,
  createdAt: ago(900),
  startedAt: ago(800),
  completedAt: ago(500),
  htmlUrl: null,
  memPeakMb: null,
  ...over,
})
const type = (over: Partial<CiJobType> = {}): CiJobType => ({
  repo: 'acme/web',
  workflow: 'CI',
  job: 'Lint & Build',
  runs: 20,
  durationP50s: 500,
  durationP90s: 700,
  durationMaxS: 900,
  queueP50s: 30,
  codeFailures: 1,
  infraFailures: 0,
  failRate: 0.05,
  lastRunAt: ago(60),
  ...over,
})
const running = (startedS: number, over: Partial<CiJob> = {}) =>
  job({ status: 'in_progress', conclusion: null, ciKind: 'running', startedAt: ago(startedS), completedAt: null, ...over })

describe('runningLong', () => {
  it('flags a job past max(p90, 2 x median) plus a minute, not one inside it', () => {
    // limit = max(700, 1000) + 60 = 1060 s
    const slow = running(1200)
    const fine = running(1000)
    const out = runningLong([slow, fine], [type()], NOW)
    expect(out.map((r) => r.job.id)).toEqual([slow.id])
    expect(out[0]).toMatchObject({ elapsedS: 1200, typicalS: 500, p90S: 700 })
  })

  it('never flags a job type with fewer than three runs, or with no type at all', () => {
    expect(runningLong([running(5000)], [type({ runs: 2 })], NOW)).toEqual([])
    expect(runningLong([running(5000, { jobName: 'Other' })], [type()], NOW)).toEqual([])
    expect(runningLong([running(5000)], undefined, NOW)).toEqual([])
  })
})

describe('recentFailed', () => {
  it('lists test failures and machine stops of the last two hours, newest first, with a reason', () => {
    const code = job({ conclusion: 'failure', ciKind: 'code_failure', completedAt: ago(600) })
    const machine = job({ conclusion: 'failure', ciKind: 'runner_lost', infra: true, infraDetail: 'The self-hosted runner lost communication with the server.', completedAt: ago(60) })
    const old = job({ conclusion: 'failure', ciKind: 'code_failure', completedAt: ago(3 * 3600) })
    const ok = job({ completedAt: ago(30) })
    const out = recentFailed([code, machine, old, ok], NOW)
    expect(out.map((f) => [f.job.id, f.kind])).toEqual([
      [machine.id, 'machine'],
      [code.id, 'code'],
    ])
    expect(out[0].reason).toContain('lost communication')
    expect(out[1].reason).toBe('Tests failed')
  })
})

describe('waitingByRepo', () => {
  it('counts the waiting jobs per repo, the oldest wait first, with the most common job names', () => {
    const waiting = (repo: string, s: number, name: string) =>
      job({ repo, status: 'queued', conclusion: null, ciKind: 'queued', createdAt: ago(s), startedAt: null, completedAt: null, jobName: name })
    const out = waitingByRepo(
      [waiting('acme/web', 600, 'build'), waiting('acme/web', 7200, 'build'), waiting('acme/web', 60, 'gate'), waiting('acme/api', 300, 'test'), running(100)],
      NOW,
    )
    expect(out.map((r) => [r.repo, r.count, r.oldestS])).toEqual([
      ['acme/web', 3, 7200],
      ['acme/api', 1, 300],
    ])
    expect(out[0].medianS).toBe(600)
    expect(out[0].topJobs).toEqual([{ name: 'build', count: 2 }, { name: 'gate', count: 1 }])
  })
})
