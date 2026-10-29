/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/useScrollToHash.test.tsx
 * PURPOSE: A same-page `#anchor` link actually scrolls to its target.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScrollToHash } from './useScrollToHash'

function Probe({ ready }: { ready: boolean }) {
  useScrollToHash(ready)
  return createElement('div', { id: 'platform-card-sentry' }, 'Sentry')
}

describe('useScrollToHash', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  async function render(path: string, ready: boolean) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Probe, { ready })))
    })
  }

  it('scrolls the named element into view once ready', async () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    await render('/integrations/config?project=p#platform-card-sentry', true)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  describe('when cards above the target finish loading after the scroll', () => {
    let grow: (() => void) | null = null
    const disconnect = vi.fn()
    beforeEach(() => {
      grow = null
      disconnect.mockClear()
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: () => void) {
            grow = cb
          }
          observe() {}
          disconnect = disconnect
        },
      )
    })
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    })

    it('follows the target as the page grows (Settings > #ci-cost landed 2,750 px off)', async () => {
      const spy = vi.fn()
      Element.prototype.scrollIntoView = spy
      await render('/settings?tab=general#platform-card-sentry', true)
      grow!()
      grow!()
      expect(spy).toHaveBeenCalledTimes(3)
    })

    it('stops following once the person scrolls', async () => {
      const spy = vi.fn()
      Element.prototype.scrollIntoView = spy
      await render('/settings#platform-card-sentry', true)
      window.dispatchEvent(new Event('wheel'))
      grow!()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(disconnect).toHaveBeenCalled()
    })

    it('stops following after a few seconds', async () => {
      vi.useFakeTimers()
      const spy = vi.fn()
      Element.prototype.scrollIntoView = spy
      await render('/settings#platform-card-sentry', true)
      vi.advanceTimersByTime(4000)
      grow!()
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })

  it('waits until the page is ready', async () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    await render('/integrations/config#platform-card-sentry', false)
    expect(spy).not.toHaveBeenCalled()
  })
})
