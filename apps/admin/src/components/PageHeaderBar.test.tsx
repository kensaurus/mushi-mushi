/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/PageHeaderBar.test.tsx
 * PURPOSE: The mobile PDCA/overview chip must stay inside the header row.
 *
 * OVERVIEW:
 * - At 390px the breadcrumb is hidden, so PageHeaderBar renders the chip
 *   itself. The overview label ("Overview — your loop at a glance") is wider
 *   than the column; when the chip could not shrink it overflowed its row and
 *   rendered on top of the right-hand freshness pill.
 * - Asserts the chip is shrinkable and its label truncates instead.
 *
 * DEPENDENCIES: react-dom/client, react-router-dom (MemoryRouter), vitest.
 *
 * NOTES: jsdom has no layout engine, so the guard is on the layout contract
 * (classes) rather than measured geometry.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PageH1Provider, SidebarWordmark } from '../lib/pageH1'
import { PageHeaderBar } from './PageHeaderBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('PageHeaderBar overview chip', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    // Phone viewport: the breadcrumb is hidden, so the chip renders here.
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderDashboardHeader() {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/dashboard'] },
          createElement(
            PageHeaderBar,
            { title: 'Home', showCopyLink: false },
            createElement('span', null, 'now'),
          ),
        ),
      )
    })
  }

  it('renders a chip that can shrink instead of overflowing the row', () => {
    renderDashboardHeader()
    const chip = container.querySelector<HTMLElement>('[aria-label^="Overview:"]')
    expect(chip).not.toBeNull()
    const cls = chip!.className
    expect(cls).toContain('min-w-0')
    expect(cls).toContain('max-w-full')
    expect(cls.split(/\s+/)).not.toContain('shrink-0')
    // The tooltip anchor is the actual flex item — it must shrink too.
    expect(chip!.parentElement!.className).toContain('min-w-0')
    expect(container.querySelector('h2')?.textContent).toContain('Home')
    expect(container.querySelector('h1')).toBeNull()
  })

  it('truncates the chip label rather than widening the header', () => {
    renderDashboardHeader()
    const chip = container.querySelector<HTMLElement>('[aria-label^="Overview:"]')
    // The label is the cycle's word now ("Overview"), not "PDCA …" (P5).
    const label = Array.from(chip!.querySelectorAll('span')).find((el) => el.textContent === 'Overview')
    expect(label).toBeDefined()
    expect(label!.className).toContain('truncate')
  })

  it('can title the page with an h1', () => {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/fixes'] },
          createElement(PageHeaderBar, { title: 'Fixes', titleAs: 'h1', showCopyLink: false }),
        ),
      )
    })
    expect(container.querySelector('h1')?.textContent).toBe('Fixes')
    expect(container.querySelector('h2')).toBeNull()
  })

  it('replaces the sidebar wordmark h1 when the page title is an h1', () => {
    act(() => {
      root.render(
        createElement(
          PageH1Provider,
          null,
          createElement(
            'div',
            null,
            createElement(SidebarWordmark, { compact: false }),
            createElement(
              MemoryRouter,
              { initialEntries: ['/fixes'] },
              createElement(PageHeaderBar, { title: 'Fixes', titleAs: 'h1', showCopyLink: false }),
            ),
          ),
        ),
      )
    })
    const brand = [...container.querySelectorAll('p')].find((el) => el.textContent === 'mushimushi')
    expect(brand?.className).toContain('heading-rhythm')
    expect([...container.querySelectorAll('h1')].map((el) => el.textContent)).toEqual(['Fixes'])
  })

  it('leaves the sidebar wordmark as the only h1 when the page title stays an h2', () => {
    act(() => {
      root.render(
        createElement(
          PageH1Provider,
          null,
          createElement(
            'div',
            null,
            createElement(SidebarWordmark, { compact: false }),
            createElement(
              MemoryRouter,
              { initialEntries: ['/dashboard'] },
              createElement(PageHeaderBar, { title: 'Home', showCopyLink: false }),
            ),
          ),
        ),
      )
    })
    expect([...container.querySelectorAll('h1')].map((el) => el.textContent)).toEqual(['mushimushi'])
    expect(container.querySelector('h2')?.textContent).toContain('Home')
  })
})
