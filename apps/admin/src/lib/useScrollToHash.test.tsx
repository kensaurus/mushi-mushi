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
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('waits until the page is ready', async () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    await render('/integrations/config#platform-card-sentry', false)
    expect(spy).not.toHaveBeenCalled()
  })
})
