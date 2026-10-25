/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/RoutePageHelp.test.tsx
 * PURPOSE: The checks-page gap wraps the help banner only on /checks.
 *          Other routes render the banner with no extra wrapper.
 */

import { act, createElement, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PageHelpProvider, usePageHelpRegister } from '../lib/pageHelpContext'
import { RoutePageHelp } from './RoutePageHelp'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function HelpSeed() {
  const register = usePageHelpRegister()
  useLayoutEffect(() => {
    register({ title: 'About Checks', whatIsIt: 'Each card is one automatic check.', howToUse: 'Open a card.' })
    return () => register(null)
  }, [register])
  return null
}

let container: HTMLDivElement
let root: Root

function renderAt(path: string) {
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(PageHelpProvider, null,
        createElement(HelpSeed),
        createElement(RoutePageHelp),
      )))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('RoutePageHelp', () => {
  it('renders the banner with no extra wrapper on other routes', () => {
    renderAt('/health')
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    const banner = details?.parentElement
    expect(banner?.className).toContain('mb-3')
    expect(banner?.parentElement).toBe(container)
    expect(container.querySelector('.mt-4')).toBeNull()
  })

  it('wraps the banner in the checks gap', () => {
    renderAt('/checks')
    const details = container.querySelector('details')
    const gap = details?.parentElement?.parentElement
    expect(gap?.className).toContain('mt-4')
    expect(gap?.parentElement).toBe(container)
  })
})
