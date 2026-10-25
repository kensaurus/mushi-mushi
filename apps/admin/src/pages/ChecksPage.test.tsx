/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/ChecksPage.test.tsx
 * PURPOSE: /checks is the one sidebar entry point to every automatic check.
 *   - every card carries the registry label and links to the registry path,
 *     so the launcher can never drift from the sidebar;
 *   - a plan-gated check (inventory_v2) stays visible with an upgrade pill;
 *   - the chip is the check's run (set up, not checked, pass, findings), never
 *     "All clear" from an empty counter.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NavCounts } from '../lib/useNavCounts'
import type * as NavCountsModule from '../lib/useNavCounts'
import { EMPTY_NAV_STAT_SLICES } from '../lib/extendedNavMeta'
import { NAV_REGISTRY } from '../lib/navRegistry'

const state = vi.hoisted(() => ({
  counts: null as unknown,
  features: new Set<string>(),
  projectId: 'proj-1' as string | null,
  recipe: { data: null as { elements: Record<string, { state: string; lastCheckedAt: string | null; findingsCount: number; links: { label: string; to: string }[] }> } | null, loading: true, error: null as string | null },
}))

vi.mock('../lib/useNavCounts', async (importOriginal) => {
  const actual = await importOriginal<typeof NavCountsModule>()
  return { ...actual, useNavCounts: () => state.counts }
})
vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({ isSuperAdmin: false, has: (flag: string) => state.features.has(flag) }),
}))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../lib/usePageData', () => ({ usePageData: () => state.recipe }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => state.projectId }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title }: { title: string }) => createElement('h1', null, title),
}))
vi.mock('../components/billing/UpgradeNudge', () => ({
  UpgradePill: ({ flag }: { flag: string }) => createElement('span', { 'data-testid': `upgrade-${flag}` }, 'Pro'),
}))

import { routeHelpClass } from '../components/RoutePageHelp'
import { ChecksPage } from './ChecksPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CARD_PATHS = [
  '/qa-coverage', '/health', '/ci', '/fullstack-audit', '/inventory', '/recipe', '/design', '/content',
  '/judge', '/lessons', '/prompt-lab',
]

function counts(over: Partial<NavCounts> = {}): NavCounts {
  return {
    untriagedBacklog: 0, fixesInFlight: 0, fixesFailed: 0, fixesRetryable: 0, prsOpen: 0,
    urgentOpenReports: 0, regressedActions: 0, inboxOpenActions: 0, notificationsUnread: 0,
    queueFailed: 0, healthIssues: 0, flaggedDevices: 0, feedbackWithReply: 0, judgeDisagreements: 0,
    projectCount: 1, projectsNeedingAttention: 0, neverIngestedCount: 0, staleKeyCount: 0,
    memberCount: null, pendingInvites: 0, membersInactiveCount: 0, membersAtSeatCap: false,
    membersExpiringInvites: 0, superAdminSignups7d: null, superAdminChurn30d: null,
    slices: EMPTY_NAV_STAT_SLICES, ready: true, ...over,
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
  state.counts = counts()
  state.features = new Set()
  state.projectId = 'proj-1'
  state.recipe = { data: null, loading: true, error: null }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ChecksPage', () => {
  it('renders one card per check with the registry label, linking to its path', () => {
    render()
    expect(container.querySelector('h1')?.textContent).toBe('Checks')
    expect(container.textContent).toContain('App checks')
    expect(container.textContent).toContain('AI quality')
    for (const path of CARD_PATHS) {
      const entry = NAV_REGISTRY.find((e) => e.path === path)
      expect(entry, path).toBeDefined()
      const card = container.querySelector(`[data-testid="checks-card-${path.slice(1)}"]`)
      const link = card?.querySelector<HTMLAnchorElement>(`a[href="${path}"]`)
      expect(link, path).not.toBeNull()
      expect(link?.textContent).toContain(entry!.label)
      expect(card?.textContent).toContain(entry!.paletteDescription)
    }
    expect(container.querySelectorAll('li a').length).toBe(CARD_PATHS.length)
    expect(container.textContent).not.toContain('All clear')
  })

  it('keeps a plan-gated check visible with an upgrade pill, and drops the pill once entitled', () => {
    render()
    expect(container.querySelector('[data-testid="upgrade-inventory_v2"]')).not.toBeNull()
    expect(container.querySelector('a[href="/inventory"]')).not.toBeNull()

    state.features = new Set(['inventory_v2'])
    render()
    expect(container.querySelector('[data-testid="upgrade-inventory_v2"]')).toBeNull()
  })

  it('shows set up, pass and findings from the check run, not an empty counter', () => {
    state.counts = counts({
      slices: {
        ...EMPTY_NAV_STAT_SLICES,
        qaCoverage: { totalStories: 0, failingStories: 0, pendingRuns: 0, topPriority: 'no_stories' },
        judge: { totalEvaluations: 4, disagreementCount: 0, lastEvalAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), topPriority: 'healthy' },
        contentQuality: {
          openCount: 2, inReviewCount: 0, regeneratingCount: 0, userFlagOpenCount: 0,
          failedRegenCount: 0, needsAttentionCount: 2, latestAt: new Date().toISOString(), topPriority: 'open_issues',
        },
      },
    })
    state.recipe = {
      loading: false,
      error: null,
      data: {
        elements: {
          ci: { state: 'not_connected', lastCheckedAt: null, findingsCount: 0, links: [{ label: 'Connect', to: '/integrations/config' }] },
        },
      },
    }
    render()
    const qa = container.querySelector('[data-testid="checks-card-qa-coverage"]')
    expect(qa?.textContent).toContain('Not set up')
    expect(qa?.textContent).toContain('Set up →')
    const judge = container.querySelector('[data-testid="checks-card-judge"]')
    expect(judge?.textContent).toContain('Pass')
    expect(judge?.textContent).toContain('Last run')
    const content = container.querySelector('[data-testid="checks-card-content"]')
    expect(content?.textContent).toContain('2 findings')
    expect(content?.textContent).toContain('Last run')
    const ci = container.querySelector('[data-testid="checks-card-ci"]')
    expect(ci?.textContent).toContain('Not set up')
    expect(ci?.querySelector('a[href="/integrations/config"]')?.textContent).toContain('Set up')
    expect(container.textContent).not.toContain('All clear')
  })

  it('puts top margin on the About Checks bar only', () => {
    expect(routeHelpClass('/checks')).toBe('mt-4')
    expect(routeHelpClass('/health')).toBe('')
  })
})
