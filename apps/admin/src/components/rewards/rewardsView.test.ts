/**
 * FILE: apps/admin/src/components/rewards/rewardsView.test.ts
 * PURPOSE: The rules behind what the Rewards tabs may claim (round-2 sweep, 2026-11-18).
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIM_LINES,
  bountyRowState,
  flagLabel,
  knownActionNames,
  listingState,
  points30dCell,
  publishBlockedReason,
  questRowState,
  retentionLift,
  reviewEmptyCopy,
  rewardsPaused,
  tierHoldersLabel,
} from './rewardsView'

const cohort = (count: number, median: number) => ({ count, median_retention_days: median })
const top = (count: number, median: number) => ({ slug: 'champion', display_name: 'Champion', ...cohort(count, median) })

describe('retentionLift', () => {
  it('says not enough data when the others median is 0 days, never +45708510%', () => {
    const lift = retentionLift({ top_tier: top(9, 8), all_others: cohort(830, 0), lift_pct: 45708510 })
    expect(lift.kind).toBe('insufficient')
  })

  it('says not enough data for a tiny cohort, a missing top tier or a null lift', () => {
    expect(retentionLift({ top_tier: top(2, 8), all_others: cohort(830, 4), lift_pct: 100 }).kind).toBe('insufficient')
    expect(retentionLift({ top_tier: top(9, 8), all_others: cohort(3, 4), lift_pct: 100 }).kind).toBe('insufficient')
    expect(retentionLift({ lift_pct: 10 } as never).kind).toBe('insufficient')
    expect(retentionLift(null).kind).toBe('insufficient')
    expect(retentionLift({ top_tier: top(9, 8), all_others: cohort(830, 4), lift_pct: null }).kind).toBe('insufficient')
  })

  it('reports a real lift with its tone and whether it is strong or negative', () => {
    expect(retentionLift({ top_tier: top(9, 8), all_others: cohort(830, 4), lift_pct: 100 })).toEqual({ kind: 'lift', pct: 100, tone: 'ok', strong: true, negative: false })
    expect(retentionLift({ top_tier: top(9, 3), all_others: cohort(830, 4), lift_pct: -25 })).toMatchObject({ tone: 'danger', negative: true, strong: false })
    expect(retentionLift({ top_tier: top(9, 4), all_others: cohort(830, 4), lift_pct: 10 })).toMatchObject({ tone: 'warn', strong: false })
  })
})

describe('points30dCell', () => {
  const now = Date.parse('2026-11-18T00:00:00Z')
  it('marks a 30-day total stale for a tester not seen in 30+ days', () => {
    expect(points30dCell(9777, '2026-06-01T00:00:00Z', now)).toEqual({ kind: 'stale', points: 9777 })
  })
  it('keeps the number for a recent tester, a zero total or an unknown last-seen', () => {
    expect(points30dCell(2830, '2026-11-17T23:00:00Z', now)).toEqual({ kind: 'value', points: 2830 })
    expect(points30dCell(0, '2026-06-01T00:00:00Z', now)).toEqual({ kind: 'value', points: 0 })
    expect(points30dCell(50, null, now)).toEqual({ kind: 'value', points: 50 })
  })
})

describe('labels and states', () => {
  it('says the tier count is capped when it reaches the server row cap', () => {
    expect(tierHoldersLabel(500)).toBe('First 500 tier holders counted')
    expect(tierHoldersLabel(12)).toBe('12 tier holders · all time')
    expect(tierHoldersLabel(1)).toBe('1 tier holder · all time')
  })

  it('humanises anti-fraud flags', () => {
    expect(flagLabel('velocity_anomaly')).toBe('velocity anomaly')
  })

  it('pauses rows only when rewards are off for a picked app on a paid plan', () => {
    expect(rewardsPaused({ entitled: true, projectId: 'p1', projectEnabled: false })).toBe(true)
    expect(rewardsPaused({ entitled: true, projectId: 'p1', projectEnabled: true })).toBe(false)
    expect(rewardsPaused({ entitled: false, projectId: 'p1', projectEnabled: false })).toBe(false)
    expect(rewardsPaused({ entitled: true, projectId: null, projectEnabled: false })).toBe(false)
  })

  it('reads Paused, not On or Active, while rewards are off', () => {
    expect(bountyRowState(true, true)).toEqual({ label: 'Paused', tone: 'paused' })
    expect(bountyRowState(true, false)).toEqual({ label: 'On', tone: 'on' })
    expect(bountyRowState(false, true)).toEqual({ label: 'Off', tone: 'off' })
    expect(questRowState(true, true)).toEqual({ label: 'Paused', tone: 'paused' })
    expect(questRowState(true, false)).toEqual({ label: 'Active', tone: 'on' })
    expect(questRowState(false, false)).toEqual({ label: 'Disabled', tone: 'off' })
  })

  it('gives Publish a reason when it is greyed out', () => {
    expect(publishBlockedReason(false, '')).toBe('Save a draft below first.')
    expect(publishBlockedReason(true, '  ')).toBe('Add an app name first.')
    expect(publishBlockedReason(true, 'Shop')).toBeNull()
  })
})

describe('simulator action names', () => {
  it('starts from the names the feed uses', () => {
    expect(DEFAULT_SIM_LINES.map((l) => l.action)).toContain('report.submitted')
    expect(DEFAULT_SIM_LINES.map((l) => l.action)).not.toContain('report_submit')
  })
  it('suggests rules, then feed actions, then defaults, without repeats', () => {
    const names = knownActionNames([{ action: 'custom_rule' }], [{ action: 'session_minute' }, { action: 'custom_rule' }])
    expect(names.slice(0, 2)).toEqual(['custom_rule', 'session_minute'])
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('report.submitted')
  })
})

describe('tester review copy', () => {
  it('knows whether the listing is live', () => {
    expect(listingState({ visibility: 'public' }, null)).toBe('live')
    expect(listingState({ visibility: 'draft' }, null)).toBe('unpublished')
    expect(listingState(null, null)).toBe('unpublished')
    expect(listingState(undefined, null)).toBe('unknown')
    expect(listingState(null, 'boom')).toBe('unknown')
  })
  it('never tells the Accepted filter to publish the app', () => {
    const accepted = reviewEmptyCopy('accepted', 'unpublished')
    expect(accepted.title).toBe('No accepted submissions yet')
    expect(accepted.description).not.toMatch(/publish/i)
    expect(reviewEmptyCopy('all', 'live').description).not.toMatch(/once your listing is published/)
    expect(reviewEmptyCopy('pending', 'unpublished').description).toMatch(/published/)
  })
})
