import { describe, expect, it } from 'vitest'
import { buildInboxCards } from './actionInboxFromDashboard'
import type { DashboardData } from '../components/dashboard/types'

const emptyDashboard: DashboardData = {
  empty: false,
  reportsByDay: [],
  integrations: [],
  fixSummary: { total: 0, completed: 0, failed: 0, inProgress: 0, openPrs: 0 },
}

function judgeCard(data: DashboardData, ctx?: Parameters<typeof buildInboxCards>[1]) {
  return buildInboxCards(data, ctx).find((c) => c.id === 'judge-check')
}

describe('buildInboxCards judge staleness', () => {
  it('clears judge card when eval is fresh (<48h)', () => {
    const card = judgeCard(emptyDashboard, { judgeStale: false, judgeStaleHours: 12 })
    expect(card?.action).toBeNull()
  })

  it('opens judge card when eval is stale (>48h)', () => {
    const card = judgeCard(emptyDashboard, { judgeStale: true, judgeStaleHours: 72 })
    expect(card?.action).not.toBeNull()
    expect(card?.action?.title).toMatch(/quality of recent auto-fixes|stale/i)
  })

  it('opens judge card when no eval exists (matches server judgeStale)', () => {
    const card = judgeCard(emptyDashboard, { judgeStale: true, judgeStaleHours: null })
    expect(card?.action).not.toBeNull()
    expect(card?.action?.title).toMatch(/No quality scores yet/)
  })

  it('does not ask for a re-run when scores are old but nothing is left to grade', () => {
    // Server sends judgeStale=false when no report is eligible; age alone
    // (solo-boss-cloud: 335h, 1 report already graded) must not open the card.
    const card = judgeCard(emptyDashboard, { judgeStale: false, judgeStaleHours: 335 })
    expect(card?.action).toBeNull()
  })

  it('does not hardcode stale judge when ctx omitted', () => {
    const card = judgeCard(emptyDashboard)
    expect(card?.action).toBeNull()
  })
})
