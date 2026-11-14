/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/tester/TesterLayout.brand.test.tsx
 * PURPOSE: The tester portal's sidebar brand matches the console's (owner,
 *          2026-11-14): the mark (Kenji with Mushi-chan under his magnifier)
 *          plus the wordmark, one link back to the landing page.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'tester@example.com' }, signOut: async () => {} }),
}))
vi.mock('../../lib/useTesterStatus', () => ({
  useTesterStatus: () => ({ data: null, loading: true, error: null, reload: () => {} }),
  reputationTier: () => 'new',
}))
vi.mock('../../lib/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../SidebarBrandToggles', () => ({ SidebarBrandToggles: () => null }))
vi.mock('../SidebarFooterControls', () => ({ SidebarFooterControls: () => null }))
vi.mock('../SidebarUserCard', () => ({ SidebarUserCard: () => null }))
vi.mock('../RouteProgress', () => ({ RouteProgress: () => null }))
vi.mock('./TesterWelcomeEnroll', () => ({ TesterWelcomeEnroll: () => null }))

import { TesterLayout } from './TesterLayout'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= ((query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('the tester portal brand', () => {
  it('links the mark and wordmark to the landing page', () => {
    act(() => {
      root!.render(createElement(MemoryRouter, { initialEntries: ['/tester'] }, createElement(TesterLayout)))
    })
    const link = container!.querySelector<HTMLAnchorElement>('aside [data-testid="brand-home-link"]')
    expect(link?.getAttribute('href')).toBe('https://kensaur.us/mushi-mushi')
    expect(link?.getAttribute('aria-label')).toBe('Mushi Mushi home')
    expect(link?.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(link?.textContent).toBe('mushimushi')
  })
})
