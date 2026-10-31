/**
 * @vitest-environment jsdom
 */

/**
 * Apps sat on "Reading every app's recipe…" for over 5 s on a first load
 * while the team's app list was already loaded (integrator's new-user walk,
 * 2026-10-28). It now lists the apps at once and fills in their details.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { error: null, reload: vi.fn(), lastFetchedAt: null, isValidating: false }
    if (path === '/v1/admin/workspace/projects') {
      return { ...base, loading: false, data: { projects: [{ id: 'p1', name: 'glot.it', organizationId: 'o1' }, { id: 'p2', name: 'yen-yen', organizationId: 'o1' }, { id: 'p3', name: 'other-team-app', organizationId: 'o2' }] } }
    }
    return { ...base, loading: path != null, data: null }
  },
}))
vi.mock('../components/OrgSwitcher', () => ({ useActiveOrgId: () => 'o1' }))
vi.mock('../lib/projectGroups', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProjectGroups: () => ({ data: { groups: [] }, loading: false }),
  readActiveGroup: () => null,
  writeActiveGroup: () => {},
}))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: ({ title }: { title: string }) => createElement('h1', null, title) }))

import { PortfolioPage } from './PortfolioPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Apps while loading', () => {
  it("lists the team's apps instead of a bare spinner", async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(PortfolioPage)))
    })
    const list = container.querySelector('[data-testid="portfolio-loading-apps"]')
    expect(list?.textContent).toContain('glot.it')
    expect(list?.textContent).toContain('yen-yen')
    expect(list?.textContent).not.toContain('other-team-app')
    expect(container.textContent).not.toContain("recipe")
  })
})
