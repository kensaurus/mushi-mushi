/**
 * One status per scheduled job (round 3, 2026-11-19): intelligence-report read green "success"
 * while Overview said it was overdue, and every job read "0 runs · 100% success · avg 0ms".
 */

import { describe, expect, it } from 'vitest'
import { cronJobState, shortAge } from './cronJobState'

const base = { lastRun: '2026-11-09T06:00:00Z', lastStatus: 'success', successRate: 1, avgDurationMs: 0, runs: 0 }

describe('cronJobState', () => {
  it('is amber "overdue 9d" for a job that succeeded but missed its schedule', () => {
    const s = cronJobState({ ...base, stalenessMinutes: 13523, staleness: 'warn' })
    expect(s).toMatchObject({ tone: 'warn', label: 'overdue 9d', overdue: true, failed: false })
  })

  it('never says a rate over zero runs: the last run only', () => {
    const s = cronJobState({ ...base, stalenessMinutes: 120, staleness: 'ok' })
    expect(s.tone).toBe('ok')
    expect(s.label).toBe('on time')
    expect(s.detail).toBe('Last ran 2h ago')
    expect(s.detail).not.toContain('%')
    expect(s.detail).not.toContain('0 runs')
  })

  it('gives the rate and duration once there are runs in the window', () => {
    const s = cronJobState({ ...base, runs: 12, successRate: 11 / 12, avgDurationMs: 340, stalenessMinutes: 3, staleness: 'ok' })
    expect(s.detail).toBe('Last ran 3m ago · 12 runs · 92% succeeded · avg 340 ms')
  })

  it('is red "failed" when the last run errored, even if late', () => {
    expect(cronJobState({ ...base, lastStatus: 'error', staleness: 'stale', stalenessMinutes: 9000 })).toMatchObject({ tone: 'danger', label: 'failed', failed: true, overdue: false })
  })

  it('is neutral "never run" with no run on record', () => {
    expect(cronJobState(undefined)).toMatchObject({ tone: 'off', label: 'never run', overdue: false })
    expect(cronJobState({ ...base, lastRun: null, lastStatus: null })).toMatchObject({ tone: 'off', label: 'never run' })
  })

  it('writes ages as one short unit', () => {
    expect(shortAge(45)).toBe('45m')
    expect(shortAge(300)).toBe('5h')
    expect(shortAge(13523)).toBe('9d')
  })
})
