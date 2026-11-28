/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/ChecksPage.test.tsx
 * PURPOSE: /checks answers "is my app OK, and which check is red?"
 *   - one card per check, with the registry label and description, linking
 *     to the registry path, so the grid can never drift from the sidebar;
 *   - each card has its own state (bug 011fd428: 10 of 11 cards showed no
 *     status), failing first, then findings, then the rest;
 *   - one status sentence and one action: open the failing check;
 *   - a plan-gated check stays visible with an upgrade pill;
 *   - a Lab page the user has not turned on is not offered;
 *   - a nav-meta read that failed is "Status unavailable", never a pass;
 *   - signals (2026-11-18): alert cards for failed / findings / stale checks with their
 *     number and change since the last visit, a graded age chip, and the passing
 *     checks folded into one line.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_NAV_STAT_SLICES, type NavStatSlices } from '../lib/extendedNavMeta'
import { NAV_REGISTRY } from '../lib/navRegistry'
import type * as LabsModule from '../lib/labs'

const state = vi.hoisted(() => ({
  slices: null as unknown,
  navError: null as string | null,
  recipe: null as unknown,
  firstUserTest: { runs: [], trend: [] } as unknown,
  features: new Set<string>(),
  labs: new Set<string>(),
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null }
    if (path?.startsWith('/v1/admin/workspace/nav-meta')) {
      return state.navError ? { ...base, data: null, error: state.navError } : { ...base, data: { generatedAt: '', slices: state.slices, projects: null } }
    }
    if (path?.endsWith('/recipe')) return { ...base, data: state.recipe }
    if (path?.endsWith('/fresh-eyes')) return { ...base, data: state.firstUserTest }
    return { ...base, data: null }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({ isSuperAdmin: false, has: (flag: string) => state.features.has(flag) }),
}))
vi.mock('../lib/labs', async (importOriginal) => {
  const actual = await importOriginal<typeof LabsModule>()
  return { ...actual, useLabs: () => ({ enabled: state.labs, isEnabled: (id: string) => state.labs.has(id), setEnabled: () => {} }) }
})
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title }: { title: string }) => createElement('h1', null, title),
}))
vi.mock('../components/billing/UpgradeNudge', () => ({
  UpgradePill: ({ flag }: { flag: string }) => createElement('span', { 'data-testid': `upgrade-${flag}` }, 'Pro'),
}))

import { ChecksPage, checksStatus, idleSection, sortCheckCards } from './ChecksPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CORE_PATHS = ['/qa-coverage', '/health', '/fullstack-audit', '/inventory', '/recipe', '/design', '/content', '/first-user-test', '/judge', '/lessons']
const LAB_PATHS = ['/ci', '/prompt-lab']
const RECENT = new Date(Date.now() - 3_600_000).toISOString()

function slices(over: Partial<NavStatSlices> = {}): NavStatSlices {
  return {
    ...EMPTY_NAV_STAT_SLICES,
    qaCoverage: { totalStories: 4, failingStories: 1, pendingRuns: 0, lastRunAt: RECENT, topPriority: 'failing' as never },
    fullstackAudit: { errorCount: 0, warnCount: 0, failedGateCount: 0, lastRunAt: RECENT, topPriority: 'healthy' },
    ...over,
  }
}

let container: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/checks'] }, createElement(ChecksPage)))
  })
}

beforeEach(() => {
  window.localStorage.clear()
  state.slices = slices()
  state.navError = null
  state.recipe = null
  state.firstUserTest = { runs: [], trend: [] }
  state.features = new Set()
  state.labs = new Set()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function cardOrder(): string[] {
  return [...container.querySelectorAll<HTMLElement>('li[data-testid^="checks-card-"]')].map((li) => `/${li.dataset.testid!.replace('checks-card-', '')}`)
}

describe('ChecksPage', () => {
  it('renders one card per core check with the registry label and description, linking to its path', () => {
    render()
    expect(container.querySelector('h1')?.textContent).toBe('Checks')
    for (const path of CORE_PATHS) {
      const entry = NAV_REGISTRY.find((e) => e.path === path)!
      const li = container.querySelector(`[data-testid="checks-card-${path.slice(1)}"]`)
      const alert = container.querySelector(`[data-testid="checks-alert-${path.slice(1)}"]`)
      // Each check shows once: as an alert card when it needs you, otherwise in the grid (2026-11-18).
      expect(Boolean(li) !== Boolean(alert), path).toBe(true)
      if (alert) {
        expect(alert.querySelector(`a[href="${path}"]`), path).not.toBeNull()
        expect(alert.textContent).toContain(entry.label)
        continue
      }
      expect(li!.querySelector(`a[href="${path}"]`)?.textContent).toBe(entry.label)
      expect(li!.textContent).toContain(entry.paletteDescription)
    }
  })

  it('gives every card a state and puts the failing check first', () => {
    render()
    // The check with findings leads as an alert card and is not repeated in the grid.
    expect(container.querySelector('[data-testid="checks-alert-qa-coverage"]')).not.toBeNull()
    expect(cardOrder()).not.toContain('/qa-coverage')
    expect(container.querySelector('[data-testid="checks-card-fullstack-audit"]')?.getAttribute('data-state')).toBe('pass')
    // Every card says something; none is blank once its read is done.
    for (const li of container.querySelectorAll('li[data-testid^="checks-card-"]')) {
      if (li.getAttribute('data-testid')?.match(/recipe|design/)) continue
      expect(li.getAttribute('data-state'), li.getAttribute('data-testid')!).not.toBe('loading')
    }
    // A card whose read is still running says so instead of leaving its corner blank (2026-10-30).
    const waiting = container.querySelector('[data-testid="checks-card-recipe"]')!
    if (waiting.getAttribute('data-state') === 'loading') expect(waiting.textContent).toContain('Checking…')
    // Each state is a status pill (colour plus glyph): findings are slow, a pass passes (2026-11-18).
    const pill = (id: string) => container.querySelector(`[data-testid="checks-card-${id}"] [data-testid="status-pill"]`)?.getAttribute('data-status')
    expect(pill('fullstack-audit')).toBe('passed')
  })

  it('lets a card head wrap so a phone never cuts the check name for its pill (2026-11-22)', () => {
    render()
    const heads = [...container.querySelectorAll('[data-testid="checks-card-head"]')]
    expect(heads.length).toBeGreaterThan(0)
    for (const head of heads) expect(head.className).toContain('flex-wrap')
  })

  it('leads with counts as marks, not a sentence naming the cards below', () => {
    render()
    const status = container.querySelector('[data-testid="checks-status"]')!
    expect(status.querySelector('[data-testid="checks-count-findings"]')?.textContent).toBe('1with findings')
    // Passing is counted once, on its fold, not again in the banner (2026-11-18 round 2).
    expect(status.querySelector('[data-testid="checks-count-pass"]')).toBeNull()
    expect(status.querySelector('[data-testid="checks-count-watching"]')).toBeNull()
    // The names and the Open button live on the alert card only.
    expect(status.textContent).not.toContain('Scheduled tests')
    expect(status.querySelector('a')).toBeNull()
  })

  it('counts every state from one source, each count shown once: banner, idle list and fold agree with the cards', () => {
    render()
    const shown = (state: string) => container.querySelectorAll(`li[data-state="${state}"]`).length + (state === 'findings' || state === 'failed' ? container.querySelectorAll(`[data-testid^="checks-alert-"][data-severity="${state === 'failed' ? 'critical' : 'serious'}"]`).length : 0)
    for (const state of ['failed', 'findings', 'unavailable']) {
      const mark = container.querySelector(`[data-testid="checks-count-${state}"]`)
      const n = mark ? Number(mark.textContent!.match(/^\d+/)![0]) : 0
      expect(n, state).toBe(shown(state))
    }
    for (const state of ['not_checked', 'not_set_up', 'pass', 'watching']) {
      expect(container.querySelector(`[data-testid="checks-status"] [data-testid="checks-count-${state}"]`), state).toBeNull()
    }
    const idle = shown('not_checked') + shown('not_set_up')
    expect(idle).toBeGreaterThan(0)
    expect(container.querySelector('[data-testid="checks-idle-count"]')!.textContent).toBe(`(${idle})`)
    expect(container.querySelector('[data-testid="checks-passing"] summary')!.textContent).toContain(`${shown('pass')}passing`)
  })

  it('lists the checks that are not running yet in one compact list, without a group footer per card', () => {
    render()
    const list = container.querySelector('[data-testid="checks-idle"]')!
    const rows = [...list.querySelectorAll('li[data-testid^="checks-card-"]')]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(['not_checked', 'not_set_up']).toContain(row.getAttribute('data-state'))
    // Round 3: each state is named once as a group, not as a pill on every row.
    expect(list.querySelectorAll('[data-testid="status-pill"]')).toHaveLength(0)
    // No card in the grid is idle any more; the idle ones live in the list only.
    const grid = container.querySelector('ul[aria-label="Checks, failing first"]')
    for (const li of grid?.querySelectorAll('li') ?? []) expect(['not_checked', 'not_set_up']).not.toContain(li.getAttribute('data-state'))
    expect(container.textContent).not.toContain('App checks')
  })

  // Console polish 2026-11-22: one kind of idle check read "Not running yet (2)" over "Not run yet 2".
  it('names the idle list once: one heading, and group labels only when there are two kinds', () => {
    render()
    const list = container.querySelector('[data-testid="checks-idle"]')!
    const title = list.querySelector('h2')!.textContent!.replace(/\(\d+\)$/, '').trim()
    const labels = [...list.querySelectorAll('[data-testid="checks-idle-group-label"]')].map((p) => p.textContent!.replace(/\d+$/, '').trim())
    const groups = list.querySelectorAll('[data-testid^="checks-idle-not_"]').length
    if (groups > 1) {
      expect(title).toBe('Not running yet')
      expect(labels).toEqual(['Not set up', 'Not run yet'])
    } else {
      expect(['Not set up', 'Not run yet']).toContain(title)
      expect(labels).toEqual([])
      // "Not run…" names the list once, never as a heading and again as a label just under it.
      expect((list.textContent!.match(/Not run(ning)? yet/g) ?? []).length).toBeLessThanOrEqual(1)
    }
  })

  it('never spins: a read with no answer after 20 s reads as not checked, with Retry', () => {
    vi.useFakeTimers()
    try {
      render()
      expect(container.querySelector('[data-testid="checks-not-checked"]')).toBeNull()
      act(() => {
        vi.advanceTimersByTime(20_000)
      })
      const row = container.querySelector('[data-testid="checks-not-checked"]')!
      expect(row.textContent).toContain('not checked')
      expect(row.querySelector('button')?.textContent).toBe('Retry')
      // The recipe read never answered: its card is "could not read", not "Checking…".
      expect(container.querySelector('[data-testid="checks-card-recipe"]')?.getAttribute('data-state')).toBe('unavailable')
      expect(container.textContent).not.toContain('Checking…')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a plan-gated check visible with an upgrade pill', () => {
    render()
    expect(container.querySelector('[data-testid="upgrade-inventory_v2"]')).not.toBeNull()
    state.features = new Set(['inventory_v2'])
    render()
    expect(container.querySelector('[data-testid="upgrade-inventory_v2"]')).toBeNull()
  })

  it('lists a Lab page only while its Lab is on', () => {
    render()
    for (const path of LAB_PATHS) expect(container.querySelector(`a[href="${path}"]`), path).toBeNull()
    state.labs = new Set(['ai-prompts', 'ci-runners'])
    render()
    for (const path of LAB_PATHS) expect(container.querySelector(`a[href="${path}"]`), path).not.toBeNull()
  })

  it('reads a failed nav-meta as Status unavailable, never as a pass', () => {
    state.navError = 'timeout'
    render()
    const qa = container.querySelector('[data-testid="checks-card-qa-coverage"]')!
    expect(qa.getAttribute('data-state')).toBe('unavailable')
    expect(qa.textContent).toContain('Status unavailable')
    expect(container.querySelector('[data-state="pass"]')).toBeNull()
    // Never "nothing needs you" over checks that could not be read.
    expect(container.querySelector('[data-testid="checks-status"]')?.textContent).not.toContain('No check needs you')
    expect(container.querySelector('[data-testid="checks-status"]')?.textContent).toContain('could not read')
  })
})

describe('ChecksPage signals (2026-11-18)', () => {
  const DAYS = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
  const q = (id: string) => container.querySelector(`[data-testid="${id}"]`)

  it('leads with an alert card for the check with findings, with its number', () => {
    render()
    const alert = q('checks-alert-qa-coverage')!
    expect(alert.getAttribute('data-severity')).toBe('serious')
    expect(alert.textContent).toContain('Scheduled tests')
    expect(alert.textContent).toContain('1finding')
    // The number is the metric; the title does not repeat it (2026-11-18 round 2: "2 to fix" beside "2 findings").
    expect(alert.textContent).not.toContain('to fix')
    expect(alert.querySelector('a[href="/qa-coverage"]')?.textContent).toBe('Open')
    // A passing check is not an alert.
    expect(q('checks-alert-fullstack-audit')).toBeNull()
  })

  it('shows the change since the last visit against the remembered count, and keeps it while a check is unread', () => {
    window.localStorage.setItem('mushi:checks-baseline:p1', JSON.stringify({ '/qa-coverage': 0 }))
    render()
    expect(q('checks-alert-qa-coverage')!.textContent).toContain('▲ +1')
    // Shown on the alert card; the grid does not repeat the check.
    // Several slices are unread in this fixture, so the remembered count is not overwritten.
    expect(window.localStorage.getItem('mushi:checks-baseline:p1')).toBe(JSON.stringify({ '/qa-coverage': 0 }))
  })

  it('never shows a change without a remembered count', () => {
    render()
    expect(container.querySelector('[data-testid="checks-change"]')).toBeNull()
  })

  it('grades a 14-day-old run worse than a fresh one, with a shape, and keeps a 4-day age neutral', () => {
    render()
    const fresh = q('checks-card-fullstack-audit')!.querySelector('[data-testid="checks-age"]')!
    expect(fresh.getAttribute('data-tone')).toBe('ok')
    expect(fresh.className).toContain('ci-cell-0')
    // An age is not a failure: a 4-day-old pass is not red (2026-11-18).
    state.slices = slices({ fullstackAudit: { errorCount: 0, warnCount: 0, failedGateCount: 0, lastRunAt: DAYS(4), topPriority: 'healthy' } })
    render()
    const mid = q('checks-card-fullstack-audit')!.querySelector('[data-testid="checks-age"]')!
    expect(mid.className).toContain('ci-cell-0')
    expect(mid.textContent).toMatch(/^●\dd$/)
    state.slices = slices({ fullstackAudit: { errorCount: 0, warnCount: 0, failedGateCount: 0, lastRunAt: DAYS(14), topPriority: 'healthy' } })
    render()
    const old = q('checks-card-fullstack-audit')!.querySelector('[data-testid="checks-age"]')!
    expect(old.getAttribute('data-tone')).toBe('danger')
    expect(old.className).toContain('ci-fail-5')
    expect(old.textContent).toMatch(/^▲1[34]d$/) // the page clock is set at mount
  })

  it('raises a stale alert for a pass whose run is over a week old', () => {
    state.slices = slices({ fullstackAudit: { errorCount: 0, warnCount: 0, failedGateCount: 0, lastRunAt: DAYS(10), topPriority: 'healthy' } })
    render()
    const alert = q('checks-alert-fullstack-audit')!
    expect(alert.textContent).toContain('Stale 10d')
    expect(alert.textContent).toContain('since last run')
  })

  it('folds passing checks into one line, keeping the checks that need you open', () => {
    render()
    const fold = q('checks-passing') as HTMLDetailsElement
    expect(fold.tagName).toBe('DETAILS')
    expect(fold.open).toBe(false)
    expect(fold.querySelector('summary')!.textContent).toContain('1passing')
    expect(fold.querySelector('[data-testid="checks-card-fullstack-audit"]')).not.toBeNull()
    expect(fold.querySelector('[data-testid="checks-card-qa-coverage"]')).toBeNull()
    // The summary itself never claims a state.
    expect(fold.querySelector('summary')!.hasAttribute('data-state')).toBe(false)
  })
})

describe('idleSection', () => {
  const card = (state: string) => ({ view: { state } }) as never
  it('names one kind of idle check in the heading, with no group label under it', () => {
    const one = idleSection([card('not_checked'), card('not_checked')])
    expect(one.title).toBe('Not run yet')
    expect(one.labelGroups).toBe(false)
    expect(one.groups.map((g) => g.id)).toEqual(['not_checked'])
    expect(idleSection([card('not_set_up')]).title).toBe('Not set up')
  })

  it('keeps the umbrella heading and labels each group when both kinds are idle', () => {
    const both = idleSection([card('not_checked'), card('not_set_up'), card('not_set_up')])
    expect(both.title).toBe('Not running yet')
    expect(both.labelGroups).toBe(true)
    expect(both.groups.map((g) => [g.word, g.cards.length])).toEqual([
      ['Not set up', 2],
      ['Not run yet', 1],
    ])
  })
})

describe('sortCheckCards + checksStatus', () => {
  const item = (label: string) => ({ label }) as never
  const view = (state: string, chip: string) => ({ state, chip, detail: null, setupTo: null, tone: 'neutral' }) as never

  it('orders failed, findings, unknown, not set up, then pass, keeping registry order within a state', () => {
    const cards = [
      { path: '/a', item: item('A'), view: view('pass', 'Pass') },
      { path: '/b', item: item('B'), view: view('findings', '2 findings') },
      { path: '/c', item: item('C'), view: view('not_set_up', 'Not set up') },
      { path: '/d', item: item('D'), view: view('failed', 'Failed') },
      { path: '/e', item: item('E'), view: null },
    ]
    expect(sortCheckCards(cards).map((c) => c.path)).toEqual(['/d', '/b', '/c', '/a', '/e'])
  })

  it('says nothing needs you only when every card has been read', () => {
    const done = [{ path: '/a', item: item('A'), view: view('pass', 'Pass') }]
    expect(checksStatus(done)).toEqual({ tone: 'ok', sentence: 'No check needs you right now. 1 passes.' })
    expect(checksStatus([...done, { path: '/b', item: item('B'), view: null }]).sentence).toBe('Reading your checks…')
  })
})
