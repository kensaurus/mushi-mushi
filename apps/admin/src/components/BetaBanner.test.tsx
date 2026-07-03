/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { BetaBanner } from './BetaBanner'
import { BETA_BANNER_TONE } from '../lib/tokens'

vi.mock('../lib/mushi-self', () => ({
  getMushiSelf: () => null,
  reportMushiBug: vi.fn(),
}))

type MockAuthReturn = { session: { user: { id: string } } | null }
const mockUseAuth = vi.fn((): MockAuthReturn => ({ session: { user: { id: 'user-1' } } }))

vi.mock('../lib/auth', () => ({
  useAuth: () => mockUseAuth(),
}))

describe('BetaBanner', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'user-1' } } })
    window.localStorage.clear()
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  it('uses lime muted chrome with foreground copy per product spec', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/dashboard'] },
          createElement(BetaBanner),
        ),
      )
    })

    const banner = container.querySelector('#mushi-beta-banner')
    expect(banner).toBeTruthy()
    expect(banner?.className).toContain('bg-lime-muted')
    expect(banner?.className).toContain('text-lime-foreground')
    expect(banner?.className).not.toContain('text-lime-fg')
    expect(BETA_BANNER_TONE).toContain('text-lime-foreground')
    expect(container.querySelector('.text-lime-foreground')).toBeTruthy()
    expect(container.querySelector('.text-lime-fg')).toBeNull()

    act(() => root.unmount())
    container.remove()
  })

  it('hides feedback actions on unauthenticated auth routes', () => {
    mockUseAuth.mockReturnValue({ session: null })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/login'] },
          createElement(BetaBanner),
        ),
      )
    })

    expect(container.textContent).toContain('Beta')
    expect(container.textContent).toContain('Dismiss')
    expect(container.textContent).not.toContain('Report a bug')
    expect(container.textContent).not.toContain('Feature request')
    expect(container.textContent).not.toContain('My submissions')

    act(() => root.unmount())
    container.remove()
  })
})
