import { describe, expect, it } from 'vitest'
import { intervalLabel, isActiveQueueRow, mergeQueueSummary, prLink, toMergeQueueSnapshot, trainLine } from './mergeQueue'

describe('merge queue copy', () => {
  it('summarises the queue in one line, leaving empty parts out', () => {
    expect(mergeQueueSummary([{ state: 'queued' }, { state: 'waiting' }, { state: 'resolving' }, { state: 'blocked' }, { state: 'merged' }])).toBe(
      '3 to merge · 1 held · 1 merged today',
    )
    expect(mergeQueueSummary([{ state: 'blocked' }, { state: 'blocked' }])).toBe('2 held')
    expect(mergeQueueSummary([{ state: 'removed' }])).toBe('')
  })
  it('treats blocked as active and merged or removed as done', () => {
    expect(['queued', 'waiting', 'resolving', 'blocked', 'merged', 'removed'].map((state) => isActiveQueueRow({ state: state as never }))).toEqual([
      true, true, true, true, false, false,
    ])
  })
  it('links the pull request on GitHub', () => {
    expect(prLink({ repo: 'o/r', pr_number: 7 })).toBe('https://github.com/o/r/pull/7')
  })
  it('says what the release train is doing, or when the next one leaves', () => {
    expect(trainLine({ state: 'testing', members: [1, 2, 3], attempt: 1, detail: null })).toBe('3 fixes · CI running')
    expect(trainLine({ state: 'testing', members: [1], attempt: 2, detail: 'Updating the branch.' })).toBe('1 fix · retry 2 · Updating the branch.')
    const now = new Date('2026-10-24T06:00:00Z')
    expect(trainLine(null, { lastAt: '2026-10-24T04:00:00Z', intervalMinutes: 360, now, ready: 2 })).toBe('2 approved · next train leaves in 4 h')
    expect(trainLine(null, { lastAt: null, intervalMinutes: 360, now, ready: 1 })).toBe('1 approved · next train leaves within a few minutes')
    expect(trainLine(null, { lastAt: null, intervalMinutes: 360, now, ready: 0 })).toBe('')
  })
  it('turns a queue payload into the card snapshot, empty when the read failed', () => {
    expect(toMergeQueueSnapshot(null, 'p1')).toEqual({ rows: [], trains: [], release: null })
    expect(toMergeQueueSnapshot({
      rows: [],
      trains: [],
      release: [
        { projectId: 'other', mode: 'each', intervalMinutes: 60, maxMembers: 15 },
        { projectId: 'p1', mode: 'train', intervalMinutes: 360, maxMembers: 15 },
      ],
    }, 'p1').release).toMatchObject({ projectId: 'p1', mode: 'train' })
  })
  it('names the interval in words', () => {
    expect([60, 180, 360, 1440, 2880, 45].map(intervalLabel)).toEqual(['every hour', 'every 3 hours', 'every 6 hours', 'once a day', 'every 2 days', 'every 45 min'])
  })
})
