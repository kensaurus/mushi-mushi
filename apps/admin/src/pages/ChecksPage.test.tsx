/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/ChecksPage.test.tsx
 * PURPOSE: /checks is the one sidebar entry point to every automatic check.
 *   - every card carries the registry label and links to the registry path,
 *     so the launcher can never drift from the sidebar;
 *   - a plan-gated check (inventory_v2) stays visible with an upgrade pill;
 *   - the chip is the sidebar's own badge (judge disagreements here).
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
}))

vi.mock('../lib/useNavCounts', async (importOriginal) => {
  const actual = await importOriginal<typeof NavCountsModule>()
  return { ...actual, useNavCounts: () => state.counts }
})
vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({ isSuperAdmin: false, has: (flag: string) => state.features.has(flag) }),
}))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title }: { title: string }) => createElement('h1', null, title),
}))
vi.mock('../components/billing/UpgradeNudge', () => ({
  UpgradePill: ({ flag }: { flag: string }) => createElement('span', { 'data-testid': `upgrade-${flag}` }, 'Pro'),
}))

import { ChecksPage } from './ChecksPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CARD_PATHS = [
  '/qa-coverage', '/health', '/fullstack-audit', '/inventory', '/recipe', '/design', '/content',
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
      const link = container.querySelector<HTMLAnchorElement>(`a[href="${path}"]`)
      expect(link, path).not.toBeNull()
      expect(link?.textContent).toContain(entry!.label)
      expect(link?.textContent).toContain(entry!.paletteDescription)
    }
    expect(container.querySelectorAll('li a').length).toBe(CARD_PATHS.length)
  })

  it('keeps a plan-gated check visible with an upgrade pill, and drops the pill once entitled', () => {
    render()
    expect(container.querySelector('[data-testid="upgrade-inventory_v2"]')).not.toBeNull()
    expect(container.querySelector('a[href="/inventory"]')).not.toBeNull()

    state.features = new Set(['inventory_v2'])
    render()
    expect(container.querySelector('[data-testid="upgrade-inventory_v2"]')).toBeNull()
  })

  it('shows the sidebar badge count on the matching card', () => {
    state.counts = counts({ judgeDisagreements: 3 })
    render()
    const judge = container.querySelector('a[href="/judge"]')
    expect(judge?.textContent).toContain('3')
    expect(container.querySelector('a[href="/lessons"]')?.textContent).not.toContain('3')
  })
})
