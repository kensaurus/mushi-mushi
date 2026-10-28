/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/judge/JudgeStatusBanner.test.tsx
 * PURPOSE: The disagreement banner names the same window as the stats route.
 *          76/144 inside 14 days is all-time, and a window under 5 grades is
 *          too thin to call recent (64c2b3df).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JudgeStatusBanner } from './JudgeStatusBanner'
import { EMPTY_JUDGE_STATS, JUDGE_RECENT_MIN_GRADES, judgeEvaluationsTab, type JudgeStats } from './JudgeStatsTypes'

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function renderBanner(stats: JudgeStats) {
  act(() => {
    root.render(
      createElement(MemoryRouter, null, createElement(JudgeStatusBanner, { stats, plainBanner: true })),
    )
  })
  const paragraphs = [...host.querySelectorAll('p')]
  return { title: paragraphs[0]?.textContent ?? '', subtitle: paragraphs[1]?.textContent ?? '' }
}

const reported: JudgeStats = {
  ...EMPTY_JUDGE_STATS,
  hasAnyProject: true,
  projectName: 'Demo',
  topPriority: 'disagreements',
  totalEvaluations: 144,
  disagreementCount: 76,
  disagreementRatePct: 53,
  recentWindowDays: 14,
  recentEvaluations: 144,
  recentDisagreements: 76,
}

describe('JudgeStatusBanner disagreement window', () => {
  it('says all grades, never recent or 14 days, when 76/144 all sit inside the window', () => {
    const { title, subtitle } = renderBanner(reported)
    expect(title).toContain('all grades')
    expect(subtitle).toContain('all grades')
    expect(`${title} ${subtitle}`).not.toMatch(/recent|14 days/)
  })

  it('does not title a thin window as the last 14 days while the subtitle is all-time', () => {
    const { title, subtitle } = renderBanner({
      ...reported,
      recentEvaluations: 4,
      recentDisagreements: 1,
      topPriorityLabel:
        'The grader disagreed with the diagnosis on 53% of all 144 grades so far. Review them before merging their fixes.',
    })
    expect(title).toContain('53% of all grades')
    expect(title).not.toMatch(/recent|14 days|0%|25%/)
    expect(subtitle).toContain('53% of all 144 grades so far')
    expect(subtitle).not.toMatch(/recent|14 days/)
  })
})

describe('JUDGE_RECENT_MIN_GRADES', () => {
  it('matches the stats route threshold', () => {
    const src = readFileSync(resolve(REPO_ROOT, 'packages/server/supabase/functions/api/routes/judge.ts'), 'utf8')
    expect(src).toContain(`export const JUDGE_RECENT_MIN_GRADES = ${JUDGE_RECENT_MIN_GRADES}`)
    expect(src).toContain('agreement.recentEvaluations >= JUDGE_RECENT_MIN_GRADES')
  })
})

describe('judgeEvaluationsTab', () => {
  it('names the disagreement subset instead of a bare grade count', () => {
    expect(judgeEvaluationsTab('Grades', { disagreementCount: 76, totalEvaluations: 144 })).toEqual({
      label: 'Grades · 76 disagree',
    })
    expect(judgeEvaluationsTab('Grades', { disagreementCount: 0, totalEvaluations: 144 })).toEqual({
      label: 'Grades',
    })
    const page = readFileSync(resolve(REPO_ROOT, 'apps/admin/src/pages/JudgePage.tsx'), 'utf8')
    expect(page).toContain('judgeEvaluationsTab')
  })
})
