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
import { judgeStatusSentence, judgeWeekMetricLabel } from './JudgeSnapshotStrip'
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
    expect(worst.textContent).toContain('grade 12%')
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

describe('JudgeAgreementOverview with one graded week', () => {
  it('shows the one value instead of a flat chart', () => {
    mocks.evaluations = []
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(JudgeAgreementOverview, { weeks: [{ weekStart: '2026-11-09', graded: 2, agreed: 0 }], windowDays: 14 }),
        ),
      ),
    )
    expect(host.querySelector('[data-testid="metric-timeline"]')).toBeNull()
    const single = host.querySelector('[data-testid="judge-agreement-single"]')!
    expect(single.textContent).toContain('0%')
    expect(single.textContent).toContain('week of Nov 9 (0 of 2 grades)')
    expect(single.textContent).toContain('after 2 weeks')
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

  it('counts disagreements over the recent window and says so, without repeating the grade', () => {
    expect(judgeStatusSentence({ ...base, recentWindowDays: 14, recentEvaluations: 10, recentDisagreements: 1 })).toBe(
      'In the last 14 days the grader would have diagnosed 1 of 10 reports differently. Read those before merging their fixes.',
    )
  })

  it('says "so far" for an all-time count from an older server', () => {
    expect(judgeStatusSentence(base)).toBe(
      'So far the grader would have diagnosed 18 of 57 reports differently. Read those before merging their fixes.',
    )
  })

  it('says "every" when the grader disagreed with all of them, and labels the grade with its week', () => {
    expect(judgeStatusSentence({ ...base, recentWindowDays: 14, recentEvaluations: 2, recentDisagreements: 2 })).toBe(
      'In the last 14 days the grader would have diagnosed every report it graded differently. Read those before merging their fixes.',
    )
    expect(judgeWeekMetricLabel({ latestWeekLabel: 'week of Nov 9' })).toBe('Average grade, week of Nov 9')
    expect(judgeWeekMetricLabel({ latestWeekLabel: 'this week' })).toBe('Average grade, this week')
  })
})
