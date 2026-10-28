/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/judge/JudgeAgreementOverview.test.tsx
 * PURPOSE: Triage grading answers "can I trust the diagnoses?" with an
 *          agreement trend and the 3 worst recent disagreements, and its
 *          status sentence names the window it counts (64c2b3df: the old
 *          banner said "recent" over an all-time count).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ paths: [] as string[], evaluations: [] as unknown[] }))

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    if (path) mocks.paths.push(path)
    return { data: { evaluations: mocks.evaluations }, loading: false, error: null, reload: vi.fn(), lastFetchedAt: null, isValidating: false }
  },
}))

import { JudgeAgreementOverview, agreementPoints } from './JudgeAgreementOverview'
import { judgeStatusSentence } from './JudgeSnapshotStrip'
import { EMPTY_JUDGE_STATS, type JudgeStats } from './JudgeStatsTypes'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.paths = []
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('agreementPoints', () => {
  it('turns weekly counts into an agreement percentage and skips empty weeks', () => {
    expect(
      agreementPoints([
        { weekStart: '2026-10-05', graded: 4, agreed: 3 },
        { weekStart: '2026-10-12', graded: 0, agreed: 0 },
        { weekStart: '2026-10-19', graded: 10, agreed: 5 },
      ]),
    ).toEqual([
      { ts: '2026-10-05T00:00:00Z', value: 75 },
      { ts: '2026-10-19T00:00:00Z', value: 50 },
    ])
  })
})

describe('JudgeAgreementOverview', () => {
  it('draws the trend and lists the worst recent disagreements with their reason', () => {
    mocks.evaluations = [
      {
        id: 'e1',
        report_id: 'r1',
        judge_score: 0.12,
        judge_reasoning: 'The crash is in checkout, not auth. The stack trace names CartService.',
        report_summary: 'Pay button does nothing',
        created_at: '2026-10-25T00:00:00Z',
      },
    ]
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(JudgeAgreementOverview, {
            weeks: [
              { weekStart: '2026-10-12', graded: 4, agreed: 4 },
              { weekStart: '2026-10-19', graded: 10, agreed: 6 },
            ],
            windowDays: 14,
          }),
        ),
      ),
    )
    expect(host.querySelector('[data-testid="metric-timeline"]')).not.toBeNull()
    const worst = host.querySelector('[data-testid="judge-worst-disagreements"]')!
    expect(worst.textContent).toContain('Pay button does nothing')
    expect(worst.textContent).toContain('12%')
    expect(worst.textContent).toContain('The crash is in checkout, not auth.')
    expect(worst.textContent).not.toContain('CartService')
    expect(worst.querySelector('a')?.getAttribute('href')).toBe('/reports/r1')
    // Only disagreements, worst score first, three of them, inside the window.
    const path = mocks.paths.find((p) => p.startsWith('/v1/admin/judge/evaluations'))!
    const q = new URLSearchParams(path.split('?')[1])
    expect(q.get('disagreement')).toBe('1')
    expect(q.get('sort')).toBe('score_asc')
    expect(q.get('limit')).toBe('3')
    expect(Date.parse(q.get('to')!) - Date.parse(q.get('from')!)).toBe(14 * 86_400_000)
  })
})

describe('judgeStatusSentence', () => {
  const base: JudgeStats = {
    ...EMPTY_JUDGE_STATS,
    hasAnyProject: true,
    totalEvaluations: 57,
    latestWeekScore: 0.66,
    latestWeekLabel: 'this week',
    latestWeekEvalCount: 53,
    disagreementCount: 18,
    disagreementRatePct: 32,
  }

  it('counts disagreements over the recent window and says so', () => {
    expect(judgeStatusSentence({ ...base, recentWindowDays: 14, recentEvaluations: 10, recentDisagreements: 1 })).toBe(
      'Diagnoses scored 66% this week across 53 grades. In the last 14 days the grader disagreed with 1 of 10 diagnoses (10%).',
    )
  })

  it('says "so far" for an all-time count from an older server', () => {
    expect(judgeStatusSentence(base)).toBe(
      'Diagnoses scored 66% this week across 53 grades. So far the grader disagreed with 18 of 57 diagnoses (32%).',
    )
  })

  it('does not call 76/144 recent when every grade is inside 14 days', () => {
    // 76/144 is 53% all-time. The same 144 grades sit inside 14 days, so that
    // window is the whole history, not a recent slice (64c2b3df).
    expect(
      judgeStatusSentence({
        ...base,
        totalEvaluations: 144,
        disagreementCount: 76,
        disagreementRatePct: 53,
        latestWeekScore: 0.8,
        latestWeekLabel: 'this week',
        latestWeekEvalCount: 100,
        recentWindowDays: 14,
        recentEvaluations: 144,
        recentDisagreements: 76,
      }),
    ).toBe('Diagnoses scored 80% this week across 100 grades. So far the grader disagreed with 76 of 144 diagnoses (53%).')
  })

  it('keeps the all-time rate when the last 14 days hold fewer than 5 grades', () => {
    // The server only quotes the 14-day window at 5 or more grades. 1 of 4 is
    // 25%, and 0 of 0 would print as 0%, against 76/144 (53%) all-time.
    const allTime = {
      ...base,
      totalEvaluations: 144,
      disagreementCount: 76,
      disagreementRatePct: 53,
      recentWindowDays: 14,
    }
    const sentence =
      'Diagnoses scored 66% this week across 53 grades. So far the grader disagreed with 76 of 144 diagnoses (53%).'
    expect(judgeStatusSentence({ ...allTime, recentEvaluations: 4, recentDisagreements: 1 })).toBe(sentence)
    expect(judgeStatusSentence({ ...allTime, recentEvaluations: 0, recentDisagreements: 0 })).toBe(sentence)
  })
})
