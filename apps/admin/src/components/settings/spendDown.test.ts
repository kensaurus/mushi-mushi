import { describe, expect, it } from 'vitest'
import {
  spendDownOutOfWork,
  spendDownLine,
  spendDownPauses,
  spendDownScoreLine,
  spendDownStops,
  type SpendDownKeyStatus,
} from './spendDown'

const base: SpendDownKeyStatus = {
  id: 'k',
  label: 'ayako',
  keyHint: 'crsr_…a1b2',
  scope: 'organization',
  status: 'active',
  enabled: true,
  creditsExpireAt: '2026-10-31T23:59:59Z',
  model: null,
  dailyLimit: 10,
  windowDays: 14,
  state: 'active',
  startsAt: '2026-10-17T23:59:59Z',
  dispatchedToday: 3,
  remainingToday: 7,
  projects: [
    { id: 'p1', name: 'tsumagoi' },
    { id: 'p2', name: 'yen-yen' },
  ],
  lastRunAt: null,
  lastSummary: null,
}

describe('spendDownLine', () => {
  it('says what it spends today, until when, and for which apps', () => {
    expect(spendDownLine(base)).toEqual({
      text: 'Spending down: 3 of 10 fixes today, until Oct 31, 2026. Pays for tsumagoi, yen-yen.',
      tone: 'ok',
    })
  })

  it('warns when the key is on but no app uses it', () => {
    expect(spendDownLine({ ...base, projects: [] }).tone).toBe('warn')
  })

  it('counts the apps of a shared key you cannot open, without naming them', () => {
    expect(spendDownLine({ ...base, projects: [base.projects[0]], otherApps: 2 }).text).toBe(
      'Spending down: 3 of 10 fixes today, until Oct 31, 2026. Pays for tsumagoi, 2 other apps.',
    )
    expect(spendDownLine({ ...base, projects: [], otherApps: 1 })).toMatchObject({ tone: 'ok' })
  })

  it('names the start date before the window, and stops after expiry', () => {
    expect(spendDownLine({ ...base, state: 'not_started', dailyLimit: 1 }).text).toBe(
      'Starts Oct 17, 2026: up to 1 fix a day until the credits expire on Oct 31, 2026.',
    )
    expect(spendDownLine({ ...base, state: 'expired' }).text).toContain('expired on Oct 31, 2026')
    expect(spendDownLine({ ...base, state: 'off' }).text).toBe('Spend-down is off.')
    expect(spendDownLine({ ...base, state: 'key_unusable' }).tone).toBe('warn')
  })
})

describe('spendDownStops', () => {
  it('lists apps the last tick skipped, with the reason', () => {
    expect(
      spendDownStops({
        ...base,
        lastSummary: {
          projects: [
            { projectId: 'p1', dispatched: 2 },
            { projectId: 'p2', dispatched: 0, stopped: 'Daily auto-fix dispatch quota reached (3/3).' },
          ],
        },
      }),
    ).toEqual(['yen-yen: Daily auto-fix dispatch quota reached (3/3).'])
  })

  it('folds apps with the same reason into one line', () => {
    const projects = ['glot.it', 'yen-yen', 'tsumagoi', 'lets-talk', 'solo-boss'].map((name, i) => ({ id: `p${i}`, name }))
    const stopped = (ids: number[], reason: string) => ids.map((i) => ({ projectId: `p${i}`, dispatched: 0, stopped: reason }))
    const k = { ...base, projects, lastSummary: { projects: [...stopped([0, 1, 2, 3], 'No open report to fix'), ...stopped([4], 'Auto-fix is off')] } }
    expect(spendDownStops(k)).toEqual(['glot.it, yen-yen and 2 more: No open report to fix', 'solo-boss: Auto-fix is off'])
    const three = { ...k, lastSummary: { projects: stopped([0, 1, 2], 'No open report to fix') } }
    expect(spendDownStops(three)).toEqual(['glot.it, yen-yen and tsumagoi: No open report to fix'])
  })
})

describe('spendDownOutOfWork', () => {
  const idle = { projectId: 'p1', dispatched: 0, stopped: 'No open report to fix' }
  it('is true when the key could spend but every app had nothing to send', () => {
    expect(spendDownOutOfWork({ ...base, dispatchedToday: 0, lastSummary: { projects: [idle, { projectId: 'p2', dispatched: 0, paused: true, stopped: 'Paused' }] } })).toBe(true)
  })
  it('is false when something was sent, an app stopped for another reason, or the window is not open', () => {
    expect(spendDownOutOfWork({ ...base, dispatchedToday: 2, lastSummary: { projects: [idle] } })).toBe(false)
    expect(spendDownOutOfWork({ ...base, dispatchedToday: 0, lastSummary: { projects: [idle, { projectId: 'p2', dispatched: 0, stopped: 'Daily auto-fix dispatch quota reached (3/3).' }] } })).toBe(false)
    expect(spendDownOutOfWork({ ...base, dispatchedToday: 0, state: 'not_started', lastSummary: { projects: [idle] } })).toBe(false)
    expect(spendDownOutOfWork({ ...base, dispatchedToday: 0, lastSummary: null })).toBe(false)
  })
})

type SpendDownCounts = NonNullable<SpendDownKeyStatus['scoreboard']>['totals']

const totals = (over: Partial<SpendDownCounts> = {}): SpendDownCounts => ({
  runs: 258,
  inFlight: 0,
  prsOpened: 154,
  noPrVerdicts: 64,
  otherFailures: 40,
  reviewed: 66,
  verdicts: { merge: 19, fix_first: 33, hold: 14 },
  merged: 0,
  latestReviewCostUsd: 8.0412,
  mergeYield: 0,
  mergeableYield: 19 / 258,
  ...over,
})

describe('spendDownScoreLine', () => {
  it('reads runs → PRs → mergeable, merged, and the Opus review cost', () => {
    expect(spendDownScoreLine({ ...base, scoreboard: { days: 7, totals: totals() } })).toBe(
      'Last 7 days: 258 runs → 154 PRs → 19 mergeable, 0 merged · Opus review $8.04 (latest review per PR)',
    )
  })

  it('uses singulars and leaves the cost out before any review', () => {
    expect(
      spendDownScoreLine({
        ...base,
        scoreboard: { days: 1, totals: totals({ runs: 1, prsOpened: 1, reviewed: 0, latestReviewCostUsd: 0, verdicts: { merge: 0, fix_first: 0, hold: 0 } }) },
      }),
    ).toBe('Last 1 day: 1 run → 1 PR → 0 mergeable, 0 merged')
  })

  it('is null with no scoreboard or no runs', () => {
    expect(spendDownScoreLine(base)).toBeNull()
    expect(spendDownScoreLine({ ...base, scoreboard: { days: 7, totals: totals({ runs: 0 }) } })).toBeNull()
  })
})

describe('spendDownPauses', () => {
  const stopLoss = (paused: boolean, reason: string | null) => ({
    paused,
    reason,
    reviewed: 20,
    mergeRate: 0.15,
    holdRate: 0.1,
    finishedRuns: 20,
    noPrShare: 0.2,
  })

  it('lists paused apps with the reason, and keeps them out of the last-tick stops', () => {
    const k: SpendDownKeyStatus = {
      ...base,
      projects: [
        { id: 'p1', name: 'tsumagoi', stopLoss: stopLoss(true, 'Paused: 3 of the last 20 reviewed fixes were mergeable (15%)') },
        { id: 'p2', name: 'yen-yen', stopLoss: stopLoss(false, null) },
      ],
      lastSummary: {
        projects: [
          { projectId: 'p1', dispatched: 0, stopped: 'Paused: 3 of the last 20 reviewed fixes were mergeable (15%)', paused: true },
          // Paused last tick but healthy now: the stale pause is not shown.
          { projectId: 'p2', dispatched: 0, stopped: 'Paused: old reason', paused: true },
        ],
      },
    }
    expect(spendDownPauses(k)).toEqual([
      { projectId: 'p1', text: 'tsumagoi: Paused: 3 of the last 20 reviewed fixes were mergeable (15%)', canResume: false },
    ])
    expect(spendDownStops(k)).toEqual([])
  })
})
