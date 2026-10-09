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

// 2026-10-04 console audit, group B: the reports card counts and links what
// it means, and quick mode keeps an Activity tab the user opened.
describe('buildInboxCards reports card', () => {
  function reportsCard(data: DashboardData) {
    return buildInboxCards(data).find((c) => c.id === 'reports-plan')
  }

  it('closes once every critical is fixed or dismissed (item 77)', () => {
    // Intake chart still shows 3 criticals this window; none is open.
    const card = reportsCard({
      ...emptyDashboard,
      reportsByDay: [{ day: '2026-10-01', total: 3, critical: 3, high: 0, medium: 0, low: 0, unscored: 0 }],
      counts: { reports14d: 3, openBacklog: 0, openCritical14d: 0, fixesTotal: 0, openPrs: 0, llmCalls14d: 0, llmTokens14d: 0, llmFailures14d: 0 },
    } as DashboardData)
    expect(card?.action).toBeNull()
  })

  it('counts open criticals and opens exactly that list', () => {
    const card = reportsCard({
      ...emptyDashboard,
      counts: { reports14d: 5, openBacklog: 0, openCritical14d: 2, fixesTotal: 0, openPrs: 0, llmCalls14d: 0, llmTokens14d: 0, llmFailures14d: 0 },
    } as DashboardData)
    expect(card?.action?.title).toBe('2 critical reports need a decision')
    expect(card?.action?.primary).toMatchObject({ to: '/reports?status=open&severity=critical&days=14' })
  })

  it('the backlog card opens the New bucket it counted, oldest first (item 78)', () => {
    const card = reportsCard({
      ...emptyDashboard,
      counts: { reports14d: 4, openBacklog: 4, openCritical14d: 0, fixesTotal: 0, openPrs: 0, llmCalls14d: 0, llmTokens14d: 0, llmFailures14d: 0 },
    } as DashboardData)
    expect(card?.action?.primary).toMatchObject({ to: '/reports?status=new&sort=created_at&dir=asc' })
  })
})
