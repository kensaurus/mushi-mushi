import { describe, expect, it } from 'vitest'
import { resolveInboxOverviewMode, splitInboxCards } from './InboxOverviewBody'
import type { InboxCard } from '../../lib/actionInboxFromDashboard'
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

describe('splitInboxCards', () => {
  const card = (id: string, scope: string) => ({ id, scope, group: 'plan', pageLabel: id, pageTo: '/' + id, action: null }) as unknown as InboxCard

  it('ranks decisions and moves a re-grade chore to the footer (journeys 2026-10-27)', () => {
    const { decisions, chores } = splitInboxCards([card('triage', 'reports'), card('judge-check', 'judge'), card('fixes', 'fixes')])
    expect(decisions.map((c) => c.id)).toEqual(['triage', 'fixes'])
    expect(chores.map((c) => c.id)).toEqual(['judge-check'])
  })

  it('shows at most five decisions and counts the rest', () => {
    const { decisions, more } = splitInboxCards(Array.from({ length: 7 }, (_, i) => card(`c${i}`, 'reports')))
    expect(decisions).toHaveLength(5)
    expect(more).toBe(2)
  })
})
