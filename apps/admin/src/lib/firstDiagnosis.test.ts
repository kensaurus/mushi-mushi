/**
 * FILE: apps/admin/src/lib/firstDiagnosis.test.ts
 * PURPOSE: Pin the first-diagnosis polling state machine — every phase the
 *          onboarding S2 screen can show, and the transitions between them.
 */

import { describe, expect, it } from 'vitest'
import {
  FIRST_DIAGNOSIS_INITIAL,
  FIRST_DIAGNOSIS_POLL_TIMEOUT_MS,
  firstDiagnosisCopy,
  isPolling,
  readReport,
  reduceFirstDiagnosis,
  toDiagnosis,
  trackedReportId,
  type FirstDiagnosisState,
  type PolledReport,
} from './firstDiagnosis'

const T0 = 1_700_000_000_000

function queued(): FirstDiagnosisState {
  const sending = reduceFirstDiagnosis(FIRST_DIAGNOSIS_INITIAL, { type: 'send' })
  return reduceFirstDiagnosis(sending, { type: 'send_ok', reportId: 'r1', at: T0 })
}

describe('readReport', () => {
  it('treats a bare row as queued and a stage-1 row as classifying', () => {
    expect(readReport({ id: 'r1', status: 'new' }).kind).toBe('queued')
    expect(readReport({ id: 'r1', status: 'new', stage1_classification: { category: 'bug' } }).kind).toBe('classifying')
  })

  it('is diagnosed once summary, severity, or stage2_analysis lands', () => {
    expect(readReport({ id: 'r1', summary: 'Login button dead on iPad Safari' }).kind).toBe('diagnosed')
    expect(readReport({ id: 'r1', severity: 'high' }).kind).toBe('diagnosed')
    expect(readReport({ id: 'r1', stage2_analysis: { rootCause: 'touchstart swallowed' } }).kind).toBe('diagnosed')
    // Category alone comes from the reporter at ingest — not proof of classification.
    expect(readReport({ id: 'r1', category: 'ui' }).kind).toBe('queued')
  })

  it('maps quota and failure rows', () => {
    expect(readReport({ id: 'r1', status: 'quota_exceeded' }).kind).toBe('quota_exhausted')
    expect(readReport({ id: 'r1', status: 'error', processing_error: 'boom' })).toEqual({
      kind: 'classifier_failed',
      message: 'boom',
    })
    expect(readReport({ id: 'r1', status: 'new', processing_error: '  timeout ' })).toEqual({
      kind: 'classifier_failed',
      message: 'timeout',
    })
  })

  it('prefers a friendly title, falls back to summary, and reads the root cause under any spelling', () => {
    const base: PolledReport = { id: 'r1', summary: 'Tap handler never fires', severity: 'high', category: 'ui' }
    expect(toDiagnosis(base).title).toBe('Tap handler never fires')
    expect(toDiagnosis({ ...base, title: 'Login button does nothing on iPad' }).title).toBe(
      'Login button does nothing on iPad',
    )
    expect(toDiagnosis({ ...base, stage2_analysis: { root_cause: 'pointer-events: none' } }).rootCause).toBe(
      'pointer-events: none',
    )
    expect(toDiagnosis({ ...base, stage2_analysis: { rootCause: 'stale listener' } }).rootCause).toBe(
      'stale listener',
    )
    expect(toDiagnosis({ id: 'r1' }).title).toBe('Diagnosis ready')
  })
})

describe('reduceFirstDiagnosis', () => {
  it('walks idle → sending → queued → classifying → diagnosed', () => {
    const q = queued()
    expect(q.phase).toBe('queued')
    expect(isPolling(q)).toBe(true)
    expect(trackedReportId(q)).toBe('r1')

    const c = reduceFirstDiagnosis(q, {
      type: 'poll_ok',
      report: { id: 'r1', stage1_classification: {} },
      at: T0 + 2_000,
    })
    expect(c.phase).toBe('classifying')
    expect((c as { polls: number }).polls).toBe(1)

    const d = reduceFirstDiagnosis(c, {
      type: 'poll_ok',
      report: { id: 'r1', summary: 'Broken', severity: 'medium' },
      at: T0 + 4_000,
    })
    expect(d.phase).toBe('diagnosed')
    if (d.phase === 'diagnosed') {
      expect(d.diagnosis.reportId).toBe('r1')
      expect(d.diagnosis.severity).toBe('medium')
    }
  })

  it('times out after the poll budget and can resume with keep_waiting', () => {
    const q = queued()
    const late = reduceFirstDiagnosis(q, {
      type: 'poll_ok',
      report: { id: 'r1' },
      at: T0 + FIRST_DIAGNOSIS_POLL_TIMEOUT_MS,
    })
    expect(late.phase).toBe('timed_out')
    const resumed = reduceFirstDiagnosis(late, { type: 'keep_waiting', at: T0 + 100_000 })
    expect(resumed).toEqual({ phase: 'classifying', reportId: 'r1', startedAt: T0 + 100_000, polls: 0 })
  })

  it('surfaces quota exhaustion from the send and from the poll', () => {
    const sending = reduceFirstDiagnosis(FIRST_DIAGNOSIS_INITIAL, { type: 'send' })
    const fromSend = reduceFirstDiagnosis(sending, {
      type: 'send_failed',
      code: 'feature_not_in_plan',
      message: 'Upgrade',
    })
    expect(fromSend).toEqual({ phase: 'quota_exhausted', reportId: null, message: 'Upgrade' })

    const fromPoll = reduceFirstDiagnosis(queued(), {
      type: 'poll_ok',
      report: { id: 'r1', status: 'quota_exceeded' },
      at: T0 + 2_000,
    })
    expect(fromPoll.phase).toBe('quota_exhausted')
    expect(trackedReportId(fromPoll)).toBe('r1')
  })

  it('surfaces classifier failure and lets the user keep waiting on the same report', () => {
    const failed = reduceFirstDiagnosis(queued(), {
      type: 'poll_ok',
      report: { id: 'r1', status: 'error', processing_error: 'LLM 500' },
      at: T0 + 2_000,
    })
    expect(failed).toEqual({ phase: 'classifier_failed', reportId: 'r1', message: 'LLM 500' })
    const again = reduceFirstDiagnosis(failed, { type: 'keep_waiting', at: T0 + 5_000 })
    expect(again.phase).toBe('classifying')
  })

  it('parks polling while offline and resumes with a fresh budget', () => {
    const q = queued()
    const off = reduceFirstDiagnosis(q, { type: 'went_offline' })
    expect(off).toEqual({ phase: 'offline', reportId: 'r1', resume: 'queued' })
    const on = reduceFirstDiagnosis(off, { type: 'back_online', at: T0 + 60_000 })
    expect(on).toEqual({ phase: 'queued', reportId: 'r1', startedAt: T0 + 60_000, polls: 0 })

    const offNoReport = reduceFirstDiagnosis(
      reduceFirstDiagnosis(FIRST_DIAGNOSIS_INITIAL, { type: 'send' }),
      { type: 'send_failed', code: 'NETWORK_ERROR', message: 'Failed to fetch' },
    )
    expect(offNoReport).toEqual({ phase: 'offline', reportId: null, resume: null })
    expect(reduceFirstDiagnosis(offNoReport, { type: 'back_online', at: T0 })).toEqual({ phase: 'idle' })
  })

  it('keeps polling through transient poll errors and ignores stray events', () => {
    const q = queued()
    const bumped = reduceFirstDiagnosis(q, {
      type: 'poll_failed',
      code: 'INTERNAL',
      message: '500',
      at: T0 + 2_000,
    })
    expect(bumped).toEqual({ phase: 'queued', reportId: 'r1', startedAt: T0, polls: 1 })
    // A poll result arriving after diagnosis must not regress the screen.
    const d = reduceFirstDiagnosis(q, {
      type: 'poll_ok',
      report: { id: 'r1', summary: 'x' },
      at: T0 + 2_000,
    })
    expect(reduceFirstDiagnosis(d, { type: 'poll_ok', report: { id: 'r1' }, at: T0 + 4_000 })).toBe(d)
    expect(reduceFirstDiagnosis(FIRST_DIAGNOSIS_INITIAL, { type: 'send_ok', reportId: 'r9', at: T0 })).toBe(
      FIRST_DIAGNOSIS_INITIAL,
    )
  })

  it('has copy for every non-idle phase', () => {
    const phases: FirstDiagnosisState[] = [
      { phase: 'sending' },
      { phase: 'queued', reportId: 'r1', startedAt: T0, polls: 0 },
      { phase: 'classifying', reportId: 'r1', startedAt: T0, polls: 1 },
      { phase: 'diagnosed', reportId: 'r1', diagnosis: toDiagnosis({ id: 'r1', summary: 's' }) },
      { phase: 'quota_exhausted', reportId: null, message: 'q' },
      { phase: 'classifier_failed', reportId: 'r1', message: 'f' },
      { phase: 'offline', reportId: null, resume: null },
      { phase: 'timed_out', reportId: 'r1' },
      { phase: 'send_failed', code: 'X', message: 'm' },
    ]
    for (const state of phases) {
      const copy = firstDiagnosisCopy(state)
      expect(copy, state.phase).not.toBeNull()
      expect(copy!.headline.length).toBeGreaterThan(0)
    }
    expect(firstDiagnosisCopy(FIRST_DIAGNOSIS_INITIAL)).toBeNull()
  })
})
