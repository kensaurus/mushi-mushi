/**
 * The grouping helpers from the 2026-11-18 fresh-eyes pass on /ci: matrix shards fold into one
 * slow-step row, clean GitHub-hosted lanes fold into one timeline row, each app's chip knows where
 * its jobs ran, stopped jobs group by app and PR, advice evidence that only repeats its chips is
 * dropped, the shared "Main delay" is said once, and finished jobs list worst first.
 */
import { describe, expect, it } from 'vitest'
import { appRunsOn, foldGithubLanes, groupInfraFailures, groupSlowSteps } from './ciView'
import { groupCiAdvice, targetTitle } from './ciAdvice'
import type { CiAdvice, CiJob } from './ciTypes'
import { ciOverviewFixture } from '../components/ci/__fixtures__/ciOverview'
import { sharedDelay } from '../components/ci/CiStatusBoard'
import { finishedWorstFirst } from '../components/ci/CiQueueBoard'

const base = ciOverviewFixture().jobs[0]
const job = (over: Partial<CiJob>): CiJob => ({ ...base, ...over })

describe('groupSlowSteps', () => {
  it('folds the shards of one matrix job into one row: slowest time, every run', () => {
    const step = 'Playwright — @pr tier'
    const rows = groupSlowSteps([
      { repo: 'k/tsumagoi', job: 'Browser gates (1/4)', step, p50s: 660, runs: 8 },
      { repo: 'k/tsumagoi', job: 'Browser gates (2/4)', step, p50s: 900, runs: 8 },
      { repo: 'k/tsumagoi', job: 'Static gates', step: 'Static gates', p50s: 880, runs: 12 },
      { repo: 'k/tsumagoi', job: 'Browser gates (3/4)', step, p50s: 540, runs: 8 },
      { repo: 'k/tsumagoi', job: 'Browser gates (4/4)', step, p50s: 600, runs: 8 },
    ])
    expect(rows).toEqual([
      { repo: 'k/tsumagoi', job: 'Browser gates', step, p50s: 900, runs: 32, shards: 4 },
      { repo: 'k/tsumagoi', job: 'Static gates', step: 'Static gates', p50s: 880, runs: 12, shards: 1 },
    ])
  })
})

describe('foldGithubLanes', () => {
  const lane = (id: string, kind: 'github' | 'runner', outcome = 'passed') => ({ id, kind, bars: [{ outcome }] }) as { id: string; kind: 'github' | 'runner'; bars: Array<{ outcome: string }> }
  it('keeps the first clean GitHub lane and every failing one, and folds the rest', () => {
    const lanes = [lane('gh9', 'github', 'code_failure'), lane('aw', 'runner'), lane('gh7', 'github'), lane('gh1', 'github'), lane('gh10', 'github'), lane('gh3', 'github')]
    const { shown, rest } = foldGithubLanes(lanes as never)
    expect((shown as unknown as typeof lanes).map((l) => l.id)).toEqual(['gh9', 'aw', 'gh7'])
    expect((rest as unknown as typeof lanes).map((l) => l.id)).toEqual(['gh1', 'gh10', 'gh3'])
  })

  it('never folds a GitHub lane with a job running now', () => {
    const lanes = [lane('gh1', 'github'), lane('gh2', 'github', 'running'), lane('gh3', 'github'), lane('gh4', 'github'), lane('gh5', 'github', 'waiting')]
    const { shown } = foldGithubLanes(lanes as never)
    expect((shown as unknown as typeof lanes).map((l) => l.id)).toEqual(['gh1', 'gh2', 'gh5'])
  })
  it('folds nothing when it would save fewer than two rows', () => {
    const lanes = [lane('gh1', 'github'), lane('gh2', 'github')]
    expect(foldGithubLanes(lanes as never).rest).toEqual([])
  })
})

describe('appRunsOn', () => {
  it('says each app ran on your machines, GitHub, or both; unknown runners say nothing', () => {
    const map = appRunsOn([
      { projectId: 'a', runnerKind: 'self_hosted' },
      { projectId: 'b', runnerKind: 'github_hosted' },
      { projectId: 'c', runnerKind: 'self_hosted' },
      { projectId: 'c', runnerKind: 'github_hosted' },
      { projectId: 'd', runnerKind: 'unknown' },
    ])
    expect(Object.fromEntries(map)).toEqual({ a: 'own', b: 'github', c: 'both' })
  })
})

describe('groupInfraFailures', () => {
  it('groups stopped jobs by app and PR, newest group first', () => {
    const groups = groupInfraFailures([
      job({ id: '1', repo: 'k/glot.it', prNumber: 1080 }),
      job({ id: '2', repo: 'k/yen-yen', prNumber: 551 }),
      job({ id: '3', repo: 'k/yen-yen', prNumber: 551 }),
      job({ id: '4', repo: 'k/yen-yen', prNumber: null }),
      job({ id: '5', repo: 'k/yen-yen', prNumber: 551 }),
    ])
    expect(groups.map((g) => [g.repo, g.prNumber, g.jobs.map((j) => j.id)])).toEqual([
      ['k/glot.it', 1080, ['1']],
      ['k/yen-yen', 551, ['2', '3', '5']],
      ['k/yen-yen', null, ['4']],
    ])
  })
})

describe('advice evidence that only repeats its chips', () => {
  const T = 'kensaurus/tsumagoi'
  const item = (file: string): CiAdvice => ({
    id: `cancel_superseded:${T}:.github/workflows/${file}`,
    severity: 'medium',
    title: 'Old runs keep going after a new push',
    detail: 'd',
    evidence: `${T}/.github/workflows/${file}: a concurrency group without cancel-in-progress.`,
    fix: 'f',
    repo: T,
  })
  it('flags a list with one line per chip, and moves each line to its chip', () => {
    const [g] = groupCiAdvice([item('deploy.yml'), item('cla.yml')])
    expect(g.evidenceRepeatsTargets).toBe(true)
    expect(targetTitle(g.targets[0], g.evidence)).toBe(`${T}/.github/workflows/deploy.yml: a concurrency group without cancel-in-progress.`)
  })
  it('keeps evidence that says more than the chips', () => {
    const slow: CiAdvice = { id: 'slow_steps', severity: 'low', title: 'Where your CI spends its time', detail: 'd', evidence: `${T} · build · pnpm install: 3 min; ${T} · e2e: 9 min`, fix: 'f', repo: T }
    expect(groupCiAdvice([slow])[0].evidenceRepeatsTargets).toBe(false)
    expect(groupCiAdvice([item('deploy.yml')])[0].evidenceRepeatsTargets).toBe(false)
  })
})

describe('sharedDelay', () => {
  it('names the delay once when every app shares it, otherwise null', () => {
    expect(sharedDelay([{ delay: 'waiting' }, { delay: 'waiting' }, { delay: 'waiting' }])).toBe('waiting')
    expect(sharedDelay([{ delay: 'waiting' }, { delay: null }])).toBeNull()
    expect(sharedDelay([{ delay: 'waiting' }])).toBeNull()
  })
})

describe('finishedWorstFirst', () => {
  it('lists code failures, then stopped, then cancelled, then passes, keeping the order inside each', () => {
    const jobs = [
      job({ id: 'p1', status: 'completed', conclusion: 'success', ciKind: 'passed' }),
      job({ id: 'c1', status: 'completed', conclusion: 'cancelled', ciKind: 'cancelled' }),
      job({ id: 'f1', status: 'completed', conclusion: 'failure', ciKind: 'code_failure' }),
      job({ id: 'p2', status: 'completed', conclusion: 'success', ciKind: 'passed' }),
      job({ id: 'i1', status: 'completed', conclusion: 'failure', ciKind: 'runner_lost' }),
    ]
    expect(finishedWorstFirst(jobs).map((j) => j.id)).toEqual(['f1', 'i1', 'c1', 'p1', 'p2'])
  })
})
