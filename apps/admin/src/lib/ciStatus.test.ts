import { describe, expect, it } from 'vitest'
import { ciOverviewFixture, FIXTURE_NOW } from '../components/ci/__fixtures__/ciOverview'
import type { CiJob, CiJobType, CiOverview } from './ciTypes'
import { buildCiStatus, estimateLine, groupFailureCauses, groupFailures, groupWaiting, machineOfJob, specificLabels } from './ciStatus'

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

/** The live shape of 2026-11-16: three "kensaurus-local" jobs wait; only overseas-ci runs those; two machines idle. */
function waitingForLocal(): CiOverview {
  const base = ciOverviewFixture()
  const host = (hostId: string, hostname: string) => ({ ...base.hosts[0]!, hostId, hostname, stale: false, runners: [] })
  const tmpl = base.jobs.find((j) => j.id === 'j2')!
  const run = base.jobs.find((j) => j.id === 'j1')!
  const local = ['kensaurus-local']
  return {
    ...base,
    hosts: [host('h-os', 'overseas-ci'), host('h-a1', 'alienware-ci'), host('h-a2', 'alienwarex16')],
    runners: [{ ...base.runners[0]!, name: 'aw-glot.it-1', hostId: 'h-os', labels: local }],
    jobs: [
      { ...run, id: 'r1', labels: local, runnerName: 'aw-glot.it-1' },
      ...['w1', 'w2', 'w3'].map((id) => ({ ...tmpl, id, labels: local, createdAt: '2026-10-21T11:45:00Z' })),
    ],
  }
}

describe('why jobs wait', () => {
  it('names the only machine that takes the label, and says the idle ones are not set up for it', () => {
    const s = buildCiStatus(waitingForLocal(), FIXTURE_NOW)
    expect(s.waitWhy).toBe('They need a “kensaurus-local” machine; only overseas-ci (running 1 now) takes those. alienware-ci and alienwarex16 are idle but not set up for “kensaurus-local”.')
    expect(s.headline).toContain('3 jobs waiting for a machine; the oldest for 15 min. They need a “kensaurus-local” machine')
  })

  it('says when no machine ever ran the label, and when the wait is on GitHub', () => {
    const o = waitingForLocal()
    o.jobs = o.jobs.filter((j) => j.id !== 'r1')
    expect(buildCiStatus(o, FIXTURE_NOW).waitWhy).toMatch(/none ran such a job this week: check that a runner is set up for it\.$/)
    o.jobs = o.jobs.map((j) => ({ ...j, labels: ['ubuntu-latest'] }))
    expect(buildCiStatus(o, FIXTURE_NOW).waitWhy).toBe("They wait for GitHub's cloud (“ubuntu-latest”), not for your machines.")
  })
})

describe('groupFailures: one line per job, drafts apart', () => {
  it('lists a job that failed in two runs once, and a summary check once', () => {
    const o = withJobs([
      failed({ id: 'a1', jobName: 'Rendered UI Audits', runId: 20, failedStep: 'Console chrome contract', completedAt: '2026-10-21T11:40:00Z' }),
      failed({ id: 'a2', jobName: 'Quality Gate', runId: 20, failedStep: 'Gate on every upstream job', completedAt: '2026-10-21T11:40:00Z' }),
      failed({ id: 'b1', jobName: 'Rendered UI Audits', runId: 21, failedStep: 'Console chrome contract', completedAt: '2026-10-21T11:50:00Z' }),
      failed({ id: 'b2', jobName: 'Quality Gate', runId: 21, failedStep: 'Gate on every upstream job', completedAt: '2026-10-21T11:50:00Z' }),
    ])
    const g = groupFailures(o, FIXTURE_NOW).find((x) => x.prNumber === 1032)!
    expect(g.broke.map((b) => b.failure.job.id)).toEqual(['b1'])
    expect(g.summaries.map((f) => f.job.id)).toEqual(['b2'])
  })

  it('a draft step next to a real failure is a summary, never what broke; "required" is a summary name', () => {
    const o = withJobs([
      failed({ id: 'c1', jobName: 'Lint, Type-check & Build', runId: 30, prNumber: 413, failedStep: 'Dead code (production)' }),
      failed({ id: 'c2', jobName: 'required', runId: 30, prNumber: 413, failedStep: 'Draft PRs run no CI' }),
      failed({ id: 'c3', jobName: 'required', runId: 31, prNumber: 413, workflowName: 'gate', failedStep: 'Gate on every upstream job' }),
    ])
    const g = groupFailures(o, FIXTURE_NOW).find((x) => x.prNumber === 413)!
    expect(g.draftOnly).toBe(false)
    expect(g.broke.map((b) => b.failure.job.id)).toEqual(['c1'])
    expect(g.summaries.map((f) => f.job.id).sort()).toEqual(['c2', 'c3'])
  })
})

describe('the week table', () => {
  it('names the repo when two rows would share an app name', () => {
    const base = ciOverviewFixture()
    const r0 = base.repos[0]!
    const o = { ...base, repos: [{ ...r0, repo: 'kensaurus/solo-boss-cloud', projectName: 'solo-boss-cloud', jobs7d: 5 }, { ...r0, repo: 'kensaurus/solo-boss-cloud-documentation', projectName: 'solo-boss-cloud', jobs7d: 4 }] }
    expect(buildCiStatus(o, FIXTURE_NOW).apps.map((a) => a.app).sort()).toEqual(['solo-boss-cloud (solo-boss-cloud)', 'solo-boss-cloud (solo-boss-cloud-documentation)'])
  })
})

describe('the label gap (2026-11-18)', () => {
  it('drops the labels every runner has', () => {
    expect(specificLabels(['self-hosted', 'Linux', 'X64', 'kensaurus-local', 'ubuntu-latest'])).toEqual(['kensaurus-local'])
  })

  it('marks idle machines missing a waiting label, and the waiting jobs that need it', () => {
    const s = buildCiStatus(waitingForLocal(), FIXTURE_NOW)
    const by = (name: string) => s.allMachines.find((m) => m.name === name)!
    expect(by('alienware-ci').missingLabels).toEqual(['kensaurus-local'])
    expect(by('alienwarex16').missingLabels).toEqual(['kensaurus-local'])
    // The machine that has the label (and is busy) is never flagged.
    expect(by('overseas-ci').missingLabels).toEqual([])
    expect(by('overseas-ci').labels).toEqual(['kensaurus-local'])
    expect(s.waitingJobs.map((w) => [w.job.id, w.needs, w.mismatch])).toEqual([
      ['w1', ['kensaurus-local'], true],
      ['w2', ['kensaurus-local'], true],
      ['w3', ['kensaurus-local'], true],
    ])
  })

  it('never flags a job waiting for GitHub cloud', () => {
    const o = waitingForLocal()
    o.jobs = o.jobs.map((j) => (j.id.startsWith('w') ? { ...j, labels: ['ubuntu-latest'] } : j))
    const s = buildCiStatus(o, FIXTURE_NOW)
    expect(s.waitingJobs.every((w) => w.needs.length === 0 && !w.mismatch)).toBe(true)
    expect(s.allMachines.every((m) => (m.missingLabels ?? []).length === 0)).toBe(true)
  })
})

describe('waiting jobs by the labels they need (2026-11-18)', () => {
  it('puts eight jobs that need kensaurus-local under one group, and a cloud job in its own', () => {
    const o = waitingForLocal()
    const tmpl = o.jobs.find((j) => j.id === 'w1')!
    o.jobs = [
      ...o.jobs.filter((j) => !j.id.startsWith('w')),
      // Generic labels and case never split a group: they need the same machine.
      ...Array.from({ length: 8 }, (_, i) => ({ ...tmpl, id: `w${i}`, labels: i % 2 ? ['self-hosted', 'Linux', 'kensaurus-local'] : ['Kensaurus-Local'], createdAt: `2026-10-21T11:4${i}:00Z` })),
      { ...tmpl, id: 'cloud', labels: ['ubuntu-latest'], createdAt: '2026-10-21T11:30:00Z' },
    ]
    const s = buildCiStatus(o, FIXTURE_NOW)
    expect(s.waitingJobs).toHaveLength(9)
    expect(s.waitingGroups.map((g) => [g.key, g.jobs.length, g.mismatch])).toEqual([
      ['kensaurus-local', 8, true],
      ['', 1, false],
    ])
    const local = s.waitingGroups[0]!
    expect(local.needs.map((l) => l.toLowerCase())).toEqual(['kensaurus-local'])
    // Oldest first inside the group.
    expect(local.jobs.map((w) => w.job.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'])
    expect(s.waitingGroups[1]!.needs).toEqual([])
  })

  it('orders groups by size, then by the longest wait', () => {
    const w = (id: string, needs: string[], waitS: number) => ({ job: { id } as never, app: 'a', waitS, needs, mismatch: false })
    expect(groupWaiting([w('a', ['x'], 10), w('b', ['y'], 99), w('c', ['y'], 5), w('d', ['z'], 50)]).map((g) => g.key)).toEqual(['y', 'z', 'x'])
    expect(groupWaiting([])).toEqual([])
  })
})

describe('groupFailureCauses: same cause, one card', () => {
  it('puts one failing step across five PRs in three apps into one cause, and keeps the rest single', () => {
    const repos = ['kensaurus/glot.it', 'kensaurus/glot.it', 'kensaurus/twm', 'kensaurus/yen-yen', 'kensaurus/yen-yen']
    const o = withJobs([
      ...repos.map((repo, i) => failed({ id: `d${i}`, repo, jobName: 'Security', runId: 50 + i, prNumber: 600 + i, failedStep: 'Dependency audit', completedAt: `2026-10-21T11:4${i}:00Z` })),
      failed({ id: 'e1', jobName: 'Lint & Build', runId: 70, prNumber: 700, failedStep: 'Dead code (production)' }),
    ])
    const { causes, singles } = groupFailureCauses(groupFailures(o, FIXTURE_NOW))
    expect(causes).toHaveLength(1)
    expect(causes[0]!.step).toBe('Dependency audit')
    expect(causes[0]!.hits).toHaveLength(5)
    expect(causes[0]!.apps.map((a) => a.repo).sort()).toEqual(['kensaurus/glot.it', 'kensaurus/twm', 'kensaurus/yen-yen'])
    expect(singles.some((x) => x.failure.job.id === 'e1')).toBe(true)
    expect(singles.some((x) => x.failure.job.id.startsWith('d'))).toBe(false)
  })

  it('does not group one step that broke a single PR', () => {
    const o = withJobs([failed({ id: 'f1', jobName: 'Security', runId: 80, prNumber: 801, failedStep: 'Dependency audit' })])
    const { causes } = groupFailureCauses(groupFailures(o, FIXTURE_NOW))
    expect(causes.find((c) => c.step === 'Dependency audit')).toBeUndefined()
  })
})
