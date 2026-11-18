/**
 * FILE: apps/admin/src/lib/pipelineSignals.test.ts
 * PURPOSE: Only the jam takes a colour on /pipeline; the age bar adds up to the stuck work
 * (server buckets first, listed items as the fallback, the backlog apart); and each group's
 * one button never closes anything by default.
 */

import { describe, expect, it } from 'vitest'
import type { PipelineGroup, PipelineItem, PipelineStage } from './pipeline'
import { groupPrimary, needYouAges, needsYouCount, needsYouGroups, primaryAction, stageTones, stuckAges } from './pipelineSignals'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

const item = (id: string, over: Partial<PipelineItem> = {}): PipelineItem => ({
  id,
  projectId: 'p1',
  reportId: `r-${id}`,
  title: id,
  repo: 'o/r',
  prNumber: 1,
  prUrl: 'https://github.com/o/r/pull/1',
  queueId: null,
  since: ago(1),
  lastError: null,
  lastEventAt: null,
  lastEventLabel: null,
  failingChecks: [],
  review: null,
  queueDetail: null,
  ...over,
})

const group = (over: Partial<PipelineGroup>): PipelineGroup => ({
  id: 'g',
  stage: 'ci',
  tone: 'stuck',
  label: 'g',
  count: 1,
  oldestAt: null,
  actions: [],
  settings: null,
  items: [],
  ...over,
})

const stage = (id: PipelineStage['id'], stuck: number, groups: PipelineGroup[] = []): PipelineStage => ({ id, label: id, count: stuck, stuck, oldestAt: null, groups })

describe('stageTones', () => {
  it('colours only the bottleneck and at most one runner-up holding at least half as much', () => {
    const tones = stageTones([stage('reported', 1), stage('triaged', 900), stage('pr', 12), stage('review', 6), stage('ci', 6), stage('train', 1), stage('merged', 0)])
    expect(tones).toEqual({ pr: 'danger', review: 'warn' })
    // Single-digit counts must not paint most of the bar: 2, 2, 1 colours two stages, not three.
    expect(stageTones([stage('pr', 2), stage('review', 1), stage('ci', 2)])).toEqual({ pr: 'danger', ci: 'warn' })
    expect(stageTones([stage('pr', 12), stage('review', 5)])).toEqual({ pr: 'danger' })
  })

  it('never colours the triaged backlog, and colours nothing when nothing needs you', () => {
    expect(stageTones([stage('triaged', 900), stage('pr', 0)])).toEqual({})
    expect(stageTones([stage('triaged', 900), stage('ci', 1)])).toEqual({ ci: 'danger' })
  })
})

describe('stuckAges', () => {
  it('uses the server buckets, falls back to listed items, and keeps the backlog apart', () => {
    const stages = [
      stage('triaged', 40, [group({ stage: 'triaged', count: 40, ages: [0, 10, 20, 10] })]),
      stage('pr', 150, [group({ stage: 'pr', count: 150, ages: [100, 30, 15, 5], items: [item('a')] })]),
      stage('ci', 3, [group({ count: 3, items: [item('b', { since: ago(1) }), item('c', { since: ago(5) }), item('d', { since: ago(45) })] })]),
      stage('train', 0, [group({ stage: 'train', tone: 'moving', count: 9, ages: [9, 0, 0, 0] })]),
    ]
    const { needYou, waiting, unaged } = stuckAges(stages, NOW)
    expect(needYou).toEqual([101, 31, 15, 6])
    expect(needYou.reduce((a, b) => a + b, 0)).toBe(150 + 3)
    expect(waiting).toEqual([0, 10, 20, 10])
    expect(unaged).toEqual({ needYou: 0, waiting: 0 })
  })

  it('counts a group with no ages and a cut list (intake: one item per app, counting reports) apart, never bucketed wrong', () => {
    const stages = [
      stage('reported', 37, [group({ stage: 'reported', id: 'intake_rejected', count: 37, items: [item('intake:p1', { since: ago(100) })] })]),
      stage('ci', 1, [group({ count: 1, items: [item('b', { since: ago(1) })] })]),
    ]
    const { needYou, unaged, unlisted } = stuckAges(stages, NOW)
    expect(needYou).toEqual([1, 0, 0, 0])
    expect(unaged.needYou).toBe(37)
    expect(unlisted.needYou).toBe(0)
  })

  it('buckets the triaged backlog ("Waiting for a fix") from the server ages, by the same time the stage card reads', () => {
    // 765 reports triaged over 3 days ago; the server lists the oldest 100 and buckets all 765.
    const listed = Array.from({ length: 100 }, (_, i) => item(`r${i}`, { prUrl: null, prNumber: null, since: ago(58 - i * 0.3) }))
    const stages = [stage('triaged', 765, [group({ stage: 'triaged', id: 'no_fix_old', count: 765, oldestAt: ago(58), items: listed, ages: [0, 300, 400, 65] })])]
    const { waiting, needYou, unaged, unlisted } = stuckAges(stages, NOW)
    expect(waiting).toEqual([0, 300, 400, 65])
    expect(waiting.reduce((a, b) => a + b, 0)).toBe(765)
    expect(needYou).toEqual([0, 0, 0, 0])
    expect(unaged).toEqual({ needYou: 0, waiting: 0 })
    expect(unlisted).toEqual({ needYou: 0, waiting: 0 })
  })

  it('a cut triaged list from a server without ages: buckets the listed oldest, counts the rest as unlisted, never "no time in a stage"', () => {
    // Live preview of #1166: "0–3 d 0 … + 765 with no time in a stage" beside "765 waiting over 3 days, oldest 58 d".
    const listed = [
      ...Array.from({ length: 60 }, (_, i) => item(`old${i}`, { prUrl: null, since: ago(58 - i * 0.1) })),
      ...Array.from({ length: 40 }, (_, i) => item(`mid${i}`, { prUrl: null, since: ago(20 - i * 0.1) })),
    ]
    const stages = [stage('triaged', 765, [group({ stage: 'triaged', id: 'no_fix_old', count: 765, oldestAt: ago(58), items: listed })])]
    const { waiting, unaged, unlisted } = stuckAges(stages, NOW)
    expect(waiting).toEqual([0, 0, 40, 60])
    expect(unlisted.waiting).toBe(665)
    expect(unaged.waiting).toBe(0)
    expect(waiting.reduce((a, b) => a + b, 0) + unlisted.waiting).toBe(765)
  })
})

describe('primaryAction', () => {
  it('picks the first action that can run and closes nothing', () => {
    expect(primaryAction(['close', 'mark_ready'], [item('a')])).toBe('mark_ready')
    expect(primaryAction(['ci_repair', 'rerun_ci'], [item('a', { blocked: { ci_repair: 'no' } })])).toBe('rerun_ci')
  })

  it('shows a refused non-closing action (disabled) before a closing one, and a lone close stays the button', () => {
    expect(primaryAction(['ci_repair', 'close'], [item('a', { blocked: { ci_repair: 'no' } })])).toBe('ci_repair')
    expect(primaryAction(['dismiss'], [item('a')])).toBe('dismiss')
    expect(primaryAction([], [item('a')])).toBeNull()
  })

  it('the status line runs a group primary only when the server would take it', () => {
    expect(groupPrimary({ actions: ['ci_repair', 'rerun_ci'], items: [item('a'), item('b')] })).toEqual({ action: 'ci_repair', ids: ['a', 'b'] })
    expect(groupPrimary({ actions: ['ci_repair', 'close'], items: [item('a', { blocked: { ci_repair: 'no' } })] })).toBeNull()
  })
})

describe('needsYouCount (one source with Home "Needs you")', () => {
  // Round-2 review 2026-11-18: /pipeline said "Nothing needs you now" (0) while it listed
  // "2 reports: triaged over 3 days ago, no fix started" and Home's Needs you listed that group.
  it('counts every stuck group, the triaged backlog included, and splits out what failed', () => {
    const stages = [
      stage('triaged', 2, [group({ stage: 'triaged', id: 'no_fix_old', count: 2 }), group({ stage: 'triaged', id: 'fresh', tone: 'moving', count: 2 })]),
      stage('pr', 0, [group({ stage: 'pr', id: 'empty', count: 0 })]),
    ]
    expect(needsYouCount(stages)).toEqual({ total: 2, backlog: 2, failing: 0 })
    expect(needsYouGroups(stages).map((g) => g.id)).toEqual(['no_fix_old'])
  })

  it('orders groups biggest first and counts failing work apart from the backlog', () => {
    const stages = [
      stage('triaged', 770, [group({ stage: 'triaged', id: 'no_fix_old', count: 770 })]),
      stage('pr', 42, [group({ stage: 'pr', id: 'agent_failed_person', count: 42 }), group({ stage: 'pr', id: 'agent_failed', count: 40 })]),
    ]
    expect(needsYouCount(stages)).toEqual({ total: 852, backlog: 770, failing: 82 })
    expect(needsYouGroups(stages).map((g) => g.id)).toEqual(['no_fix_old', 'agent_failed_person', 'agent_failed'])
  })

  it('folds the backlog into the one "Need you" age row so the bar adds up to the same total', () => {
    const stages = [
      stage('triaged', 40, [group({ stage: 'triaged', count: 40, ages: [0, 10, 20, 10] })]),
      stage('ci', 3, [group({ count: 3, ages: [1, 1, 1, 0] })]),
    ]
    const merged = needYouAges(stuckAges(stages, NOW))
    expect(merged.needYou).toEqual([1, 11, 21, 10])
    expect(merged.waiting).toEqual([0, 0, 0, 0])
    expect(merged.needYou.reduce((a, b) => a + b, 0)).toBe(needsYouCount(stages).total)
  })
})
