import { describe, expect, it } from 'vitest'
import { digestBody, formatDigestWeek, insightsTone, showInsightsSnapshot } from './intelligenceView'

describe('digestBody (round-2 sweep 2026-11-18)', () => {
  it('is empty for a digest that is only its own title', () => {
    expect(digestBody('# Weekly digest — kensaur.us\nWeek of 2026-11-02')).toBe('')
    expect(digestBody('Weekly digest — kensaur.us\n\nWeek of 2026-11-02\n')).toBe('')
    expect(digestBody('**Project:** glot.it | **Week of:** 2026-11-02')).toBe('')
  })

  it('keeps the written summary under the title', () => {
    expect(digestBody('# Mushi Mushi Weekly Bug Digest\n\n12 bugs came in; 3 were fixed.')).toBe('12 bugs came in; 3 were fixed.')
  })
})

describe('formatDigestWeek', () => {
  it('names the calendar day of a bare date, in one format', () => {
    expect(formatDigestWeek('2026-11-02')).toBe(new Date(2026, 10, 2).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
    expect(formatDigestWeek(null)).toBeNull()
    expect(formatDigestWeek('nope')).toBeNull()
  })
})

describe('insightsTone', () => {
  const base = { topPriority: 'healthy' as const, pendingFindings: 0, reportCount: 2, daysSinceLastDigest: 3 }
  it('is amber, not green, once the latest summary is over a week old', () => {
    expect(insightsTone(base)).toBe('ok')
    expect(insightsTone({ ...base, daysSinceLastDigest: 9 })).toBe('warn')
    expect(insightsTone({ ...base, topPriority: 'stale_digest' })).toBe('warn')
  })
  it('is red only for a failed latest run, neutral with no summary', () => {
    expect(insightsTone({ ...base, topPriority: 'job_failed', daysSinceLastDigest: 9 })).toBe('danger')
    expect(insightsTone({ ...base, reportCount: 0, daysSinceLastDigest: null })).toBe('neutral')
  })
})

describe('showInsightsSnapshot (round-3 sweep 2026-11-19)', () => {
  it('leaves a stale summary to the amber banner alone', () => {
    expect(showInsightsSnapshot({ topPriority: 'stale_digest' })).toBe(false)
    expect(showInsightsSnapshot({ topPriority: 'healthy' })).toBe(true)
  })
})
