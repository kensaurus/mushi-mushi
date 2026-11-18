/**
 * FILE: apps/admin/src/lib/pipelineSignals.test.ts
 * PURPOSE: Only the jam takes a colour on /pipeline; the age bar adds up to the stuck work
 * (server buckets first, listed items as the fallback, the backlog apart); and each group's
 * one button never closes anything by default.
 */

import { describe, expect, it } from 'vitest'
import type { PipelineGroup, PipelineItem, PipelineStage } from './pipeline'
import { groupPrimary, primaryAction, stageTones, stuckAges } from './pipelineSignals'

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
  it('colours only the bottleneck and a stage holding at least half as much', () => {
    const tones = stageTones([stage('reported', 1), stage('triaged', 900), stage('pr', 12), stage('review', 6), stage('ci', 5), stage('train', 1), stage('merged', 0)])
    expect(tones).toEqual({ pr: 'danger', review: 'warn' })
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
    const { needYou, waiting } = stuckAges(stages, NOW)
    expect(needYou).toEqual([101, 31, 15, 6])
    expect(needYou.reduce((a, b) => a + b, 0)).toBe(150 + 3)
    expect(waiting).toEqual([0, 10, 20, 10])
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
