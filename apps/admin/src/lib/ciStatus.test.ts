import { describe, expect, it } from 'vitest'
import { ciOverviewFixture, FIXTURE_NOW } from '../components/ci/__fixtures__/ciOverview'
import type { CiJob, CiJobType, CiOverview } from './ciTypes'
import { buildCiStatus, estimateLine, groupFailures, machineOfJob } from './ciStatus'

const GLOT = 'kensaurus/glot.it'

function withJobs(jobs: CiJob[], byJob: CiJobType[] = []): CiOverview {
  const base = ciOverviewFixture()
  return { ...base, jobs: [...jobs, ...base.jobs], stats: { ...base.stats, byJob } }
}

function failed(over: Partial<CiJob> & Pick<CiJob, 'id' | 'jobName' | 'runId'>): CiJob {
  const base = ciOverviewFixture().jobs.find((j) => j.id === 'j7')!
  return { ...base, repo: GLOT, prNumber: 1032, status: 'completed', conclusion: 'failure', ciKind: 'code_failure', completedAt: '2026-10-21T11:50:00Z', ...over }
}

describe('machineOfJob', () => {
  it('names the machine, never the runner id', () => {
    const o = ciOverviewFixture()
    expect(machineOfJob(o, { runnerName: 'nuc-glot', runnerKind: 'self_hosted' })).toMatchObject({ name: 'nuc', kind: 'self' })
    expect(machineOfJob(o, { runnerName: 'GitHub Actions 2', runnerKind: 'github_hosted' })).toMatchObject({ name: "GitHub's cloud", kind: 'github' })
    expect(machineOfJob(o, { runnerName: null, runnerKind: 'self_hosted' })).toBeNull()
    expect(machineOfJob(o, { runnerName: 'ghost-runner', runnerKind: 'self_hosted' })).toMatchObject({ kind: 'unregistered' })
  })
})

describe('buildCiStatus', () => {
  it('says where jobs run, which machine is down and what waits, in plain sentences', () => {
    const s = buildCiStatus(ciOverviewFixture(), FIXTURE_NOW)
    expect(s.machines.map((m) => [m.name, m.running])).toContainEqual(['nuc', 1])
    expect(s.machines.find((m) => m.name === 'nuc')!.apps).toEqual([{ app: 'glot.it', count: 1 }])
    // alienware-wsl stopped reporting; j2 has waited 30 min for a machine.
    expect(s.machines.find((m) => m.name === 'alienware-wsl')!.stale).toBe(true)
    expect(s.tone).toBe('bad')
    expect(s.headline).toMatch(/^alienware-wsl stopped reporting/)
    expect(s.headline).toMatch(/waiting for a machine; the oldest for 30 min/)
    expect(s.idle).not.toContain('alienware-wsl')
  })

  it('gives each running job its usual time and time left, and flags one past the usual limit', () => {
    const byJob: CiJobType[] = [
      { repo: GLOT, workflow: '(unnamed)', job: 'build', runs: 10, durationP50s: 900, durationP90s: 1000, durationMaxS: 1200, queueP50s: 10, codeFailures: 0, infraFailures: 0, failRate: 0, lastRunAt: null },
    ]
    const o = withJobs([], byJob)
    o.jobs = o.jobs.map((j) => (j.id === 'j1' ? { ...j, workflowName: null } : j))
    // j1 started 11:52, now 12:00: 8 min of a usual 15.
    const r = buildCiStatus(o, FIXTURE_NOW).running.find((x) => x.job.id === 'j1')!
    expect(r).toMatchObject({ usualS: 900, slow: false, leftS: 420 })
    expect(estimateLine(r)).toBe('usually 15 min · about 7 min left')
    const late = buildCiStatus(o, FIXTURE_NOW + 40 * 60_000)
    expect(late.running.find((x) => x.job.id === 'j1')!.slow).toBe(true)
    expect(late.headline).toMatch(/Slower than usual: build \(glot\.it\)/)
  })

  it('says "no usual time yet" rather than guess for a job type with fewer than three runs', () => {
    const r = buildCiStatus(ciOverviewFixture(), FIXTURE_NOW).running[0]!
    expect(r.usualS).toBeNull()
    expect(estimateLine(r)).toBe('no usual time yet (fewer than 3 runs)')
  })

  it('names the week\'s worst delay: a long wait for a machine beats a low pass rate', () => {
    const s = buildCiStatus(ciOverviewFixture(), FIXTURE_NOW)
    expect(s.apps.find((a) => a.repo === GLOT)!.delay).toBe('waiting')
    expect(s.bottleneck).toBe('glot.it waits longest for a machine: 1 job in 20 waits 30 min or more.')
  })
})

describe('groupFailures', () => {
  it('groups by pull request, names the failing step and keeps the summary check under it', () => {
    const o = withJobs([
      failed({ id: 'f1', jobName: 'Lint & Build', runId: 7, failedStep: 'Dead code (production)' }),
      failed({ id: 'f2', jobName: 'gate', runId: 7, failedStep: 'Fail unless every needed job succeeded' }),
    ])
    const g = groupFailures(o, FIXTURE_NOW).find((x) => x.prNumber === 1032)!
    expect(g.broke.map((b) => [b.failure.job.jobName, b.step])).toEqual([['Lint & Build', 'Dead code (production)']])
    expect(g.summaries.map((f) => f.job.jobName)).toEqual(['gate'])
    expect(g.draftOnly).toBe(false)
  })

  it('a red draft-only gate is a skip, not a failure', () => {
    const o = withJobs([failed({ id: 'd1', jobName: 'gate', runId: 9, prNumber: 1033, failedStep: 'Draft PRs run no CI' })])
    const g = groupFailures(o, FIXTURE_NOW).find((x) => x.prNumber === 1033)!
    expect(g.draftOnly).toBe(true)
  })

  it('a lone gate whose job failed outside the window still shows as what broke', () => {
    const o = withJobs([failed({ id: 'g1', jobName: 'gate', runId: 11, prNumber: 1040, failedStep: 'Fail unless every needed job succeeded' })])
    const g = groupFailures(o, FIXTURE_NOW).find((x) => x.prNumber === 1040)!
    expect(g.broke.map((b) => b.failure.job.jobName)).toEqual(['gate'])
    expect(g.summaries).toEqual([])
  })
})
