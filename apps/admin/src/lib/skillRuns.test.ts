import { describe, expect, it } from 'vitest'
import { skillRunLine } from './skillRuns'

describe('skillRunLine', () => {
  const base = { round: 2, rounds_max: 3, stop_reason: null, history: [{ round: 1, reportId: 'r1', outcome: 'merged' }] }
  it('says the round and what merged while running', () => {
    expect(skillRunLine({ ...base, status: 'active' })).toBe('Round 2 of 3 · 1 merged')
    expect(skillRunLine({ ...base, status: 'active', round: 0, history: [] })).toBe('Starting: the first round is being filed.')
    expect(skillRunLine({ ...base, status: 'active', stop_reason: 'Will retry: GitHub 502' })).toBe('Round 2 of 3 · 1 merged · Will retry: GitHub 502')
  })
  it('says why a run ended', () => {
    expect(skillRunLine({ ...base, status: 'done', stop_reason: 'The agent found nothing left to change in scope.' })).toBe('Done: The agent found nothing left to change in scope. · 1 merged')
    expect(skillRunLine({ ...base, status: 'stopped', stop_reason: null, history: [] })).toBe('Stopped: Stopped.')
  })
})
