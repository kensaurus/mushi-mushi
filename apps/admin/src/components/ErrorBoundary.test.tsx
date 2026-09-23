/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, useEffect } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { ErrorBoundary, RouteErrorBoundary } from './ErrorBoundary'

vi.mock('../lib/sentry', () => ({
  Sentry: { captureException: vi.fn(), captureMessage: vi.fn() },
}))

const FALLBACK = 'Something'
const RECOVERED = 'recovered page'

// Typed as returning ReactNode (never actually returns) so it satisfies
// createElement's FunctionComponent overload.
function Boom(): ReactNode {
  throw new Error('boom')
}

// Lives OUTSIDE the boundary so it survives the crash and can drive the
// router the way a user clicking a sidebar link would.
let navigate: ((to: string) => void) | null = null
function NavCapture() {
  const n = useNavigate()
  useEffect(() => {
    navigate = n
  }, [n])
  return null
}

type BoundaryComponent = ComponentType<{ source?: string; children: ReactNode }>

function mount(Boundary: BoundaryComponent): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/crash'] },
        createElement(NavCapture),
        createElement(Boundary, {
          source: 'test',
          children: createElement(
            Routes,
            null,
            createElement(Route, { path: '/crash', element: createElement(Boom) }),
            createElement(Route, { path: '/ok', element: createElement('p', null, RECOVERED) }),
          ),
        }),
      ),
    )
  })
  return { container, root }
}

describe('ErrorBoundary', () => {
  let roots: Root[] = []

  beforeEach(() => {
    // React reports caught render errors via console.error; that is the
    // behaviour under test, not noise worth failing on.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    navigate = null
  })

  afterEach(() => {
    for (const root of roots) act(() => root.unmount())
    roots = []
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders the editorial fallback when a route throws', () => {
    const { container, root } = mount(RouteErrorBoundary)
    roots.push(root)
    expect(container.textContent).toContain(FALLBACK)
    expect(container.textContent).not.toContain(RECOVERED)
  })

  it('RouteErrorBoundary clears the error when the pathname changes', () => {
    const { container, root } = mount(RouteErrorBoundary)
    roots.push(root)
    expect(container.textContent).toContain(FALLBACK)

    act(() => navigate!('/ok'))

    expect(container.textContent).toContain(RECOVERED)
    expect(container.textContent).not.toContain(FALLBACK)
  })

  it('a plain ErrorBoundary keeps the error after navigation — the pre-fix behaviour', () => {
    // Documents WHY RouteErrorBoundary exists: wrapped around <Routes>, a
    // boundary that never resets turns one page crash into every page
    // showing the fallback until a hard reload (IteratePage, 2026-09-23).
    const { container, root } = mount(ErrorBoundary)
    roots.push(root)
    expect(container.textContent).toContain(FALLBACK)

    act(() => navigate!('/ok'))

    expect(container.textContent).toContain(FALLBACK)
    expect(container.textContent).not.toContain(RECOVERED)
  })

  it('resetKeys reset only on change — an unchanged key leaves the fallback in place', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const renderWithKey = (key: string, child: ReactNode) =>
      act(() => {
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(ErrorBoundary, { source: 'test', resetKeys: [key], children: child }),
          ),
        )
      })

    renderWithKey('a', createElement(Boom))
    expect(container.textContent).toContain(FALLBACK)

    // Same key: React re-renders the boundary but nothing changed — stays.
    renderWithKey('a', createElement(Boom))
    expect(container.textContent).toContain(FALLBACK)

    // New key: the error clears and children render again — and throw
    // again, which is the correct outcome for a page that is genuinely
    // broken. Prove the reset happened by checking the child was re-invoked.
    const boomSpy = vi.fn((): ReactNode => {
      throw new Error('boom again')
    })
    const BoomSpy = (): ReactNode => boomSpy()
    renderWithKey('b', createElement(BoomSpy))
    expect(boomSpy).toHaveBeenCalled()
  })
})
