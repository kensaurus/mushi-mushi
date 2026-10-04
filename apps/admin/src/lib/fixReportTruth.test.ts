/**
 * FILE: apps/admin/src/lib/fixReportTruth.test.ts
 * PURPOSE: /fixes reads every attempt against its report's current state.
 *
 * Why (glot.it 2026-10-04): the page showed "Retry 8 failed" and "8 recent
 * fix attempts failed" over 4 reports already fixed by merged PRs 138–141.
 * Rows here mirror what GET /v1/admin/fixes returns for those reports.
 */

import { describe, expect, it } from 'vitest'
import type { FixAttempt } from '../components/fixes/types'
import {
  credentialAdvice,
  failureCause,
  failureHeadline,
  fixCauseLabel,
  fixReportLabel,
  isSuperseded,
  needsAttention,
  openPrReports,
  retryCandidates,
  supersededLabel,
} from './fixReportTruth'

function fix(overrides: Partial<FixAttempt>): FixAttempt {
  return {
    id: 'f',
    report_id: 'r',
    agent: 'claude_code',
    status: 'failed',
    started_at: '2026-10-03T09:00:00Z',
    ...overrides,
  }
}

// glot.it, report 9c848825 (fixed by PR 140) and 030bcf3d (unfixed, OpenAI 401).
const LCP_FAILED = fix({
  id: 'd2e37d24',
  report_id: '9c848825',
  error: 'review_failed: the fix model flagged its own change for human review.',
  report_title: 'Homepage /glot-it/ LCP 6408ms',
  report_status: 'fixed',
  report_fix_state: 'resolved',
  report_fixed_by_pr: 140,
  is_latest_attempt: false,
  retryable: false,
})
const LCP_CLOSED = fix({
  id: '920aaea6',
  report_id: '9c848825',
  status: 'completed',
  pr_url: 'https://github.com/kensaurus/glot.it/pull/137',
  pr_number: 137,
  pr_state: 'closed',
  report_fix_state: 'resolved',
  report_fixed_by_pr: 140,
  is_latest_attempt: false,
  retryable: false,
})
const LCP_MERGED = fix({
  id: '2d7c5a18',
  report_id: '9c848825',
  status: 'completed',
  pr_url: 'https://github.com/kensaurus/glot.it/pull/140',
  pr_number: 140,
  pr_state: 'merged',
  merged_at: '2026-10-03T12:00:00Z',
  report_fix_state: 'resolved',
  report_fixed_by_pr: 140,
  is_latest_attempt: true,
  retryable: false,
})
const AUDIO_SKIPPED = fix({
  id: '68b85f04',
  report_id: '030bcf3d',
  status: 'skipped_no_context',
  failure_category: 'no_relevant_code',
  error: 'RAG embedding call failed (Error: Embedding API error: 401 from api.openai.com)',
  report_title: 'Audio playback is severely degraded',
  report_status: 'classified',
  report_fix_state: 'failed',
  is_latest_attempt: true,
  retryable: false,
  credential_block: { provider: 'openai', keyHealthy: false },
})

describe('glot.it rows', () => {
  const rows = [LCP_FAILED, LCP_CLOSED, LCP_MERGED, AUDIO_SKIPPED]

  it('offers no retry and no open PR for reports a merged PR fixed', () => {
    expect(retryCandidates(rows)).toEqual([])
    expect(openPrReports(rows)).toEqual([])
  })

  it('reads earlier attempts on a fixed report as superseded, never as needing attention', () => {
    expect(isSuperseded(LCP_FAILED)).toBe(true)
    expect(isSuperseded(LCP_CLOSED)).toBe(true)
    expect(isSuperseded(LCP_MERGED)).toBe(false)
    expect(supersededLabel(LCP_FAILED)).toBe(`Superseded — fixed by PR #${140}`)
    expect(rows.filter(needsAttention).map((f) => f.id)).toEqual(['68b85f04'])
  })

  it('points a rejected key at Settings while it is still bad', () => {
    expect(credentialAdvice(AUDIO_SKIPPED)).toMatchObject({
      retryNow: false,
      to: '/settings?tab=byok',
      linkLabel: 'Open Settings → AI keys',
    })
    expect(failureCause(AUDIO_SKIPPED)).toBe('openai_key_rejected')
    expect(fixCauseLabel('openai_key_rejected')).toBe('OpenAI key rejected')
  })

  it('says "the key is fixed now — retry" once a working key is on file', () => {
    const healed = { ...AUDIO_SKIPPED, retryable: true, credential_block: { provider: 'openai', keyHealthy: true } }
    expect(credentialAdvice(healed)).toMatchObject({
      message: 'The OpenAI key is fixed now — retry this fix.',
      retryNow: true,
    })
    expect(retryCandidates([healed, healed]).map((f) => f.report_id)).toEqual(['030bcf3d'])
  })

  it('names the report, never its id', () => {
    expect(fixReportLabel(AUDIO_SKIPPED)).toBe('Audio playback is severely degraded')
    expect(fixReportLabel(fix({ report_title: null }))).toBe('Untitled report')
  })
})

describe('failureHeadline', () => {
  it('maps a known code to plain English and keeps the first line for Details', () => {
    const h = failureHeadline(LCP_FAILED)!
    expect(h.title).toBe('The fix agent was not confident in its own patch.')
    expect(h.firstLine).toBe('review_failed: the fix model flagged its own change for human review.')
  })

  it('shows the error itself when the code is unknown, not "The fix attempt failed."', () => {
    const h = failureHeadline(fix({ error: 'Worker exploded: ENOSPC on /tmp\nstack…' }))!
    expect(h.title).toBe('Worker exploded: ENOSPC on /tmp')
    expect(h.firstLine).toBe('Worker exploded: ENOSPC on /tmp')
  })

  it('recognises the Cursor envVars + agentId rejection', () => {
    const h = failureHeadline(fix({ error: 'Cursor API 400 validation_error: envVars cannot be combined with a client-supplied agentId' }))!
    expect(h.title).toBe('Mushi sent Cursor a field it no longer accepts.')
  })

  it('returns null without an error', () => {
    expect(failureHeadline(fix({ error: undefined }))).toBeNull()
  })
})

describe('rows from an older server (no report fields)', () => {
  it('are never counted or offered for retry', () => {
    const legacy = fix({ status: 'failed' })
    expect(needsAttention(legacy)).toBe(false)
    expect(retryCandidates([legacy])).toEqual([])
    expect(isSuperseded(legacy)).toBe(false)
  })
})
