/**
 * @vitest-environment jsdom
 */

/**
 * ADR 0066: a hub's view tabs sit under the page title. The hub hands them to
 * the first header in the view; until a header claims them, the hub shows them
 * itself, so a loading or locked view still has its tabs.
 */

import { act, createElement, Fragment, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PageHeaderTabsProvider, useClaimedHeaderTabs } from './PageHeaderTabs'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Header({ title }: { title: string }) {
  const tabs = useClaimedHeaderTabs()
  return createElement('header', { 'data-title': title }, createElement('h2', null, title), tabs)
}

/** The provider with children passed as a prop, as its type asks. */
const provider = (...kids: ReactNode[]) => createElement(PageHeaderTabsProvider, { tabs, children: createElement(Fragment, null, ...kids) })

const tabs = createElement('nav', { 'data-testid': 'tabs' }, 'Members Billing')

describe('PageHeaderTabs', () => {
  it('puts the tabs under the first header title, once', () => {
    act(() =>
      root.render(
        provider(createElement(Header, { title: 'Billing' }), createElement(Header, { title: 'Inner panel' })),
      ),
    )
    expect(host.querySelectorAll('[data-testid="tabs"]')).toHaveLength(1)
    const header = host.querySelector('header[data-title="Billing"]')!
    expect(header.children[0].tagName).toBe('H2')
    expect(header.querySelector('[data-testid="tabs"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="page-header-tabs-fallback"]')).toBeNull()
  })

  it('shows the tabs at the top while no header has mounted', () => {
    act(() => root.render(provider(createElement('p', null, 'Loading…'))))
    expect(host.querySelector('[data-testid="page-header-tabs-fallback"] [data-testid="tabs"]')).not.toBeNull()
  })

  it('hands the tabs to the next header when the first one goes', () => {
    act(() => root.render(provider(createElement(Header, { title: 'Members' }))))
    act(() => root.render(provider(createElement(Header, { key: 'b', title: 'Billing' }))))
    expect(host.querySelectorAll('[data-testid="tabs"]')).toHaveLength(1)
    expect(host.querySelector('header[data-title="Billing"] [data-testid="tabs"]')).not.toBeNull()
  })

  it('a header outside any hub shows no tabs', () => {
    act(() => root.render(createElement(Header, { title: 'Bugs' })))
    expect(host.querySelector('[data-testid="tabs"]')).toBeNull()
  })
})
