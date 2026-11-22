/** "Show important things first" (2026-11-17): the orderings the CI tables and timeline use. */
import { describe, expect, it } from 'vitest'
import type { CiJobType } from '../../lib/ciTypes'
import { failingFirst } from './CiJobTimes'
import { failingLanesFirst } from './CiTimeline'

const t = (job: string, failRate: number | null): CiJobType => ({
  repo: 'a/b',
  workflow: 'CI',
  job,
  runs: 10,
  durationP50s: 60,
  durationP90s: 90,
  durationMaxS: 120,
  queueP50s: 5,
  codeFailures: failRate ? Math.round(failRate * 10) : 0,
  infraFailures: 0,
  failRate,
  lastRunAt: null,
})

describe('failingFirst', () => {
  it('leads with jobs failing 1 in 5 or more, worst first, and keeps the rest in the given (slowest) order', () => {
    const out = failingFirst([t('slow', 0), t('flaky', 0.1), t('broken', 0.8), t('bad', 0.3), t('unknown', null)])
    expect(out.map((x) => x.job)).toEqual(['broken', 'bad', 'slow', 'flaky', 'unknown'])
  })
})

describe('failingLanesFirst', () => {
  const lane = (id: string, outcomes: string[], unassigned = false) => ({
    id,
    unassigned,
    bars: outcomes.map((outcome) => ({ outcome })),
  })

  it('puts machines with a code failure or a stopped job first and "No runner yet" last', () => {
    const out = failingLanesFirst([
      lane('busy', ['passed', 'passed']),
      lane('none', ['infra'], true),
      lane('broke', ['passed', 'code_failure']),
      lane('quiet', ['cancelled']),
      lane('died', ['infra']),
    ])
    expect(out.map((l) => l.id)).toEqual(['broke', 'died', 'busy', 'quiet', 'none'])
  })

  it('puts machines running or waiting on a job now above everything else', () => {
    const out = failingLanesFirst([
      lane('busy', ['passed']),
      lane('broke', ['code_failure']),
      lane('live', ['passed', 'running']),
      lane('none', ['waiting'], true),
      lane('queued', ['waiting']),
    ])
    expect(out.map((l) => l.id)).toEqual(['live', 'queued', 'broke', 'busy', 'none'])
  })
})
