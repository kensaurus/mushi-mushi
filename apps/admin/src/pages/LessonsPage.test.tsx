/**
 * @vitest-environment jsdom
 */

/**
 * Console journeys 2026-10-27, Lessons: the page opened on six tiles and
 * cluster cards reading "coherence: 35%". It now leads with recurring
 * patterns, most reports first, each with its report count and suggested
 * rule, and Promote only where promoting can succeed.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_LESSONS_STATS, type LessonsStats } from '../components/lessons/LessonsStatsTypes'

const mocks = vi.hoisted(() => ({ stats: null as LessonsStats | null, clusters: [] as unknown[] }))

vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null }
    if (path === '/v1/admin/lessons/stats') return { ...base, data: mocks.stats }
    if (path?.startsWith('/v1/admin/clusters')) return { ...base, data: mocks.clusters }
    return { ...base, data: [] }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => ({ activeProject: { project_name: 'App' } }) }))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ canEditProject: true }) }))
vi.mock('../lib/mode', () => ({ useAdminMode: () => ({ isQuickstart: false, isBeginner: false, isAdvanced: false }) }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../lib/useNavCounts', () => ({ refreshNavCounts: vi.fn() }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))

import { LessonsPage } from './LessonsPage'
import { ToastProvider } from '../lib/toast'

function cluster(id: string, size: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    project_id: 'p1',
    cluster_size: size,
    severity_distribution: {},
    first_seen_at: '2026-10-01T00:00:00Z',
    last_seen_at: '2026-10-20T00:00:00Z',
    status: 'candidate',
    name: `Pattern ${id}`,
    summary: null,
    suggested_rule: `Rule for ${id}`,
    judge_coherence_score: 0.35,
    ...extra,
  }
}

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

async function render(url: string) {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(ToastProvider, null, createElement(LessonsPage))))
  })
}

describe('LessonsPage recurring patterns', () => {
  it('lists patterns by report count with their suggested rule, no "coherence", and Promote only where it can work', async () => {
    mocks.stats = { ...EMPTY_LESSONS_STATS, hasAnyProject: true, candidateClusters: 3, readyToPromote: 1, topPriority: 'candidates_ready' }
    mocks.clusters = [
      cluster('small', 2),
      cluster('big', 7),
      cluster('norule', 5, { suggested_rule: null }),
    ]
    await render('/lessons?tab=clusters')
    const text = host.textContent ?? ''
    expect(text).not.toMatch(/coherence/i)
    expect(text).toContain('Recurring patterns')
    // Most reports first.
    const names = [...host.querySelectorAll('p.text-sm.font-medium')].map((p) => p.textContent)
    expect(names.slice(0, 3)).toEqual(['Pattern big', 'Pattern norule', 'Pattern small'])
    expect(text).toContain('7 reports')
    expect(host.querySelector('[data-testid="suggested-rule"]')?.textContent).toBe('Suggested rule: Rule for big')
    // One Promote, on the only pattern with 3+ reports and a rule.
    const promotes = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Promote')
    expect(promotes).toHaveLength(1)
    expect(text).toContain('Ready to promote')
    expect(text).toContain('Still growing')
  })

  it('says the next step, not the counts the numbers already show', async () => {
    mocks.stats = { ...EMPTY_LESSONS_STATS, hasAnyProject: true, activeLessons: 2, candidateClusters: 3, readyToPromote: 1, topPriority: 'candidates_ready' }
    mocks.clusters = []
    await render('/lessons?tab=clusters')
    const status = host.querySelector('[data-testid="page-status"]')?.textContent ?? ''
    // The lead names the next step and the button does it (console UX overhaul, 2026-11-19).
    expect(status).toContain('1 recurring bug is ready to become a rule.')
    expect(status).toContain('Promote 1')
    expect(status).not.toContain('lessons in use;')
  })

  it('folds identical unnamed patterns into one row', async () => {
    mocks.stats = { ...EMPTY_LESSONS_STATS, hasAnyProject: true, candidateClusters: 3, topPriority: 'candidates_ready' }
    mocks.clusters = [
      cluster('a', 1, { name: null, suggested_rule: null }),
      cluster('b', 1, { name: null, suggested_rule: null, last_seen_at: '2026-10-25T00:00:00Z' }),
      cluster('named', 1, { suggested_rule: null }),
    ]
    await render('/lessons?tab=clusters')
    const groups = host.querySelectorAll('[data-testid="lessons-cluster-group"]')
    expect(groups).toHaveLength(1)
    expect(groups[0].textContent).toContain('2 patterns still growing (1 report each)')
    expect(host.textContent).not.toContain('Unnamed pattern')
    expect(host.textContent).toContain('Pattern named')
  })
})

describe('LessonsPage round-2 sweep', () => {
  it('with nothing learned yet, says it once in a sans heading and shows no 0 tiles', async () => {
    mocks.stats = { ...EMPTY_LESSONS_STATS, hasAnyProject: true, topPriority: 'no_lessons' }
    mocks.clusters = []
    await render('/lessons?tab=lessons')
    const text = host.textContent ?? ''
    // Named like its tab (2026-11-19): "No rules in use yet", said once.
    expect(text.split('No rules in use yet').length - 1).toBe(1)
    expect(text).not.toContain('No lessons yet')
    expect(host.querySelector('[data-testid="page-status"]')).toBeNull()
    expect(host.querySelector('.font-serif')).toBeNull()
  })

  it('shows only non-zero numbers with labels that fit a phone, and never repeats the 3-report rule', async () => {
    mocks.stats = { ...EMPTY_LESSONS_STATS, hasAnyProject: true, candidateClusters: 2, totalClusterReports: 4, topPriority: 'no_lessons' }
    mocks.clusters = []
    await render('/lessons?tab=lessons')
    const status = host.querySelector('[data-testid="page-status"]')!
    const labels = [...status.querySelectorAll('dt')].map((d) => d.textContent)
    expect(labels).toEqual(['In patterns'])
    expect(host.textContent ?? '').not.toMatch(/3 reports share its cause/)
    expect((host.textContent ?? '').split('share one cause').length - 1).toBeLessThanOrEqual(1)
  })

  it('a folded group row says "still growing" once', async () => {
    mocks.stats = { ...EMPTY_LESSONS_STATS, hasAnyProject: true, candidateClusters: 2, topPriority: 'candidates_ready' }
    mocks.clusters = [cluster('a', 1, { name: null, suggested_rule: null }), cluster('b', 1, { name: null, suggested_rule: null })]
    await render('/lessons?tab=clusters')
    const row = host.querySelector('[data-testid="lessons-cluster-group"]')!.textContent ?? ''
    expect(row.toLowerCase().split('still growing').length - 1).toBe(1)
  })

  // 2026-11-19: "Query lessons" was enabled with nothing to match against.
  it('turns Query lessons off with its reason while there are no lessons', async () => {
    mocks.stats = { ...EMPTY_LESSONS_STATS, hasAnyProject: true, activeLessons: 0, topPriority: 'no_lessons' }
    mocks.clusters = []
    await render('/lessons?tab=query')
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Query lessons')) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(host.querySelector('[data-testid="lessons-query-blocked"]')?.textContent).toBe('No lessons to match yet.')
  })

  it('shows "In patterns" only when it says more than the pattern count', async () => {
    mocks.stats = { ...EMPTY_LESSONS_STATS, hasAnyProject: true, candidateClusters: 2, totalClusterReports: 2, topPriority: 'no_lessons' }
    mocks.clusters = []
    await render('/lessons?tab=lessons')
    const status = host.querySelector('[data-testid="page-status"]')
    expect([...(status?.querySelectorAll('dt') ?? [])].map((d) => d.textContent)).not.toContain('In patterns')
  })
})
