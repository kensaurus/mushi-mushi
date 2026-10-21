import { describe, expect, it } from 'vitest'
import {
  CI_OUTCOME_META,
  NO_RUNNER_LANE,
  buildCiQueue,
  buildCiTimeline,
  ciActivity,
  ciOutcomeCounts,
  ciVerdict,
  buildFixLinks,
  runnerDisplayName,
  formatSeconds,
  isCiOverviewEmpty,
  jobElapsedSeconds,
  jobOutcome,
  machineLabel,
  permissionsNotice,
  queuePositionForPr,
  queuePositionLine,
  recentInfraFailures,
  repoFromPrUrl,
  slowestJobs,
  timelinePct,
  waitingHint,
} from './ciView'
import type { CiJob } from './ciTypes'
import { FIXTURE_JOBS, FIXTURE_NOW, ciOverviewFixture, emptyCiOverview } from '../components/ci/__fixtures__/ciOverview'

const byId = (id: string) => FIXTURE_JOBS.find((j) => j.id === id)!
const HOUR = 60 * 60 * 1000

describe('formatSeconds', () => {
  it('reads seconds, minutes and hours in plain words', () => {
    expect(formatSeconds(45)).toBe('45 s')
    expect(formatSeconds(720)).toBe('12 min')
    expect(formatSeconds(3900)).toBe('1 h 5 min')
    expect(formatSeconds(7200)).toBe('2 h')
    expect(formatSeconds(null)).toBe('—')
  })
})

describe('jobOutcome', () => {
  it('trusts the GitHub status for live jobs and the verdict for finished ones', () => {
    expect(jobOutcome(byId('j2'))).toBe('waiting')
    expect(jobOutcome(byId('j1'))).toBe('running')
    expect(jobOutcome(byId('j5'))).toBe('passed')
    expect(jobOutcome(byId('j6'))).toBe('infra')
    expect(jobOutcome(byId('j8'))).toBe('infra')
    expect(jobOutcome(byId('j7'))).toBe('code_failure')
    expect(jobOutcome(byId('j9'))).toBe('cancelled')
    expect(jobOutcome({ status: 'pending', ciKind: 'queued' })).toBe('waiting')
  })

  it('gives every outcome a label and a non-colour glyph', () => {
    for (const meta of Object.values(CI_OUTCOME_META)) {
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.glyph.length).toBeGreaterThan(0)
    }
    expect(new Set(Object.values(CI_OUTCOME_META).map((m) => m.glyph)).size).toBe(Object.keys(CI_OUTCOME_META).length)
  })
})

describe('machine labels', () => {
  it('skips the labels every self-hosted runner has', () => {
    expect(machineLabel(byId('j2'))).toBe('nuc')
    expect(machineLabel({ labels: ['self-hosted', 'Linux', 'X64'] })).toBeNull()
  })

  it('names the machine a waiting job wants, else says no machine is free', () => {
    expect(waitingHint(byId('j2'))).toBe('waiting for a machine labelled nuc')
    expect(waitingHint({ labels: ['self-hosted'], ciKind: 'waiting_for_runner', runnerName: null })).toBe('no free test machine')
    expect(waitingHint({ labels: ['self-hosted'], ciKind: 'queued', runnerName: null })).toBeNull()
  })
})

describe('buildCiQueue', () => {
  const q = buildCiQueue(FIXTURE_JOBS, FIXTURE_NOW)

  it('lists waiting jobs oldest first', () => {
    expect(q.waiting.map((j) => j.id)).toEqual(['j2', 'j3', 'j4'])
  })

  it('lists running jobs', () => {
    expect(q.running.map((j) => j.id)).toEqual(['j1'])
  })

  it('keeps the last 2 hours of finished jobs, newest first', () => {
    // j9 finished at 09:05, three hours before now: out of the window.
    expect(q.finished.map((j) => j.id)).toEqual(['j6', 'j5', 'j8', 'j7'])
  })

  it('measures wait for waiting jobs and run time for running ones', () => {
    expect(jobElapsedSeconds(byId('j2'), FIXTURE_NOW)).toBe(30 * 60)
    expect(jobElapsedSeconds(byId('j1'), FIXTURE_NOW)).toBe(8 * 60)
    expect(jobElapsedSeconds(byId('j5'), FIXTURE_NOW)).toBeNull()
  })
})

describe('queuePositionForPr', () => {
  it('counts the jobs waiting for the same machine label, oldest first', () => {
    const pos = queuePositionForPr(FIXTURE_JOBS, { repo: 'kensaurus/glot.it', prNumber: 143 }, FIXTURE_NOW)
    expect(pos).toMatchObject({ position: 2, total: 2, label: 'nuc', jobId: 'j3', waitedSeconds: 300 })
    expect(queuePositionLine(pos!, 'kensaurus/glot.it')).toBe(
      'Position 2 of 2 in the queue for machines labelled nuc (waiting 5 min).',
    )
  })

  it('falls back to the repo when the job asked for no named machine', () => {
    const jobs: CiJob[] = [
      { ...byId('j3'), id: 'a', labels: ['self-hosted'], createdAt: '2026-10-21T11:40:00Z', prNumber: 1 },
      { ...byId('j3'), id: 'b', labels: ['self-hosted'], createdAt: '2026-10-21T11:50:00Z', prNumber: 2 },
    ]
    const pos = queuePositionForPr(jobs, { repo: 'kensaurus/glot.it', prNumber: 2 }, FIXTURE_NOW)!
    expect(pos).toMatchObject({ position: 2, total: 2, label: null })
    expect(queuePositionLine(pos, 'kensaurus/glot.it')).toContain("kensaurus/glot.it's test machines")
  })

  it('is null when the PR has nothing waiting', () => {
    expect(queuePositionForPr(FIXTURE_JOBS, { repo: 'kensaurus/glot.it', prNumber: 141 }, FIXTURE_NOW)).toBeNull()
  })

  it('reads the repo from a PR URL', () => {
    expect(repoFromPrUrl('https://github.com/kensaurus/glot.it/pull/143')).toBe('kensaurus/glot.it')
    expect(repoFromPrUrl('https://example.com')).toBeNull()
  })
})

describe('buildCiTimeline', () => {
  const tl = buildCiTimeline(FIXTURE_JOBS, { now: FIXTURE_NOW, windowMs: 2 * HOUR })

  it('spans the window ending now', () => {
    expect(tl.to).toBe(FIXTURE_NOW)
    expect(tl.from).toBe(FIXTURE_NOW - 2 * HOUR)
  })

  it('puts the busiest runner first and "No runner yet" last', () => {
    const labels = tl.lanes.map((l) => l.label)
    expect(labels[0]).toBe('nuc-glot')
    expect(labels[labels.length - 1]).toBe(NO_RUNNER_LANE)
    expect(tl.lanes.at(-1)!.unassigned).toBe(true)
  })

  it('splits a job into a wait segment and a run segment', () => {
    const bar = tl.lanes.find((l) => l.label === 'nuc-glot')!.bars.find((b) => b.jobId === 'j6')!
    expect(bar.queue).toEqual({ start: Date.parse('2026-10-21T11:04:00Z'), end: Date.parse('2026-10-21T11:05:00Z') })
    expect(bar.run).toEqual({ start: Date.parse('2026-10-21T11:05:00Z'), end: Date.parse('2026-10-21T11:20:00Z') })
    expect(bar.waitSeconds).toBe(60)
    expect(bar.runSeconds).toBe(900)
    expect(bar.memPeakMb).toBe(10100)
    expect(bar.outcome).toBe('infra')
  })

  it('runs a running bar to now', () => {
    const bar = tl.lanes.find((l) => l.label === 'nuc-glot')!.bars.find((b) => b.jobId === 'j1')!
    expect(bar.run!.end).toBe(FIXTURE_NOW)
    expect(bar.runSeconds).toBe(8 * 60)
  })

  it('draws a waiting job as wait only, up to now, in "No runner yet"', () => {
    const none = tl.lanes.at(-1)!
    const bar = none.bars.find((b) => b.jobId === 'j2')!
    expect(bar.run).toBeNull()
    expect(bar.queue).toEqual({ start: Date.parse('2026-10-21T11:30:00Z'), end: FIXTURE_NOW })
  })

  it('clips a wait that began before the window', () => {
    const bar = tl.lanes.at(-1)!.bars.find((b) => b.jobId === 'j8')!
    expect(bar.queue!.start).toBe(tl.from)
    expect(bar.queue!.end).toBe(Date.parse('2026-10-21T11:00:00Z'))
    expect(bar.waitSeconds).toBe(86400)
  })

  it('leaves out jobs that ended before the window', () => {
    const ids = tl.lanes.flatMap((l) => l.bars.map((b) => b.jobId))
    expect(ids).not.toContain('j9')
    expect(buildCiTimeline(FIXTURE_JOBS, { now: FIXTURE_NOW, windowMs: 24 * HOUR }).lanes.flatMap((l) => l.bars.map((b) => b.jobId))).toContain('j9')
  })

  it('maps times to percentages of the window', () => {
    expect(timelinePct(tl.from, tl)).toBe(0)
    expect(timelinePct(tl.to, tl)).toBe(100)
    expect(timelinePct(tl.from + HOUR, tl)).toBe(50)
    expect(timelinePct(tl.to + HOUR, tl)).toBe(100)
  })
})

describe('overview helpers', () => {
  it('knows an empty overview', () => {
    expect(isCiOverviewEmpty(emptyCiOverview())).toBe(true)
    expect(isCiOverviewEmpty(ciOverviewFixture())).toBe(false)
  })

  it('lists the slowest finished jobs and recent infra failures', () => {
    expect(slowestJobs(FIXTURE_JOBS, 2).map((j) => j.id)).toEqual(['j6', 'j7'])
    expect(recentInfraFailures(FIXTURE_JOBS).map((j) => j.id)).toEqual(['j6', 'j8'])
  })

  it('explains a missing GitHub permission', () => {
    expect(permissionsNotice({ jobs: 'ok', runners: 'ok' })).toBeNull()
    expect(permissionsNotice({ jobs: 'ok', runners: 'missing' })).toContain('Administration: read')
    expect(permissionsNotice({ jobs: 'missing', runners: 'missing' })).toContain('Actions: read')
  })
})

describe('ciActivity', () => {
  it('buckets finished jobs by UTC day and outcome, oldest day first', () => {
    const a = ciActivity(FIXTURE_JOBS, FIXTURE_NOW)
    expect(a.days).toHaveLength(7)
    expect(a.days[0].day).toBe('2026-10-15')
    expect(a.days[6]).toEqual({ day: '2026-10-21', covered: true, passed: 1, failed: 1, infra: 2, other: 1 })
    expect(a.finished).toBe(5)
  })

  it('reads pass rate from passed vs failed only, and medians from finished jobs', () => {
    const a = ciActivity(FIXTURE_JOBS, FIXTURE_NOW)
    expect(a.passRate).toBe(0.5)
    expect(a.waitP50s).toBe(60)
    expect(a.runP50s).toBe(540)
    expect(a.memPeakMb).toBe(10100)
  })

  it('takes the last job time from live jobs too, and drops jobs older than the window', () => {
    const old: CiJob = { ...byId('j5'), id: 'old', createdAt: '2026-10-10T10:00:00Z', startedAt: '2026-10-10T10:01:00Z', completedAt: '2026-10-10T10:09:00Z' }
    const a = ciActivity([...FIXTURE_JOBS, old], FIXTURE_NOW)
    expect(a.lastJobAt).toBe('2026-10-21T11:58:00Z')
    expect(a.finished).toBe(5)
  })

  it('is empty for no jobs', () => {
    const a = ciActivity([], FIXTURE_NOW)
    expect(a).toMatchObject({ finished: 0, passRate: null, waitP50s: null, runP50s: null, memPeakMb: null, lastJobAt: null })
  })
})

describe('GitHub-hosted runners in the timeline and labels', () => {
  const gh = (id: string, start: string, end: string): CiJob => ({
    ...byId('j5'),
    id,
    runnerName: `GitHub Actions ${id}`,
    createdAt: start,
    startedAt: start,
    completedAt: end,
  })

  it('packs GitHub jobs into one lane per job running at once, never one per VM id', () => {
    const jobs = [
      gh('a', '2026-10-21T11:00:00Z', '2026-10-21T11:10:00Z'),
      gh('b', '2026-10-21T11:05:00Z', '2026-10-21T11:15:00Z'),
      gh('c', '2026-10-21T11:12:00Z', '2026-10-21T11:20:00Z'),
    ]
    const t = buildCiTimeline(jobs, { now: FIXTURE_NOW, windowMs: 2 * HOUR })
    expect(t.lanes.map((l) => l.label).sort()).toEqual(['GitHub-hosted 1', 'GitHub-hosted 2'])
    expect(t.lanes.flatMap((l) => l.bars)).toHaveLength(3)
    expect(t.lanes.some((l) => l.label.includes('GitHub Actions'))).toBe(false)
  })

  it('names a single GitHub lane without a number', () => {
    const t = buildCiTimeline([gh('a', '2026-10-21T11:00:00Z', '2026-10-21T11:10:00Z')], { now: FIXTURE_NOW, windowMs: 2 * HOUR })
    expect(t.lanes.map((l) => l.label)).toEqual(['GitHub-hosted'])
  })

  it('calls a GitHub runner "a GitHub-hosted machine", and keeps self-hosted names', () => {
    expect(runnerDisplayName({ runnerName: 'GitHub Actions 1000079285', runnerKind: 'github_hosted' })).toBe('a GitHub-hosted machine')
    expect(runnerDisplayName({ runnerName: 'alienware-glot-1', runnerKind: 'self_hosted' })).toBe('alienware-glot-1')
  })

  it('marks days older than the oldest job held as no data', () => {
    const a = ciActivity(FIXTURE_JOBS, FIXTURE_NOW, 7, Date.parse('2026-10-20T11:00:00Z'))
    expect(a.days.map((d) => d.covered)).toEqual([false, false, false, false, false, true, true])
  })
})

describe('summary: outcome counts and verdict', () => {
  it('derives passed jobs from the pass rate over passed + failed + stopped', () => {
    // 40 passed, 10 code failures, 50 stopped: rate 0.4.
    expect(ciOutcomeCounts({ jobs: 110, passRate: 0.4, codeFailures: 10, infraFailures: 50 })).toEqual({
      passed: 40,
      codeFailures: 10,
      infra: 50,
      other: 10,
      total: 110,
    })
    expect(ciOutcomeCounts({ jobs: 12, passRate: 1, codeFailures: 0, infraFailures: 0 }).passed).toBe(12)
    expect(ciOutcomeCounts({ jobs: 0, passRate: null, codeFailures: 0, infraFailures: 0 }).total).toBe(0)
  })

  it('leads with a long wait, then machine trouble, then code failures, else healthy', () => {
    const o = ciOverviewFixture()
    // j2 has waited 30 min in the fixture.
    expect(ciVerdict(o, FIXTURE_NOW)).toMatchObject({ tone: 'warn', headline: expect.stringContaining('waiting for a test machine') })
    const noQueue = { ...o, jobs: o.jobs.filter((j) => jobOutcome(j) !== 'waiting') }
    expect(ciVerdict({ ...noQueue, stats: { ...o.stats, infraFailures: 5, codeFailures: 2 } }, FIXTURE_NOW).headline).toBe('Most failures are the test machine, not your code.')
    expect(ciVerdict({ ...noQueue, stats: { ...o.stats, infraFailures: 1, codeFailures: 3 } }, FIXTURE_NOW).headline).toContain('3 jobs failed on the code')
    expect(ciVerdict({ ...noQueue, stats: { ...o.stats, infraFailures: 0, codeFailures: 0, passRate: 1 } }, FIXTURE_NOW).tone).toBe('ok')
  })

  it('links a CI job to its report and fix attempt', () => {
    const links = buildFixLinks([{ id: 'f1', report_id: 'r1', pr_url: 'https://github.com/Owner/Repo/pull/7', pr_number: 7 }])
    expect(links.get('owner/repo#7')).toEqual({ reportId: 'r1', fixId: 'f1' })
  })
})
