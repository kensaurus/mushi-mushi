/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/lib/useQuickLandingTab.test.tsx
 * PURPOSE: Quickstart lands on the posture tab once, never over an explicit
 *          `?tab=`, and never again after the user moves.
 */
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQuickLandingTab } from './useQuickLandingTab'

type Tab = 'overview' | 'browse' | 'installed'

let setTabFromTest: (t: Tab) => void = () => {}
let setStatsFromTest: (n: number) => void = () => {}

function Harness(props: { enabled: boolean; explicit: boolean; initial: Tab; apply: (t: Tab) => void }) {
  const [tab, setTab] = useState<Tab>(props.initial)
  const [installed, setInstalled] = useState(1)
  setTabFromTest = setTab
  setStatsFromTest = setInstalled
  useQuickLandingTab<Tab>({
    enabled: props.enabled,
    ready: true,
    hasExplicitTab: props.explicit,
    activeTab: tab,
    resolve: () => (installed > 0 ? 'installed' : 'browse'),
    apply: (t) => {
      props.apply(t)
      setTab(t)
    },
  })
  return createElement('span', { 'data-tab': tab }, tab)
}

describe('useQuickLandingTab', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('lands on the posture tab once when the URL names no tab', async () => {
    const apply = vi.fn()
    await act(async () => {
      root.render(createElement(Harness, { enabled: true, explicit: false, initial: 'overview', apply }))
    })
    expect(apply).toHaveBeenCalledWith('installed')
    expect(container.textContent).toBe('installed')
  })

  it('lets the user move to another tab and stay there, even when the stats change', async () => {
    const apply = vi.fn()
    await act(async () => {
      root.render(createElement(Harness, { enabled: true, explicit: false, initial: 'overview', apply }))
    })
    await act(async () => setTabFromTest('browse'))
    await act(async () => setStatsFromTest(2))
    expect(container.textContent).toBe('browse')
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('never overrides an explicit ?tab=', async () => {
    const apply = vi.fn()
    await act(async () => {
      root.render(createElement(Harness, { enabled: true, explicit: true, initial: 'browse', apply }))
    })
    expect(apply).not.toHaveBeenCalled()
    expect(container.textContent).toBe('browse')
  })

  it('does nothing outside quickstart', async () => {
    const apply = vi.fn()
    await act(async () => {
      root.render(createElement(Harness, { enabled: false, explicit: false, initial: 'overview', apply }))
    })
    expect(apply).not.toHaveBeenCalled()
  })
})
