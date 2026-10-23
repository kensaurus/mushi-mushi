/**
 * @vitest-environment jsdom
 *
 * The phone wordmark h1 is shared by every admin page. It must stay absent
 * when the page already has an h1, or the heading outline gains a second one.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number

  beforeEach(() => {
    frames = new Map()
    nextFrame = 1
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextFrame++
      frames.set(id, cb)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id)
    })
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
    vi.unstubAllGlobals()
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

  /** Lets the observer deliver its records, then runs the queued frame. */
  async function paint() {
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      const queued = [...frames.values()]
      frames.clear()
      for (const cb of queued) cb(0)
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
    await paint()
    expect(flag()).toBe('no')
    outside.remove()

    const heading = document.createElement('h1')
    heading.textContent = 'Loop is clean'
    main.appendChild(heading)
    await paint()
    expect(flag()).toBe('yes')

    heading.remove()
    await paint()
    expect(flag()).toBe('no')
  })

  it('looks for an h1 once per frame, however many mutations land in it', async () => {
    await render('/fixes')
    const lookup = vi.spyOn(main, 'querySelector')

    for (let i = 0; i < 5; i++) {
      main.appendChild(document.createElement('div'))
      // Each await delivers a separate batch of mutation records.
      await act(async () => {
        await Promise.resolve()
      })
    }
    expect(lookup).not.toHaveBeenCalled()
    expect(frames.size).toBe(1)

    await paint()
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('drops a pending frame when the page changes', async () => {
    await render('/fixes')
    main.appendChild(document.createElement('div'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(frames.size).toBe(1)

    await render('/credits')
    expect(frames.size).toBe(0)
  })
})
