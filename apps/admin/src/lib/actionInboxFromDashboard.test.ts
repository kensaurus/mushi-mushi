import { describe, expect, it } from 'vitest'
import { buildInboxCards, inboxCardCounts } from './actionInboxFromDashboard'
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

// 2026-10-16 live console: the banner said "3 open actions" (4 urgent reports
// unfixed, the Claude Code agent probe `down`) while every card was ticked.
describe('buildInboxCards agrees with /inbox/stats', () => {
  const ctx = { judgeStale: false, judgeStaleHours: null }
  const open = (cards: ReturnType<typeof buildInboxCards>) =>
    cards.filter((c) => c.action !== null).map((c) => c.group).sort()

  it('opens Plan on urgent reports that are triaged but unfixed', () => {
    const plan = buildInboxCards(emptyDashboard, { ...ctx, urgentOpenReports: 4 }).find((c) => c.id === 'reports-plan')
    expect(plan?.action?.title).toBe('4 critical or high reports are still unfixed')
    expect(plan?.action?.primary).toMatchObject({ to: '/reports?status=open' })
  })

  it('counts a down probe as red without stats', () => {
    const data = {
      ...emptyDashboard,
      integrations: [{ kind: 'claude_code_agent', lastStatus: 'down' }],
    } as unknown as DashboardData
    expect(open(buildInboxCards(data, ctx))).toEqual(['act', 'ops'])
  })

  it('uses the stats counters over the dashboard list when given', () => {
    const cards = buildInboxCards(emptyDashboard, { ...ctx, urgentOpenReports: 4, integrationRed: 1, integrationAmber: 0 })
    expect(open(cards)).toEqual(['act', 'ops', 'plan'])
  })

  it('a critical needing triage still outranks urgent unfixed reports', () => {
    const data = {
      ...emptyDashboard,
      counts: { reports14d: 2, openBacklog: 0, openCritical14d: 2, fixesTotal: 0, openPrs: 0, llmCalls14d: 0, llmTokens14d: 0, llmFailures14d: 0 },
    } as DashboardData
    const plan = buildInboxCards(data, { ...ctx, urgentOpenReports: 4 }).find((c) => c.id === 'reports-plan')
    expect(plan?.action?.title).toBe('2 critical reports need a decision')
  })
})

describe('buildInboxCards: one Needs-you source and honest ticks (round-2 review, 2026-11-18)', () => {
  const ctx = { judgeStale: false, judgeStaleHours: null }
  const card = (cards: ReturnType<typeof buildInboxCards>, id: string) => cards.find((c) => c.id === id)

  it('lists the stuck pipeline groups Home lists, linked to that group', () => {
    const groups = [{ id: 'no_fix_old', label: '2 reports: triaged over 3 days ago, no fix started', count: 2 }]
    const pipe = card(buildInboxCards(emptyDashboard, { ...ctx, pipelineNeedsYou: groups }), 'pipeline-do')!
    expect(pipe.state).toBe('open')
    expect(pipe.action?.title).toBe('2 reports: triaged over 3 days ago, no fix started')
    expect(pipe.action?.primary).toMatchObject({ to: '/pipeline?group=no_fix_old' })
    const many = card(buildInboxCards(emptyDashboard, { ...ctx, pipelineNeedsYou: [...groups, { id: 'ci_red', label: '3 PRs: their own CI is red', count: 3 }] }), 'pipeline-do')!
    expect(many.action?.title).toBe('5 items are stuck in the pipeline')
  })

  it('a pipeline read that failed is "not checked", never a tick; no read asked means no card', () => {
    expect(card(buildInboxCards(emptyDashboard, { ...ctx, pipelineNeedsYou: null }), 'pipeline-do')!.state).toBe('unknown')
    expect(card(buildInboxCards(emptyDashboard, { ...ctx, pipelineNeedsYou: [] }), 'pipeline-do')!.state).toBe('pass')
    expect(card(buildInboxCards(emptyDashboard, ctx), 'pipeline-do')).toBeUndefined()
  })

  it('"Fixes in flight" with no fix at all has nothing to pass: no tick', () => {
    expect(card(buildInboxCards(emptyDashboard, ctx), 'fixes-do')!.state).toBe('none')
    const ran = { ...emptyDashboard, fixSummary: { total: 3, completed: 3, failed: 0, inProgress: 0, openPrs: 0 } }
    expect(card(buildInboxCards(ran, ctx), 'fixes-do')!.state).toBe('pass')
    expect(card(buildInboxCards(undefined, ctx), 'fixes-do')!.state).toBe('unknown')
  })

  it('local worker problems open their own card, never a tick (round-3: not on Integration health)', () => {
    const cards = buildInboxCards(emptyDashboard, { ...ctx, integrationRed: 0, integrationAmber: 0, workerProblems: 2 })
    const workers = card(cards, 'workers-do')!
    expect(workers.state).toBe('open')
    expect(workers.group).toBe('do')
    expect(workers.action?.title).toBe('2 local worker problems stop fixes')
    expect(workers.action?.primary).toMatchObject({ to: '/pipeline?tab=workers' })
    // Integration health and Integrations judge integrations only, so their ticks stay honest.
    expect(card(cards, 'health-ops')!.state).toBe('pass')
    expect(card(cards, 'health-ops')!.action).toBeNull()
    // No integration and nothing counted: nothing yet, not a pass.
    expect(card(buildInboxCards(emptyDashboard, ctx), 'health-ops')!.state).toBe('none')
    expect(card(buildInboxCards(emptyDashboard, { ...ctx, integrationRed: 0, integrationAmber: 0, workerProblems: 0 }), 'workers-do')!.state).toBe('pass')
    expect(card(buildInboxCards(emptyDashboard, { ...ctx, workerProblems: null }), 'workers-do')!.state).toBe('unknown')
    expect(card(buildInboxCards(emptyDashboard, ctx), 'workers-do')).toBeUndefined()
  })
})

describe('inboxCardCounts: one count for banner, tab and chips (round-3 review, 2026-11-19)', () => {
  const ctx = { judgeStale: false, judgeStaleHours: null }

  it('All = Open + Clear + Not checked', () => {
    // The shot: a critical, a stuck pipeline group, worker problems; fixes never ran.
    const cards = buildInboxCards(emptyDashboard, {
      ...ctx,
      urgentOpenReports: 1,
      integrationRed: 0,
      integrationAmber: 0,
      pipelineNeedsYou: [{ id: 'no_fix_old', label: '2 reports: triaged over 3 days ago, no fix started', count: 2 }],
      workerProblems: 2,
    })
    const counts = inboxCardCounts(cards)
    expect(counts.open).toBe(3)
    expect(counts.open + counts.settled + counts.unchecked).toBe(counts.total)
    expect(counts.unchecked).toBeGreaterThan(0)
  })
})
