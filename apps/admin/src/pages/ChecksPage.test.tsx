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
 *   - a nav-meta read that failed is "Status unavailable", never a pass.
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

import { ChecksPage, checksStatus, sortCheckCards } from './ChecksPage'

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
      expect(li, path).not.toBeNull()
      expect(li!.querySelector(`a[href="${path}"]`)?.textContent).toBe(entry.label)
      expect(li!.textContent).toContain(entry.paletteDescription)
    }
  })

  it('gives every card a state and puts the failing check first', () => {
    render()
    const order = cardOrder()
    expect(order[0]).toBe('/qa-coverage')
    expect(container.querySelector('[data-testid="checks-card-qa-coverage"]')?.getAttribute('data-state')).toBe('findings')
    expect(container.querySelector('[data-testid="checks-card-fullstack-audit"]')?.getAttribute('data-state')).toBe('pass')
    // Every card says something; none is blank once its read is done.
    for (const li of container.querySelectorAll('li[data-testid^="checks-card-"]')) {
      if (li.getAttribute('data-testid')?.match(/recipe|design/)) continue
      expect(li.getAttribute('data-state'), li.getAttribute('data-testid')!).not.toBe('loading')
    }
  })

  it('leads with one sentence and one action to the failing check', () => {
    render()
    const status = container.querySelector('[data-testid="checks-status"]')!
    expect(status.textContent).toContain('1 check needs you: Scheduled tests (1 finding).')
    expect(status.querySelector('a[href="/qa-coverage"]')?.textContent).toBe('Open Scheduled tests')
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
