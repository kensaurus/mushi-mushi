/**
 * FILE: packages/server/src/__tests__/report-pipeline-trail.test.ts
 * PURPOSE: One report's pipeline trail (_shared/report-pipeline-trail.ts):
 *          which stage it is in, how long each took, the error in plain
 *          words with the raw text screened, which retry each stage offers,
 *          and the report-level triage retry rule. Also the queue job's
 *          entries in the unified timeline.
 */
import { describe, expect, it } from 'vitest'
import {
  buildReportTrail,
  plainTriageError,
  screenDetail,
  triageRetryDecision,
  TRAIL_REPORT_COLUMNS,
  type TrailFixRow,
  type TrailQueueRow,
  type TrailReportRow,
} from '../../supabase/functions/_shared/report-pipeline-trail.ts'
import { queueJobTimelineEntries } from '../../supabase/functions/_shared/unified-timeline.ts'

const NOW = new Date('2026-11-19T12:00:00Z')
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

function report(over: Partial<TrailReportRow> = {}): TrailReportRow {
  return {
    id: 'r1',
    status: 'new',
    created_at: minsAgo(60),
    processing_error: null,
    processing_attempts: 0,
    stage1_classification: null,
    stage1_latency_ms: null,
    stage2_analysis: null,
    stage2_latency_ms: null,
    ...over,
  }
}

function job(over: Partial<TrailQueueRow> = {}): TrailQueueRow {
  return {
    id: 'q1',
    stage: 'stage1',
    status: 'pending',
    attempts: 0,
    max_attempts: 3,
    last_error: null,
    scheduled_at: minsAgo(60),
    created_at: minsAgo(60),
    started_at: null,
    completed_at: null,
    ...over,
  }
}

function fix(over: Partial<TrailFixRow> = {}): TrailFixRow {
  return {
    id: 'f1',
    status: 'completed',
    agent: 'cursor_cloud',
    error: null,
    failure_category: null,
    pr_url: 'https://github.com/o/r/pull/7',
    pr_number: 7,
    pr_state: 'open',
    check_run_status: 'completed',
    check_run_conclusion: 'success',
    check_run_updated_at: minsAgo(10),
    created_at: minsAgo(40),
    started_at: minsAgo(40),
    completed_at: minsAgo(30),
    merged_at: null,
    ...over,
  }
}

const stage = (t: ReturnType<typeof buildReportTrail>, id: string) => t.stages.find((s) => s.id === id)!

describe('buildReportTrail', () => {
  it('names the failed quick check in plain words, keeps the raw text screened, and offers a retry', () => {
    const t = buildReportTrail({
      report: report(),
      queue: [job({ status: 'failed', attempts: 2, last_error: 'Stage 1 failed: 401 {"error":"bad key sk-live1234567890abcdef"}', completed_at: minsAgo(55) })],
      fix: null,
      deploys: [],
      now: NOW,
    })
    const triage = stage(t, 'triage')
    expect(triage.state).toBe('failed')
    expect(triage.problem).toBe('The AI key or the internal worker token was refused.')
    expect(triage.detail).toContain('sk-[redacted]')
    expect(triage.detail).not.toContain('sk-live1234567890abcdef')
    expect(triage.attempts).toEqual({ used: 2, max: 3 })
    expect(triage.retry).toEqual({ kind: 'triage', allowed: true, reason: null })
    expect(triage.durationMs).toBe(5 * 60_000)
    expect(t.failing).toBe('triage')
    expect(t.current).toBe('triage')
    // Later stages have not started.
    expect(stage(t, 'diagnosis').state).toBe('idle')
    expect(stage(t, 'fix').state).toBe('idle')
    expect(t.jobs[0]!.lastError).toContain('sk-[redacted]')
  })

  it('a fresh pending job is waiting, with no retry offered; a stuck one is slow with a retry', () => {
    const fresh = buildReportTrail({ report: report({ created_at: minsAgo(2) }), queue: [job({ created_at: minsAgo(2), scheduled_at: minsAgo(2) })], fix: null, deploys: [], now: NOW })
    expect(stage(fresh, 'triage').state).toBe('waiting')
    expect(stage(fresh, 'triage').retry).toBeNull()

    const stuck = buildReportTrail({ report: report(), queue: [job({ status: 'processing', started_at: minsAgo(30) })], fix: null, deploys: [], now: NOW })
    expect(stage(stuck, 'triage').state).toBe('slow')
    expect(stage(stuck, 'triage').retry?.allowed).toBe(true)
  })

  it('a classified report with a failed stage-2 handoff fails at Diagnosis, not the quick check', () => {
    const t = buildReportTrail({
      report: report({ status: 'new', stage1_classification: { category: 'bug' }, stage1_latency_ms: 1800, processing_error: 'stage2 handoff failed: HTTP 504' }),
      queue: [job({ status: 'completed', completed_at: minsAgo(58) })],
      fix: null,
      deploys: [],
      now: NOW,
    })
    expect(stage(t, 'triage')).toMatchObject({ state: 'passed', durationMs: 1800 })
    expect(stage(t, 'diagnosis')).toMatchObject({ state: 'failed', problem: 'The quick check worked, but handing the report to the full diagnosis failed.' })
    expect(stage(t, 'diagnosis').retry?.allowed).toBe(true)
  })

  it('walks a merged fix to Live when a healthy deploy is seen after the merge', () => {
    const t = buildReportTrail({
      report: report({ status: 'fixed', stage1_classification: {}, stage2_analysis: {}, stage1_latency_ms: 900, stage2_latency_ms: 4000 }),
      queue: [job({ status: 'completed', completed_at: minsAgo(59) })],
      fix: fix({ merged_at: minsAgo(8), pr_state: 'merged' }),
      deploys: [{ observed_at: minsAgo(20), observed_version: 'v1', ok: true }, { observed_at: minsAgo(3), observed_version: 'v2', ok: true }],
      now: NOW,
    })
    expect(t.stages.map((s) => s.state)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed'])
    expect(stage(t, 'deploy')).toMatchObject({ endedAt: minsAgo(3), durationMs: 5 * 60_000 })
    expect(t.current).toBeNull()
    expect(t.failing).toBeNull()
  })

  it('red CI fails the CI stage and offers a CI repair; a failed fix offers a dispatch retry', () => {
    const red = buildReportTrail({
      report: report({ stage1_classification: {}, stage2_analysis: {} }),
      queue: [],
      fix: fix({ check_run_conclusion: 'failure' }),
      deploys: [],
      now: NOW,
    })
    expect(stage(red, 'ci')).toMatchObject({ state: 'failed', retry: { kind: 'ci_repair', allowed: true, reason: null } })
    expect(stage(red, 'merge').state).toBe('idle')

    const failed = buildReportTrail({
      report: report({ stage1_classification: {}, stage2_analysis: {} }),
      queue: [],
      fix: fix({ status: 'failed', pr_url: null, error: 'Agent found nothing to change', failure_category: 'already_fixed', check_run_conclusion: null }),
      deploys: [],
      now: NOW,
    })
    expect(stage(failed, 'fix').state).toBe('failed')
    // "Already fixed" reaches the same answer on a retry: offered disabled, with what to do instead.
    expect(stage(failed, 'fix').retry).toMatchObject({ kind: 'dispatch', allowed: false })
    expect(stage(failed, 'fix').retry?.reason).toMatch(/mark the report fixed/)

    const flaky = buildReportTrail({
      report: report({ stage1_classification: {}, stage2_analysis: {} }),
      queue: [],
      fix: fix({ status: 'failed', pr_url: null, error: 'something odd happened', check_run_conclusion: null }),
      deploys: [],
      now: NOW,
    })
    expect(stage(flaky, 'fix').retry).toEqual({ kind: 'dispatch', allowed: true, reason: null })
    expect(stage(failed, 'pr').state).toBe('idle')
  })

  it('an unclassified report with an error on it fails the quick check, even when its job says completed', () => {
    const t = buildReportTrail({
      report: report({ processing_error: 'schema mismatch' }),
      queue: [job({ status: 'completed', completed_at: minsAgo(58) })],
      fix: null,
      deploys: [],
      now: NOW,
    })
    expect(stage(t, 'triage')).toMatchObject({ state: 'failed', detail: 'schema mismatch', retry: { kind: 'triage', allowed: true } })
    expect(t.failing).toBe('triage')
  })

  it('a confident quick check needs no diagnosis: skipped, not stuck, and no retry', () => {
    const t = buildReportTrail({
      report: report({ status: 'classified', stage1_classification: { category: 'bug' }, stage1_latency_ms: 700 }),
      queue: [job({ status: 'completed', completed_at: minsAgo(59) })],
      fix: null,
      deploys: [],
      now: NOW,
    })
    expect(stage(t, 'diagnosis')).toMatchObject({ state: 'idle', skipped: true, retry: null })
    expect(stage(t, 'diagnosis').note).toMatch(/Not needed/)
    expect(t.current).toBe('fix')
  })

  it('a report a person sorted (or one with only a stage-2 diagnosis) is not stuck in triage', () => {
    const byHand = buildReportTrail({ report: report({ status: 'fixing' }), queue: [], fix: null, deploys: [], now: NOW })
    expect(stage(byHand, 'triage')).toMatchObject({ state: 'idle', skipped: true, retry: null })
    expect(stage(byHand, 'diagnosis')).toMatchObject({ skipped: true })
    const deepOnly = buildReportTrail({ report: report({ status: 'new', stage2_analysis: { rootCause: 'x' } }), queue: [], fix: null, deploys: [], now: NOW })
    expect(stage(deepOnly, 'triage').state).toBe('passed')
    expect(stage(deepOnly, 'diagnosis').state).toBe('passed')
  })

  it('a used-up diagnosis quota fails Diagnosis with the way out, and its retry is refused', () => {
    const t = buildReportTrail({ report: report({ status: 'quota_exceeded', stage1_classification: {} }), queue: [job({ status: 'completed' })], fix: null, deploys: [], now: NOW })
    expect(stage(t, 'diagnosis')).toMatchObject({ state: 'failed', retry: { kind: 'triage', allowed: false } })
    expect(stage(t, 'diagnosis').problem).toMatch(/Billing/)
  })

  it('skipped CI is not green', () => {
    const t = buildReportTrail({ report: report({ stage1_classification: {}, stage2_analysis: {} }), queue: [], fix: fix({ check_run_conclusion: 'skipped' }), deploys: [], now: NOW })
    expect(stage(t, 'ci').state).toBe('waiting')
    expect(stage(t, 'merge').state).toBe('idle')
  })

  it('reads no classified_at (reports has no such column)', () => {
    expect(TRAIL_REPORT_COLUMNS).not.toContain('classified_at')
    expect(TRAIL_REPORT_COLUMNS).toContain('stage1_latency_ms')
  })
})

describe('triageRetryDecision', () => {
  it('refuses a diagnosed report', () => {
    expect(triageRetryDecision(report({ stage1_classification: {}, stage2_analysis: {} }), [job({ status: 'completed' })], NOW.getTime()).kind).toBe('deny')
  })
  it('refuses a report already triaged, by the pipeline or by hand, so a severity set by hand is never overwritten', () => {
    for (const status of ['classified', 'fixing', 'fixed', 'dismissed', 'dispatched']) {
      expect(triageRetryDecision(report({ status }), [], NOW.getTime()).kind).toBe('deny')
    }
    expect(triageRetryDecision(report({ stage2_analysis: {} }), [], NOW.getTime()).kind).toBe('deny')
    expect(triageRetryDecision(report({ status: 'quota_exceeded', stage1_classification: {} }), [], NOW.getTime()).kind).toBe('deny')
  })
  it('says already running for a fresh job', () => {
    expect(triageRetryDecision(report(), [job({ status: 'processing', started_at: minsAgo(3) })], NOW.getTime()).kind).toBe('already')
  })
  it('retries a failed or dead-letter job, a stuck one, and a completed job whose diagnosis failed', () => {
    expect(triageRetryDecision(report(), [job({ status: 'dead_letter' })], NOW.getTime()).kind).toBe('retry')
    expect(triageRetryDecision(report(), [job({ status: 'pending', scheduled_at: minsAgo(20) })], NOW.getTime()).kind).toBe('retry')
    expect(
      triageRetryDecision(report({ stage1_classification: {}, processing_error: 'stage2 handoff failed: HTTP 500' }), [job({ status: 'completed', completed_at: minsAgo(50) })], NOW.getTime()).kind,
    ).toBe('retry')
  })
  it('gives a diagnosis that is still on its way 15 minutes', () => {
    expect(triageRetryDecision(report({ stage1_classification: {} }), [job({ status: 'completed', completed_at: minsAgo(4) })], NOW.getTime()).kind).toBe('already')
    expect(triageRetryDecision(report({ stage1_classification: {} }), [job({ status: 'completed', completed_at: minsAgo(40) })], NOW.getTime()).kind).toBe('retry')
  })
  it('retries a report that never got a job', () => {
    const d = triageRetryDecision(report(), [], NOW.getTime())
    expect(d).toEqual({ kind: 'retry', job: null })
  })
})

describe('plain words', () => {
  it('maps common triage failures', () => {
    expect(plainTriageError('Stage 1 failed: 402 insufficient_quota')).toBe('The AI budget or quota is used up, so triage stopped.')
    expect(plainTriageError('Stage 1 failed: 429 Too Many Requests')).toBe('The AI provider asked Mushi Mushi to slow down (rate limit).')
    expect(plainTriageError('AbortError: The operation was aborted due to timeout')).toBe('Triage took too long and was stopped.')
    expect(plainTriageError('Stage 1 failed: 500 Internal Server Error')).toBe('The triage worker crashed on this report.')
    expect(plainTriageError('TypeError: fetch failed')).toBe('Mushi Mushi could not reach its triage worker.')
    expect(plainTriageError('weird')).toBe('Triage failed for a reason Mushi Mushi does not recognise yet.')
    expect(plainTriageError(null)).toBeNull()
  })
  it('screens and cuts raw text', () => {
    expect(screenDetail('Authorization: Bearer abcdefghijklmnop')).toContain('[redacted]')
    expect(screenDetail('x'.repeat(2000))!.length).toBeLessThanOrEqual(601)
    expect(screenDetail('  ')).toBeNull()
  })
})

describe('queueJobTimelineEntries', () => {
  it('adds the queued entry and the failure with the plain error first', () => {
    const entries = queueJobTimelineEntries(job({ status: 'failed', attempts: 1, last_error: 'Stage 1 failed: 503 upstream', completed_at: minsAgo(50) }))
    expect(entries.map((e) => e.lane)).toEqual(['pipeline', 'pipeline'])
    expect(entries[0]!.title).toBe('Queued for a quick check')
    expect(entries[1]!.title).toBe('Quick check failed · attempt 1 of 3')
    expect(entries[1]!.body?.split('\n')[0]).toBe('The triage worker crashed on this report.')
    expect(entries[1]!.at).toBe(minsAgo(50))
  })
  it('a pending job has only its queued entry', () => {
    expect(queueJobTimelineEntries(job())).toHaveLength(1)
  })
})
