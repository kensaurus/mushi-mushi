/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/lib/useQuickstartTab.test.tsx
 * PURPOSE: Quick mode used to re-force its posture tab on every render, so in
 *          the default mode deep links (/billing?tab=support,
 *          /notifications?tab=outbox), banner CTAs and tab clicks bounced
 *          straight back. These tests render a page-shaped harness in a real
 *          router and watch the URL.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement, useCallback } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { useQuickstartLandingTab } from './useQuickstartTab'

type Tab = 'overview' | 'plans' | 'support'

let currentSearch = ''
let selectTab: (tab: Tab) => void = () => {}

/** Same shape as BillingPage: the default tab deletes `?tab`. */
function Harness({ ready, quickTab }: { ready: boolean; quickTab: Tab }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const activeTab: Tab = param === 'plans' || param === 'support' ? param : 'overview'
  const setActiveTab = useCallback(
    (id: Tab) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )
  useQuickstartLandingTab({ enabled: true, ready, tabParam: param, activeTab, quickTab, setActiveTab })
  currentSearch = searchParams.toString()
  selectTab = setActiveTab
  return null
}

let root: Root | null = null

function mount(url: string, props: { ready: boolean; quickTab: Tab }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const render = (p: { ready: boolean; quickTab: Tab }) =>
    act(() => {
      root!.render(
        createElement(MemoryRouter, { initialEntries: [url] }, createElement(Harness, p)),
      )
    })
  render(props)
  return render
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  currentSearch = ''
})

describe('useQuickstartLandingTab', () => {
  it('opens the posture tab once the stats are ready', () => {
    const render = mount('/billing', { ready: false, quickTab: 'plans' })
    expect(currentSearch).toBe('')
    render({ ready: true, quickTab: 'plans' })
    expect(currentSearch).toBe('tab=plans')
  })

  it('keeps a deep link even when the posture asks for another tab', () => {
    const render = mount('/billing?tab=support', { ready: false, quickTab: 'overview' })
    render({ ready: true, quickTab: 'overview' })
    expect(currentSearch).toBe('tab=support')
  })

  it('lets the user pick the default tab after the posture tab opened', () => {
    const render = mount('/billing', { ready: true, quickTab: 'plans' })
    expect(currentSearch).toBe('tab=plans')
    act(() => selectTab('overview'))
    // Re-render with fresh stats, as a realtime reload would.
    render({ ready: true, quickTab: 'plans' })
    expect(currentSearch).toBe('')
  })

  it('lets an in-page button change the tab', () => {
    const render = mount('/billing', { ready: true, quickTab: 'overview' })
    act(() => selectTab('support'))
    render({ ready: true, quickTab: 'overview' })
    expect(currentSearch).toBe('tab=support')
  })

  it('does not override a click made before the stats arrived', () => {
    const render = mount('/billing', { ready: false, quickTab: 'plans' })
    act(() => selectTab('support'))
    render({ ready: true, quickTab: 'plans' })
    expect(currentSearch).toBe('tab=support')
  })

  it('does not follow later posture changes', () => {
    const render = mount('/billing', { ready: true, quickTab: 'plans' })
    expect(currentSearch).toBe('tab=plans')
    render({ ready: true, quickTab: 'overview' })
    expect(currentSearch).toBe('tab=plans')
  })
})
