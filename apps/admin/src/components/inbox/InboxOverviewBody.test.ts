import { describe, expect, it } from 'vitest'
import { resolveInboxOverviewMode } from './InboxOverviewBody'
import { EMPTY_INBOX_STATS, type InboxStats } from './types'

function stats(overrides: Partial<InboxStats>): InboxStats {
  return { ...EMPTY_INBOX_STATS, hasAnyProject: true, setupDone: true, ...overrides }
}

describe('resolveInboxOverviewMode', () => {
  it('returns setup when ingest is incomplete', () => {
    expect(
      resolveInboxOverviewMode(
        stats({ setupDone: false, topPriority: 'setup', requiredComplete: 2 }),
        false,
      ),
    ).toBe('setup')
  })

  it('returns handoff when banner is critical with open work', () => {
    expect(
      resolveInboxOverviewMode(
        stats({ openActions: 2, topPriority: 'actions', topPriorityTitle: 'Triage' }),
        false,
      ),
    ).toBe('handoff')
  })

  it('returns preview for non-critical open work in advanced mode', () => {
    expect(
      resolveInboxOverviewMode(
        stats({
          openActions: 1,
          topPriority: 'clear',
          topPriorityTitle: 'Run judge',
          topPriorityTo: '/judge',
        }),
        false,
      ),
    ).toBe('preview')
  })

  it('defers preview to handoff when snapshot strip is visible', () => {
    expect(
      resolveInboxOverviewMode(
        stats({
          openActions: 1,
          topPriority: 'clear',
          topPriorityTitle: 'Run judge',
          topPriorityTo: '/judge',
        }),
        false,
        true,
      ),
    ).toBe('handoff')
  })

  it('returns clear when inbox is zero', () => {
    expect(
      resolveInboxOverviewMode(
        stats({ openActions: 0, topPriority: 'clear', clearStages: 5 }),
        false,
      ),
    ).toBe('clear')
  })
})
