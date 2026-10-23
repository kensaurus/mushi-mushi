/**
 * @vitest-environment jsdom
 *
 * The phone wordmark h1 is shared by every admin page. It must stay absent
 * when the page already has an h1, or the heading outline gains a second one.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { showMobileWordmarkH1, useMainHasH1 } from './mobileWordmarkHeading'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('showMobileWordmarkH1', () => {
  it('shows the phone h1 only while the drawer is closed and the page has none', () => {
    expect(showMobileWordmarkH1(false, false)).toBe(true)
    expect(showMobileWordmarkH1(true, false)).toBe(false)
    // Dashboard, CLI/MCP connect, and editorial errors already render an h1.
    expect(showMobileWordmarkH1(false, true)).toBe(false)
    expect(showMobileWordmarkH1(true, true)).toBe(false)
  })
})

describe('useMainHasH1', () => {
  let root: Root
  let host: HTMLDivElement
  let main: HTMLElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    main = document.createElement('main')
    main.id = 'main-content'
    document.body.appendChild(main)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    main.remove()
  })

  function Probe({ path }: { path: string }) {
    const has = useMainHasH1(path)
    return createElement('span', { 'data-testid': 'has' }, has ? 'yes' : 'no')
  }

  async function render(path: string) {
    await act(async () => {
      root.render(createElement(Probe, { path }))
    })
  }

  function flag(): string {
    return host.querySelector('[data-testid="has"]')?.textContent ?? ''
  }

  it('follows h1s inside main and ignores one outside it', async () => {
    await render('/fixes')
    expect(flag()).toBe('no')

    const outside = document.createElement('h1')
    outside.textContent = 'sidebar'
    document.body.appendChild(outside)
    await act(async () => {
      await Promise.resolve()
    })
    expect(flag()).toBe('no')
    outside.remove()

    await act(async () => {
      const heading = document.createElement('h1')
      heading.textContent = 'Loop is clean'
      main.appendChild(heading)
    })
    expect(flag()).toBe('yes')

    await act(async () => {
      main.querySelector('h1')?.remove()
    })
    expect(flag()).toBe('no')
  })
})

describe('Layout phone heading', () => {
  it('asks the helper instead of always painting a phone h1', () => {
    const layout = readFileSync(resolve(__dirname, '../components/Layout.tsx'), 'utf8')
    expect(layout).toContain('showMobileWordmarkH1(mobileOpen, pageHasH1)')
    expect(layout).not.toContain('{!mobileOpen && <h1 className="sr-only">mushi mushi</h1>}')
  })
})
