/**
 * The Pipeline's machine, lane, run and sign-in states map onto one status
 * system (2026-11-18): a working lane runs, an offline machine is broken, a
 * machine failure is slow (not the code's fault), a revoked machine is struck.
 */
import { describe, expect, it } from 'vitest'
import { hostRunStatus, laneRunStatus, runOutcomeStatus, signInRunStatus } from './pipelineRunStatus'

describe('pipeline run statuses', () => {
  it('lanes', () => {
    expect(laneRunStatus('working')).toBe('running')
    expect(laneRunStatus('paused')).toBe('waiting')
    expect(laneRunStatus('draining')).toBe('slow')
    expect(laneRunStatus('offline')).toBe('failed')
    expect(laneRunStatus('idle')).toBe('idle')
    expect(laneRunStatus('something new')).toBe('idle')
  })

  it('run outcomes', () => {
    expect(runOutcomeStatus('pr_opened')).toBe('passed')
    expect(runOutcomeStatus('failed', 'infra')).toBe('slow')
    expect(runOutcomeStatus('failed', 'code')).toBe('failed')
    expect(runOutcomeStatus('lease_expired')).toBe('slow')
    expect(runOutcomeStatus('stopped')).toBe('cancelled')
    expect(runOutcomeStatus(null)).toBe('idle')
  })

  it('machines and sign-ins', () => {
    expect(hostRunStatus({ online: true })).toBe('passed')
    expect(hostRunStatus({ online: false })).toBe('failed')
    expect(hostRunStatus({ online: true, revoked: true })).toBe('cancelled')
    expect(signInRunStatus('signed_in')).toBe('passed')
    expect(signInRunStatus('link_ready')).toBe('waiting')
    expect(signInRunStatus('signed_out')).toBe('failed')
  })
})
