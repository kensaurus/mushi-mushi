/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/PageHubView.test.tsx
 * PURPOSE: A hub's view switcher used to render above the whole page, so Home
 *          opened with the Today / Overview / User activity tabs and its
 *          "Home" title came second — unlike every other page (report
 *          04f7bd36). The switcher now renders inside the view's
 *          PageHeaderBar, under the title, and still renders above a view
 *          that has no header at all (skeleton, empty state, load error).
 *
 * DEPENDENCIES: react-dom/client + act (no testing-library in this app);
 *               useEntitlements is mocked because it fetches.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({
    planId: 'hobby',
    planName: 'Hobby',
    isSuperAdmin: false,
    isOperator: false,
    hasProject: true,
    projectRole: 'owner',
    canEditProject: true,
    has: () => true,
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

import { PageHeaderBar } from './PageHeaderBar'
import { PageHubView } from './PageHubView'
import { HOME_HUB } from '../lib/pageHubs'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  // jsdom has no matchMedia; PageHeaderBar's locationChrome reads it.
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

function renderHub(today: () => ReturnType<typeof createElement> | null) {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(PageHubView, { hub: HOME_HUB, render: { today } }),
      ),
    )
  })
}

function switcher(): HTMLElement | null {
  return container.querySelector('[role="radiogroup"]')
}

describe('PageHubView', () => {
  it('renders the view switcher after the page title, not before it', () => {
    renderHub(() =>
      createElement(PageHeaderBar, { title: 'Home', showCopyLink: false }),
    )

    const title = container.querySelector('h2')
    const tabs = switcher()
    expect(title?.textContent).toBe('Home')
    expect(tabs).not.toBeNull()
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(1)
    // DOCUMENT_POSITION_FOLLOWING: the tabs come after the title.
    expect(title!.compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the switcher above a view that renders no page header', () => {
    renderHub(() => createElement('p', null, 'Loading…'))

    const tabs = switcher()
    const content = container.querySelector('p')
    expect(tabs).not.toBeNull()
    expect(content!.compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })
})
