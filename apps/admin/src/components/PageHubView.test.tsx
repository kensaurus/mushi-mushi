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
 *          A view that mounts two headers still draws the switcher once.
 *
 * DEPENDENCIES: react-dom/client + act (no testing-library in this app);
 *               useEntitlements is mocked because it fetches.
 */

import { act, createElement, StrictMode, useState } from 'react'
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

  it('renders the view switcher once when a view mounts two page headers', () => {
    renderHub(() =>
      createElement(
        'div',
        null,
        createElement(PageHeaderBar, { title: 'Home', showCopyLink: false }),
        createElement(PageHeaderBar, { title: 'Section', showCopyLink: false }),
      ),
    )

    const titles = Array.from(container.querySelectorAll('h2'))
    const tabs = switcher()
    expect(titles.map((t) => t.textContent)).toEqual(['Home', 'Section'])
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(1)
    expect(tabs).not.toBeNull()
    // The only copy sits under the first title, not under the nested one.
    expect(titles[0].compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(titles[1].compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('renders the view switcher once under StrictMode when two headers mount', () => {
    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            MemoryRouter,
            null,
            createElement(PageHubView, {
              hub: HOME_HUB,
              render: {
                today: () =>
                  createElement(
                    'div',
                    null,
                    createElement(PageHeaderBar, { title: 'Home', showCopyLink: false }),
                    createElement(PageHeaderBar, { title: 'Section', showCopyLink: false }),
                  ),
              },
            }),
          ),
        ),
      )
    })

    const titles = Array.from(container.querySelectorAll('h2'))
    expect(titles.map((t) => t.textContent)).toEqual(['Home', 'Section'])
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(1)
    const tabs = switcher()
    expect(titles[0].compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(titles[1].compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('hands the switcher to the next header when the first one unmounts', () => {
    function View() {
      const [first, setFirst] = useState(true)
      return createElement(
        'div',
        null,
        createElement('button', { type: 'button', onClick: () => setFirst(false) }, 'Drop first'),
        first ? createElement(PageHeaderBar, { title: 'Home', showCopyLink: false }) : null,
        createElement(PageHeaderBar, { title: 'Section', showCopyLink: false }),
      )
    }
    renderHub(() => createElement(View))

    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(1)
    const drop = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Drop first')
    act(() => { drop?.click() })

    const titles = Array.from(container.querySelectorAll('h2'))
    const tabs = switcher()
    expect(titles.map((t) => t.textContent)).toEqual(['Section'])
    expect(container.querySelectorAll('[role="radiogroup"]').length).toBe(1)
    expect(titles[0].compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
