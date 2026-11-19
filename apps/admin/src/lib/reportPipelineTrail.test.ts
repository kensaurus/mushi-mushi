/**
 * FILE: apps/admin/src/lib/reportPipelineTrail.test.ts
 * PURPOSE: The report page's Pipeline strip helpers: duration words, bar
 *          widths, the one stage called out, the verdict, and what the
 *          callout's button does for each kind of retry.
 */
import { describe, expect, it } from 'vitest'
import { calloutStage, durationBarWidths, durationWords, retryButtonFor, trailIsTriaging, trailVerdict, type TrailStage } from './reportPipelineTrail'

function stage(over: Partial<TrailStage> & Pick<TrailStage, 'id'>): TrailStage {
  return {
    label: over.id,
    state: 'idle',
    startedAt: null,
    endedAt: null,
    durationMs: null,
    problem: null,
    detail: null,
    attempts: null,
    retry: null,
    ...over,
  }
}

const ctx = { dispatchBlocked: false, dispatchReason: null, hasFixActions: true }

describe('durationWords', () => {
  it('reads like a person would say it', () => {
    expect(durationWords(900)).toBe('0.9 s')
    expect(durationWords(42_000)).toBe('42 s')
    expect(durationWords(4 * 60_000)).toBe('4 min')
    expect(durationWords(125 * 60_000)).toBe('2 h 5 min')
    expect(durationWords(3 * 24 * 3600_000)).toBe('3 d')
    expect(durationWords(null)).toBeNull()
    expect(durationWords(-1)).toBeNull()
  })
})

describe('durationBarWidths', () => {
  it('scales against the longest stage, keeps short ones visible and leaves unmeasured ones empty', () => {
    const w = durationBarWidths([{ durationMs: 2_000 }, { durationMs: 3 * 3600_000 }, { durationMs: null }, { durationMs: 0 }])
    expect(w[1]).toBe(100)
    expect(w[0]).toBeGreaterThanOrEqual(6)
    expect(w[2]).toBe(0)
    expect(w[3]).toBe(6)
  })
  it('is all empty when nothing is measured', () => {
    expect(durationBarWidths([{ durationMs: null }, { durationMs: null }])).toEqual([0, 0])
  })
})

describe('calloutStage and trailVerdict', () => {
  it('calls out the first failed stage before a slow one', () => {
    const t = {
      current: 'triage' as const,
      stages: [
        stage({ id: 'received', state: 'passed' }),
        stage({ id: 'triage', label: 'Quick check', state: 'slow', problem: 'Waited 15 min' }),
        stage({ id: 'ci', label: 'CI', state: 'failed', problem: 'Red' }),
      ],
    }
    expect(calloutStage(t)?.id).toBe('ci')
    expect(trailVerdict(t)).toEqual({ status: 'failed', label: 'Failed at CI' })
  })
  it('a slow stage with a reason is "Stuck at"; all passed is Live', () => {
    expect(trailVerdict({ current: 'triage', stages: [stage({ id: 'triage', label: 'Quick check', state: 'slow', problem: 'x' })] })).toEqual({ status: 'slow', label: 'Stuck at Quick check' })
    expect(trailVerdict({ current: null, stages: [stage({ id: 'deploy', state: 'passed' })] })).toEqual({ status: 'passed', label: 'Live' })
  })
  it('names a running stage, and an idle one as next', () => {
    expect(trailVerdict({ current: 'fix', stages: [stage({ id: 'fix', label: 'Fix', state: 'running' })] })).toEqual({ status: 'running', label: 'Fix running' })
    expect(trailVerdict({ current: 'fix', stages: [stage({ id: 'fix', label: 'Fix', state: 'idle' })] })).toEqual({ status: 'idle', label: 'Next: Fix' })
  })
})

describe('retryButtonFor', () => {
  it('triage retries here, enabled or with the server reason', () => {
    expect(retryButtonFor(stage({ id: 'triage', retry: { kind: 'triage', allowed: true, reason: null } }), ctx)).toEqual({ kind: 'triage', label: 'Retry triage', enabled: true, why: null })
    expect(retryButtonFor(stage({ id: 'diagnosis', retry: { kind: 'triage', allowed: false, reason: 'Running now.' } }), ctx)).toEqual({
      kind: 'triage',
      label: 'Re-run diagnosis',
      enabled: false,
      why: 'Running now.',
    })
  })
  it('a failed fix uses the page dispatch gate, with its reason when blocked', () => {
    const s = stage({ id: 'fix', retry: { kind: 'dispatch', allowed: true, reason: null } })
    expect(retryButtonFor(s, ctx)).toMatchObject({ kind: 'dispatch', enabled: true })
    expect(retryButtonFor(s, { ...ctx, dispatchBlocked: true, dispatchReason: 'A fix PR is already open.' })).toMatchObject({ enabled: false, why: 'A fix PR is already open.' })
  })
  it('red CI points at the fix actions bar instead of a second CI repair button', () => {
    const s = stage({ id: 'ci', retry: { kind: 'ci_repair', allowed: true, reason: null } })
    expect(retryButtonFor(s, ctx)).toEqual({ kind: 'jump', label: 'CI repair ↑', to: '#report-fix-actions' })
    expect(retryButtonFor(s, { ...ctx, hasFixActions: false })).toBeNull()
  })
  it('no retry, no button', () => {
    expect(retryButtonFor(stage({ id: 'pr' }), ctx)).toBeNull()
  })
})

describe('trailIsTriaging', () => {
  it('polls only while the quick check or diagnosis is moving', () => {
    expect(trailIsTriaging({ stages: [stage({ id: 'triage', state: 'running' })] })).toBe(true)
    expect(trailIsTriaging({ stages: [stage({ id: 'diagnosis', state: 'waiting' })] })).toBe(true)
    expect(trailIsTriaging({ stages: [stage({ id: 'triage', state: 'failed' }), stage({ id: 'fix', state: 'running' })] })).toBe(false)
    expect(trailIsTriaging(null)).toBe(false)
  })
})
