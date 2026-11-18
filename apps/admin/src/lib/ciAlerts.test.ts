import { describe, expect, it } from 'vitest'
import { ciOverviewFixture, FIXTURE_NOW } from '../components/ci/__fixtures__/ciOverview'
import type { CiJobType, CiOverview } from './ciTypes'
import { buildCiStatus } from './ciStatus'
import { rankCiAlerts, waitLabels } from './ciAlerts'

const jobType = (over: Partial<CiJobType>): CiJobType => ({
  repo: 'kensaurus/mushi-mushi',
  workflow: 'CI',
  job: 'test',
  runs: 5,
  durationP50s: 300,
  durationP90s: 400,
  durationMaxS: 500,
  queueP50s: 30,
  codeFailures: 0,
  infraFailures: 0,
  failRate: 0,
  lastRunAt: '2026-10-21T10:40:00Z',
  ...over,
})

function rank(o: CiOverview) {
  return rankCiAlerts(o, buildCiStatus(o, FIXTURE_NOW), FIXTURE_NOW)
}

describe('rankCiAlerts', () => {
  it('puts every critical problem before every serious one', () => {
    const alerts = rank(ciOverviewFixture())
    const sev = alerts.map((a) => a.severity)
    expect(sev.length).toBeGreaterThan(1)
    expect(sev.lastIndexOf('critical')).toBeLessThan(sev.indexOf('serious') === -1 ? Infinity : sev.indexOf('serious'))
  })

  it('names a machine that stopped reporting, with how long it has been silent', () => {
    const down = rank(ciOverviewFixture()).find((a) => a.id === 'stale:h-aw')!
    expect(down.severity).toBe('critical')
    expect(down.title).toBe('alienware-wsl stopped reporting')
    // Heartbeat 09:00, now 12:00.
    expect(down.metric).toEqual({ value: '3.0', unit: 'h' })
    // The machine's own key goes last: rows carry runner keys, so those lead the hover.
    expect(down.keys.at(-1)).toBe('machine:alienware-wsl')
  })

  it('flags a job that keeps failing, links its newest failing log, and lights its job and app', () => {
    const o = ciOverviewFixture()
    o.stats.byJob = [jobType({ job: 'test', runs: 4, codeFailures: 3, failRate: 0.75 })]
    o.jobs = o.jobs.map((j) => (j.id === 'j7' ? { ...j, htmlUrl: 'https://github.com/kensaurus/mushi-mushi/actions/runs/7/job/7' } : j))
    const a = rank(o).find((x) => x.id.startsWith('fails:'))!
    expect(a.severity).toBe('critical')
    expect(a.title).toBe('test keeps failing')
    expect(a.detail).toContain('3 of its last 4 runs failed')
    expect(a.metric).toEqual({ value: '75', unit: '% fail' })
    expect(a.href).toBe('https://github.com/kensaurus/mushi-mushi/actions/runs/7/job/7')
    expect(a.keys).toEqual(['job:kensaurus/mushi-mushi|test', 'repo:kensaurus/mushi-mushi'])
  })

  it('does not call a single failure "keeps failing"', () => {
    const o = ciOverviewFixture()
    o.stats.byJob = [jobType({ codeFailures: 1, failRate: 1, runs: 1 })]
    expect(rank(o).some((a) => a.id.startsWith('fails:'))).toBe(false)
  })

  it('grades an app by pass rate: under 70% critical, under 80% serious, 80% and up nothing', () => {
    const o = ciOverviewFixture()
    o.repos = [
      {
        ...o.repos[0]!,
        repo: 'a/low',
        projectName: 'low',
        passRate: 0.6,
        jobs7d: 40,
        queueP95s: 60,
      },
      {
        ...o.repos[0]!,
        repo: 'a/mid',
        projectName: 'mid',
        passRate: 0.75,
        jobs7d: 40,
        queueP95s: 60,
      },
      { ...o.repos[0]!, repo: 'a/ok', projectName: 'ok', passRate: 0.9, jobs7d: 40, queueP95s: 60 },
    ]
    const pass = rank(o).filter((a) => a.id.startsWith('pass:'))
    expect(pass.map((a) => [a.app, a.severity])).toEqual([
      ['low', 'critical'],
      ['mid', 'serious'],
    ])
  })

  it('puts every app that waits long for a machine into ONE "Queue wait" card, a bar per app', () => {
    const o = ciOverviewFixture()
    const r0 = o.repos[0]!
    o.repos = [
      { ...r0, repo: 'a/one', projectName: 'one', passRate: 0.95, queueP95s: 20 * 60 },
      { ...r0, repo: 'a/two', projectName: 'two', passRate: 0.95, queueP95s: 40 * 60 },
      { ...r0, repo: 'a/three', projectName: 'three', passRate: 0.95, queueP95s: 12 * 60 },
      { ...r0, repo: 'a/four', projectName: 'four', passRate: 0.95, queueP95s: 15 * 60 },
      { ...r0, repo: 'a/fine', projectName: 'fine', passRate: 0.95, queueP95s: 60 },
    ]
    const waits = rank(o).filter((a) => a.label === 'Queue wait')
    expect(waits).toHaveLength(1)
    expect(waits[0]!.bars!.map((b) => [b.label, b.display, b.severity])).toEqual([
      ['two', '40 min', 'critical'],
      ['one', '20 min', 'serious'],
      ['four', '15 min', 'serious'],
      ['three', '12 min', 'serious'],
    ])
    expect(waits[0]!.metric).toEqual({ value: '40', unit: 'min' })
    expect(waits[0]!.keys).toHaveLength(4)
  })

  it('groups apps failing often per severity, but keeps a job that keeps failing as its own card with its rate', () => {
    const o = ciOverviewFixture()
    const r0 = o.repos[0]!
    o.repos = ['x', 'y', 'z'].map((n) => ({ ...r0, repo: `a/${n}`, projectName: n, passRate: 0.75, jobs7d: 40, queueP95s: 60 }))
    o.stats.byJob = [jobType({ job: 'Build & Test', codeFailures: 8, failRate: 0.53, runs: 15 })]
    const alerts = rank(o)
    const failing = alerts.filter((a) => a.label === 'Failing often')
    expect(failing).toHaveLength(1)
    expect(failing[0]!.bars).toHaveLength(3)
    const keeps = alerts.find((a) => a.id.startsWith('fails:'))!
    expect(keeps.rate).toBeCloseTo(0.53)
    expect(keeps.metric).toEqual({ value: '53', unit: '% fail' })
  })

  it('counts jobs a test machine stopped as "never finished", not as failures', () => {
    const a = rank(ciOverviewFixture()).find((x) => x.id === 'infra')!
    expect(a.title).toBe('6 jobs never finished')
    expect(a.detail).toContain('Not code failures')
    expect(a.jump).toBe('?view=machines#ci-infra')
  })

  it('says nothing when nothing is wrong', () => {
    const o = ciOverviewFixture({ hosts: [], jobs: [] })
    o.repos = o.repos.map((r) => ({ ...r, passRate: 0.95, queueP95s: 30 }))
    o.stats = { ...o.stats, infraFailures: 0, byJob: [] }
    expect(rank(o)).toEqual([])
  })
})

/** Eight "kensaurus-local" jobs wait; only overseas-ci has the label; two idle machines lack it (live, 2026-11-18). */
function waitingForLocal(): CiOverview {
  const base = ciOverviewFixture()
  const host = (hostId: string, hostname: string) => ({ ...base.hosts[0]!, hostId, hostname, stale: false, runners: [] })
  const tmpl = base.jobs.find((j) => j.id === 'j2')!
  const run = base.jobs.find((j) => j.id === 'j1')!
  const local = ['self-hosted', 'kensaurus-local']
  return {
    ...base,
    hosts: [host('h-os', 'overseas-ci'), host('h-a1', 'alienware-ci'), host('h-a2', 'alienwarex16')],
    runners: [{ ...base.runners[0]!, name: 'aw-glot.it-1', hostId: 'h-os', labels: local }],
    jobs: [
      { ...run, id: 'r1', labels: local, runnerName: 'aw-glot.it-1' },
      ...Array.from({ length: 8 }, (_, i) => ({ ...tmpl, id: `w${i}`, labels: local, createdAt: '2026-10-21T11:45:00Z' })),
    ],
  }
}

describe('the waiting card as label chips (2026-11-18)', () => {
  it('names the needed label, the machine that has it and the idle ones missing it', () => {
    const o = waitingForLocal()
    const status = buildCiStatus(o, FIXTURE_NOW)
    const a = rankCiAlerts(o, status, FIXTURE_NOW).find((x) => x.id === 'waiting')!
    expect(a.title).toBe('8 jobs waiting for a machine')
    expect(a.labels).toEqual({ needs: ['kensaurus-local'], has: ['overseas-ci'], missing: ['alienware-ci', 'alienwarex16'] })
    // The sentence stays, for the screen-reader headline.
    expect(a.detail).toBe(status.waitWhy)
    expect(a.detail).toContain('alienware-ci and alienwarex16 are idle')
    // Pointing at the card lights the machine tiles with (or without) the label.
    expect(a.keys).toContain('label:kensaurus-local')
  })

  it('draws no chips for jobs waiting on GitHub cloud', () => {
    const o = waitingForLocal()
    o.jobs = o.jobs.map((j) => (j.id.startsWith('w') ? { ...j, labels: ['ubuntu-latest'] } : j))
    const status = buildCiStatus(o, FIXTURE_NOW)
    expect(waitLabels(status)).toBeNull()
    const a = rankCiAlerts(o, status, FIXTURE_NOW).find((x) => x.id === 'waiting')!
    expect(a.labels).toBeUndefined()
    expect(a.detail).toBe("They wait for GitHub's cloud (“ubuntu-latest”), not for your machines.")
  })
})
