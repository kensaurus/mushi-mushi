import { describe, expect, it } from 'vitest'
import { isActiveQueueRow, mergeQueueSummary, prLink } from './mergeQueue'

describe('merge queue copy', () => {
  it('summarises the queue in one line, leaving empty parts out', () => {
    expect(mergeQueueSummary([{ state: 'queued' }, { state: 'waiting' }, { state: 'resolving' }, { state: 'blocked' }, { state: 'merged' }])).toBe(
      '3 to merge · 1 needs you · 1 merged today',
    )
    expect(mergeQueueSummary([{ state: 'blocked' }, { state: 'blocked' }])).toBe('2 need you')
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
})
