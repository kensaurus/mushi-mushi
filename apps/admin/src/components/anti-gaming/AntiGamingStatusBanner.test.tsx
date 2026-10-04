/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/anti-gaming/AntiGamingStatusBanner.test.tsx
 * PURPOSE: Group K entry 213 — the banner buttons call the page's handler
 *          (filter + scroll) instead of a link that only changed the URL.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AntiGamingStatusBanner } from './AntiGamingStatusBanner'
import { EMPTY_ANTI_GAMING_STATS, type AntiGamingStats } from './AntiGamingStatsTypes'

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

function stats(over: Partial<AntiGamingStats>): AntiGamingStats {
  return { ...EMPTY_ANTI_GAMING_STATS, hasAnyProject: true, projectName: 'Shop', ...over }
}

async function clickButton(s: AntiGamingStats, label: RegExp, onTab: (t: string) => void) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(AntiGamingStatusBanner, { stats: s, onTab })))
  })
  const btn = Array.from(container.querySelectorAll('button, a')).find((b) => label.test(b.textContent ?? ''))
  expect(btn?.tagName).toBe('BUTTON')
  await act(async () => (btn as HTMLButtonElement).click())
}

describe('AntiGamingStatusBanner actions', () => {
  it('"Open flagged" asks the page to show flagged devices', async () => {
    const onTab = vi.fn()
    await clickButton(stats({ topPriority: 'flagged', flaggedDevices: 2, topPriorityTo: '/anti-gaming?filter=flagged' }), /Open flagged/, onTab)
    expect(onTab).toHaveBeenCalledWith('devices')
  })

  it('"Review devices" on cross-account abuse goes to the device list', async () => {
    const onTab = vi.fn()
    await clickButton(stats({ topPriority: 'cross_account', crossAccountDevices: 1, topPriorityTo: '/anti-gaming?filter=flagged' }), /Review devices/, onTab)
    expect(onTab).toHaveBeenCalledWith('devices')
  })

  it('"Open events" goes to the event log', async () => {
    const onTab = vi.fn()
    await clickButton(stats({ topPriority: 'velocity', velocityEvents24h: 3, topPriorityTo: '/anti-gaming?tab=events' }), /Open events/, onTab)
    expect(onTab).toHaveBeenCalledWith('events')
  })
})
