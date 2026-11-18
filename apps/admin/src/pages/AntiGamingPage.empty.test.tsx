/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/pages/AntiGamingPage.empty.test.tsx
 * PURPOSE: With no tracked device, Spam & abuse shows one zero line instead of
 *          boxes of zeros, a neutral "not checked yet" state instead of a red
 *          banner, and plain empty lines instead of dashed cards in cards
 *          (2026-11-18 sweep).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ has: () => false, isSuperAdmin: false, canEditProject: true }) }))
vi.mock('../lib/realtime', () => ({ useRealtime: () => undefined }))
vi.mock('../lib/useNavCounts', () => ({ refreshNavCounts: () => undefined }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null }
    if (!path) return { ...base, data: null }
    if (path.startsWith('/v1/admin/anti-gaming/stats')) {
      return {
        ...base,
        data: { hasAnyProject: true, projectId: 'p1', projectName: 'kensaur.us', trackedDevices: 0, flaggedDevices: 0, crossAccountDevices: 0, totalReports: 4, topPriority: 'waiting', topPriorityLabel: null, topPriorityTo: null },
      }
    }
    if (path.startsWith('/v1/admin/anti-gaming/devices')) return { ...base, data: { devices: [] } }
    if (path.startsWith('/v1/admin/anti-gaming/events')) return { ...base, data: { events: [] } }
    return { ...base, data: null }
  },
}))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title, children }: { title: string; children?: unknown }) => createElement('header', null, title, children as never),
}))
vi.mock('../components/PagePosture', () => ({
  POSTURE_PRIORITY: { status: 0 },
  PagePosture: ({ slots }: { slots: Array<{ children: unknown }> }) => createElement('div', null, ...slots.map((s) => s.children as never)),
}))

import { AntiGamingPage } from './AntiGamingPage'
import { ToastProvider } from '../lib/toast'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('AntiGamingPage with no tracked device', () => {
  it('shows one zero line, a neutral not-checked state and flat empty lines', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(AntiGamingPage))))
    })
    expect(host.querySelector('[data-testid="anti-gaming-zero-line"]')?.textContent).toBe('0 tracked devices · 0 flagged · 0 cross-account · 4 reports')
    expect(host.textContent).not.toContain('Tracked devices')
    expect(host.querySelector('[data-testid="anti-gaming-not-checked"]')?.textContent).toContain('Not checked yet')
    expect(host.textContent).not.toContain('Waiting for SDK devices')
    expect(host.querySelectorAll('[data-testid="anti-gaming-empty-line"]').length).toBeGreaterThan(0)
    expect(host.querySelector('.border-dashed')).toBeNull()
    // The filter reads in words, not the raw value.
    const filter = host.querySelector('select') as HTMLSelectElement
    expect([...filter.options].map((o) => o.textContent)).toContain('Flagged')
  })
})
