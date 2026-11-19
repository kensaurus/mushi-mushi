/**
 * FILE: apps/admin/src/lib/judgeReview.test.ts
 * PURPOSE: Triage grading as a review queue (2026-11-19): the lead's "Review N" count, and the
 *          PATCH bodies behind "Accept grader's view" / "Keep diagnosis".
 */

import { describe, expect, it } from 'vitest'
import { EMPTY_JUDGE_STATS, type JudgeStats } from '../components/judge/JudgeStatsTypes'
import { firstSentence, judgeLead, patchWords, reviewBody } from './judgeReview'
import { unreviewedFirst } from '../components/judge/JudgeReviewRows'

const stats = (over: Partial<JudgeStats>): JudgeStats => ({
  ...EMPTY_JUDGE_STATS,
  hasAnyProject: true,
  totalEvaluations: 40,
  disagreementCount: 9,
  recentWindowDays: 14,
  recentEvaluations: 12,
  recentDisagreements: 7,
  ...over,
})

describe('judgeLead', () => {
  it('asks to review the disagreements nobody reviewed yet', () => {
    const lead = judgeLead(stats({ recentToReview: 7 }))
    expect(lead.toReview).toBe(7)
    expect(lead.agreementPct).toBe(42)
    expect(lead.tone).toBe('danger')
    expect(lead.sentence).toBe('7 of 12 diagnoses in the last 14 days disagreed with the grader. Review them before merging those fixes.')
  })

  it('falls back to the disagreement count when the server does not count reviews', () => {
    expect(judgeLead(stats({})).toReview).toBe(7)
  })

  it('never asks for more reviews than there are disagreements', () => {
    expect(judgeLead(stats({ recentToReview: 50 })).toReview).toBe(7)
  })

  it('is ok with no review owed, and says when the grader agreed with everything', () => {
    expect(judgeLead(stats({ recentToReview: 0 })).tone).toBe('ok')
    const agreed = judgeLead(stats({ recentDisagreements: 0, recentToReview: 0 }))
    expect(agreed.sentence).toBe('The grader agreed with all 12 diagnoses in the last 14 days.')
    expect(agreed.agreementPct).toBe(100)
  })

  it('has no review button before anything is graded', () => {
    const lead = judgeLead({ ...EMPTY_JUDGE_STATS, hasAnyProject: true, ungradedReports: 3 })
    expect(lead.toReview).toBe(0)
    expect(lead.agreementPct).toBeNull()
    expect(lead.sentence).toBe('Nothing graded yet; 3 diagnosed reports are ready.')
  })

  it('is amber, not red, while agreement is between 60% and the target', () => {
    expect(judgeLead(stats({ recentEvaluations: 10, recentDisagreements: 3 })).tone).toBe('warn')
  })
})

describe('reviewBody', () => {
  const row = { report_category: 'bug', grader_patch: { severity: 'high' }, reviewed: false, judge_reasoning: null }

  it('accepts the grader view with the category kept, so the row counts as reviewed', () => {
    expect(reviewBody(row, 'accept')).toEqual({ severity: 'high', category: 'bug', note: "Accepted the grader's view: Severity → high." })
    expect(reviewBody({ ...row, grader_patch: { category: 'visual' } }, 'accept')).toMatchObject({ category: 'visual' })
  })

  it('keeps the diagnosis by confirming the current category, with a note', () => {
    expect(reviewBody(row, 'keep')).toEqual({ category: 'bug', note: 'Kept the diagnosis after the grader disagreed.' })
  })

  it('offers nothing for a reviewed row, a row with no category, or an older server', () => {
    expect(reviewBody({ ...row, reviewed: true }, 'accept')).toBeNull()
    expect(reviewBody({ ...row, reviewed: true }, 'keep')).toBeNull()
    expect(reviewBody({ ...row, report_category: null }, 'keep')).toBeNull()
    expect(reviewBody({ ...row, report_category: null }, 'accept')).toBeNull()
    expect(reviewBody({ judge_reasoning: 'x' }, 'keep')).toBeNull()
    expect(reviewBody({ ...row, grader_patch: null }, 'accept')).toBeNull()
    expect(reviewBody({ ...row, grader_patch: {} }, 'accept')).toBeNull()
  })
})

describe('patchWords and firstSentence', () => {
  it('names each change in plain words', () => {
    expect(patchWords({ category: 'visual', severity: 'high', component: 'Cart' })).toBe('Category → visual · Severity → high · Area → Cart')
    expect(patchWords(null)).toBe('')
  })

  it('cuts the grader reason to its first sentence', () => {
    expect(firstSentence('The crash is in checkout, not auth. The stack trace names CartService.')).toBe('The crash is in checkout, not auth.')
    expect(firstSentence('   ')).toBeNull()
  })
})

describe('unreviewedFirst', () => {
  it('puts rows still waiting for a decision first and keeps their order', () => {
    const rows = [{ id: 'a', reviewed: true }, { id: 'b', reviewed: false }, { id: 'c' }, { id: 'd', reviewed: true }]
    expect(unreviewedFirst(rows).map((r) => r.id)).toEqual(['b', 'c', 'a', 'd'])
  })
})
