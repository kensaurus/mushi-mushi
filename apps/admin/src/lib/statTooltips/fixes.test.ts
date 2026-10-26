import { describe, expect, it } from 'vitest'
import { EMPTY_FIXES_STATS, type FixesStats } from '../../components/fixes/FixesStatsTypes'
import { formatFixCauseBreakdown } from '../fixReportTruth'
import { completedDetail, failedDetail, failedTooltip } from './fixes'

const stats = (over: Partial<FixesStats>): FixesStats => ({ ...EMPTY_FIXES_STATS, hasAnyProject: true, ...over })

describe('completedDetail', () => {
  it('names the open PRs instead of "no finished runs" (tsumagoi, 2026-10-20)', () => {
    expect(completedDetail(stats({ completed: 0, failed: 0, prsOpen: 1 }))).toBe('1 PR waiting to merge')
    expect(completedDetail(stats({ completed: 0, failed: 0, prsOpen: 3 }))).toBe('3 PRs waiting to merge')
  })

  it('keeps the fixed-of-finished ratio and the empty state', () => {
    expect(completedDetail(stats({ completed: 2, failed: 1, prsOpen: 4 }))).toBe('2 of 3 reports fixed')
    expect(completedDetail(stats({}))).toBe('no finished runs')
  })
})

describe('failedDetail', () => {
  it('uses the banner cause breakdown instead of the top cause alone', () => {
    const failureBreakdown = [
      { category: 'ci_failed', count: 24 },
      { category: 'needs_human', count: 11 },
      { category: 'sandbox_timeout', count: 7 },
    ]
    const banner = formatFixCauseBreakdown(failureBreakdown)
    expect(banner).toBe('CI failed (24), Needs your decision (11), Ran out of time (7)')
    expect(failedDetail(stats({
      failed: 42,
      topFailureCategory: 'ci_failed',
      topFailureCount: 24,
      failureBreakdown,
    }))).toBe(banner)
  })

  it('names the breakdown as causes in the tooltip, with a trailing period', () => {
    const tip = failedTooltip(stats({
      failed: 35,
      topFailureCategory: 'ci_failed',
      topFailureCount: 24,
      failureBreakdown: [
        { category: 'ci_failed', count: 24 },
        { category: 'needs_human', count: 11 },
      ],
    }))
    const takeaway = tip.sections.find((s) => s.kind === 'takeaway')?.body ?? ''
    expect(takeaway).toContain('Causes: CI failed (24), Needs your decision (11).')
  })

  it('does not caption a mixed total as only the top cause', () => {
    expect(failedDetail(stats({
      failed: 35,
      topFailureCategory: 'ci_failed',
      topFailureCount: 24,
      failureBreakdown: [
        { category: 'ci_failed', count: 24 },
        { category: 'needs_human', count: 11 },
      ],
    }))).not.toBe('CI failed')
  })
})
