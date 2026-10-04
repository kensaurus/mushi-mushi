/**
 * FILE: packages/server/src/__tests__/fix-report-truth.test.ts
 * PURPOSE: Regression guard for glot.it 2026-10-04. Fix counts were built
 *          from attempts, so 4 reports fixed by merged PRs read "8 auto-fixes
 *          failed / OPEN PRS 7 / Retry 8 failed". Counts are now per report
 *          and from the report's current state; the dispatch guard refuses
 *          to re-run a fixed or dismissed report.
 */
import { describe, expect, it } from 'vitest'

import {
  credentialFailureProvider,
  deriveReportFixTruth,
  deriveReportFixTruths,
  fixDispatchResolvedBlock,
  summarizeFixTruths,
  type TruthAttempt,
  type TruthReport,
} from '../../supabase/functions/_shared/fix-report-truth.ts'
import { failedFixPreviews, reportTitle } from '../../supabase/functions/_shared/fix-report-truth-load.ts'
import { GLOT_ATTEMPTS, GLOT_REPORT_IDS, GLOT_REPORTS } from './fixtures/glot-fix-attempts.ts'

const reportsById = new Map<string, TruthReport>(GLOT_REPORTS.map((r) => [r.id, r]))

describe('glot.it 2026-10-04 (real rows)', () => {
  it('counts 0 open PRs, 4 fixed and 1 report needing attention (the skipped one)', () => {
    const truths = deriveReportFixTruths({ attempts: GLOT_ATTEMPTS, reportsById })
    const s = summarizeFixTruths(truths.values())
    expect(s).toMatchObject({ reports: 5, fixed: 4, prOpen: 0, inFlight: 0, failed: 1 })
    // The old attempt-level numbers the console showed.
    expect(GLOT_ATTEMPTS.filter((a) => a.status === 'failed')).toHaveLength(8)
  })

  it('never offers a fixed report for retry, and points the 401 at the key, not Retry', () => {
    const truths = deriveReportFixTruths({
      attempts: GLOT_ATTEMPTS,
      reportsById,
      checkedKeyProviders: new Set(['openai']),
    })
    const s = summarizeFixTruths(truths.values())
    expect(s.retryable).toBe(0)
    const audio = truths.get(GLOT_REPORT_IDS.R_AUDIO)!
    expect(audio.state).toBe('failed')
    expect(audio.credential).toEqual({ provider: 'openai', keyHealthy: false })
    expect(audio.failureBucket).toBe('openai_key_rejected')
    for (const id of [GLOT_REPORT_IDS.R_SKIP, GLOT_REPORT_IDS.R_FETCH, GLOT_REPORT_IDS.R_LCP, GLOT_REPORT_IDS.R_CLS]) {
      expect(truths.get(id)!.state).toBe('resolved')
      expect(truths.get(id)!.retryable).toBe(false)
    }
    expect(truths.get(GLOT_REPORT_IDS.R_SKIP)!.mergedPrNumber).toBe(141)
  })

  it('makes the 401 report retryable once a working OpenAI key is on file', () => {
    const truths = deriveReportFixTruths({
      attempts: GLOT_ATTEMPTS,
      reportsById,
      healthyKeyProviders: new Set(['openai']),
      checkedKeyProviders: new Set(['openai']),
    })
    const audio = truths.get(GLOT_REPORT_IDS.R_AUDIO)!
    expect(audio.credential).toEqual({ provider: 'openai', keyHealthy: true })
    expect(audio.retryable).toBe(true)
    expect(summarizeFixTruths(truths.values()).retryable).toBe(1)
  })

  it('says "not checked yet" when no key row exists for the provider', () => {
    const truths = deriveReportFixTruths({ attempts: GLOT_ATTEMPTS, reportsById })
    expect(truths.get(GLOT_REPORT_IDS.R_AUDIO)!.credential).toEqual({ provider: 'openai', keyHealthy: null })
    expect(truths.get(GLOT_REPORT_IDS.R_AUDIO)!.retryable).toBe(false)
  })

  it('refuses to dispatch any of the 4 fixed reports, naming the merged PR', () => {
    const byReport = (id: string) => GLOT_ATTEMPTS.filter((a) => a.report_id === id)
    expect(fixDispatchResolvedBlock(reportsById.get(GLOT_REPORT_IDS.R_LCP)!, byReport(GLOT_REPORT_IDS.R_LCP))).toEqual({
      code: 'ALREADY_FIXED',
      message: 'Already fixed by PR #140 — reopen the report to dispatch again.',
    })
    expect(fixDispatchResolvedBlock(reportsById.get(GLOT_REPORT_IDS.R_AUDIO)!, byReport(GLOT_REPORT_IDS.R_AUDIO))).toBeNull()
  })

  it('previews only the unfixed report, with its title', () => {
    const truths = deriveReportFixTruths({ attempts: GLOT_ATTEMPTS, reportsById })
    const loaded = {
      truths,
      reports: new Map(GLOT_REPORTS.map((r) => [r.id, { ...r, project_id: 'p1', summary: `Title ${r.id.slice(0, 4)}` }])),
      attemptsByReport: new Map<string, TruthAttempt[]>(),
    }
    for (const a of GLOT_ATTEMPTS) {
      loaded.attemptsByReport.set(a.report_id, [...(loaded.attemptsByReport.get(a.report_id) ?? []), a])
    }
    const previews = failedFixPreviews(loaded, { projectId: 'p1' })
    expect(previews).toHaveLength(1)
    expect(previews[0]).toMatchObject({ report_id: GLOT_REPORT_IDS.R_AUDIO, id: '68b85f04', report_title: 'Title 030b' })
    expect(previews[0].error_head).toContain('401')
  })
})

describe('deriveReportFixTruth precedence', () => {
  const base = { id: 'a', report_id: 'r', created_at: '2026-10-01T00:00:00Z' }

  it('a live attempt is in flight even after an earlier failure', () => {
    const t = deriveReportFixTruth({
      reportId: 'r',
      report: { id: 'r', status: 'fixing' },
      attempts: [
        { ...base, id: 'old', status: 'failed' },
        { ...base, id: 'new', status: 'running', created_at: '2026-10-02T00:00:00Z' },
      ],
    })
    expect(t.state).toBe('in_flight')
  })

  it('an open PR is pr_open, a closed one on the latest attempt is failed but not retryable', () => {
    const open = deriveReportFixTruth({
      reportId: 'r',
      report: { id: 'r', status: 'fixing' },
      attempts: [{ ...base, status: 'completed', pr_url: 'u', pr_number: 3, pr_state: 'open' }],
    })
    expect(open.state).toBe('pr_open')
    const closed = deriveReportFixTruth({
      reportId: 'r',
      report: { id: 'r', status: 'classified' },
      attempts: [{ ...base, status: 'completed', pr_url: 'u', pr_number: 3, pr_state: 'closed' }],
    })
    expect(closed).toMatchObject({ state: 'failed', retryable: false, failureBucket: 'pr_closed_unmerged' })
  })

  it('a plain failed latest attempt on an unfixed report is retryable', () => {
    const t = deriveReportFixTruth({
      reportId: 'r',
      report: { id: 'r', status: 'classified' },
      attempts: [{ ...base, status: 'failed', error: 'review_failed: flagged for human review' }],
    })
    expect(t).toMatchObject({ state: 'failed', retryable: true, credential: null })
  })

  it('a dismissed report never counts, and a reopened one ignores its old merge', () => {
    const merged = { ...base, status: 'completed', pr_url: 'u', pr_number: 9, pr_state: 'merged', merged_at: 'x' }
    expect(deriveReportFixTruth({ reportId: 'r', report: { id: 'r', status: 'dismissed' }, attempts: [{ ...base, status: 'failed' }] }).state).toBe('resolved')
    expect(deriveReportFixTruth({ reportId: 'r', report: { id: 'r', status: 'reopened' }, attempts: [merged] }).state).toBe('none')
    expect(fixDispatchResolvedBlock({ id: 'r', status: 'reopened' }, [merged])).toBeNull()
    expect(fixDispatchResolvedBlock({ id: 'r', status: 'dismissed' }, [])).toMatchObject({ code: 'REPORT_DISMISSED' })
    expect(fixDispatchResolvedBlock({ id: 'r', status: 'fixed' }, [])).toEqual({
      code: 'ALREADY_FIXED',
      message: 'Already fixed — reopen the report to dispatch again.',
    })
  })
})

describe('credentialFailureProvider', () => {
  it.each([
    ['Embedding API error: 401 from api.openai.com', null, 'openai'],
    ['claude_code_agent requires an Anthropic API key', null, 'anthropic'],
    ['Cursor API error 401: unauthorized', null, 'cursor'],
    ['GitHub 401 Bad credentials', null, 'github'],
    ['Cursor API 400 validation_error: envVars cannot be combined', null, null],
    ['review_failed: the fix model flagged its own change', null, null],
  ] as const)('%s → %s', (error, category, expected) => {
    expect(credentialFailureProvider(error, category)).toBe(expected)
  })
})

describe('reportTitle', () => {
  it('prefers the summary, else trims the description', () => {
    expect(reportTitle({ summary: '  Audio breaks ', description: 'x' })).toBe('Audio breaks')
    expect(reportTitle({ summary: null, description: 'a'.repeat(90) })).toBe(`${'a'.repeat(80)}…`)
    expect(reportTitle(null)).toBeNull()
  })
})
