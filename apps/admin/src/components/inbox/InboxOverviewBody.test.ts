import { describe, expect, it } from 'vitest'
import { resolveInboxOverviewMode } from './InboxOverviewBody'
import { EMPTY_INBOX_STATS, type InboxStats } from './types'

function stats(overrides: Partial<InboxStats>): InboxStats {
  return { ...EMPTY_INBOX_STATS, hasAnyProject: true, setupDone: true, ...overrides }
}

describe('resolveInboxOverviewMode', () => {
  it('returns setup when ingest is incomplete', () => {
    expect(
      resolveInboxOverviewMode(stats({ setupDone: false, topPriority: 'setup', requiredComplete: 2 }), 0),
    ).toBe('setup')
  })

  it('lists the actions whenever there is an open card', () => {
    expect(resolveInboxOverviewMode(stats({ openActions: 2, topPriority: 'actions' }), 2)).toBe('actions')
    // A non-critical banner no longer swaps the list for a one-card preview.
    expect(
      resolveInboxOverviewMode(
        stats({ openActions: 1, topPriority: 'clear', topPriorityTitle: 'Run judge', topPriorityTo: '/judge' }),
        1,
      ),
    ).toBe('actions')
  })

  it('returns clear when inbox is zero', () => {
    expect(resolveInboxOverviewMode(stats({ openActions: 0, topPriority: 'clear', clearStages: 5 }), 0)).toBe('clear')
  })
})
