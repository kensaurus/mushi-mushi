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

const mockState = vi.hoisted(() => ({ tracked: 0 }))

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
        data: { hasAnyProject: true, projectId: 'p1', projectName: 'kensaur.us', trackedDevices: mockState.tracked, flaggedDevices: 0, crossAccountDevices: 0, totalReports: 4, topPriority: 'waiting', topPriorityLabel: null, topPriorityTo: null },
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
  beforeEach(() => {
    mockState.tracked = 0
  })

  it('shows no zero counts and no controls over the empty list, a neutral not-checked state and flat empty lines', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(AntiGamingPage))))
    })
    // Round 2 (2026-11-18): nothing tracked yet hides the zero line and the filter, group and search controls.
    expect(host.querySelector('[data-testid="anti-gaming-zero-line"]')).toBeNull()
    expect(host.textContent).not.toContain('0 tracked devices')
    expect(host.querySelector('select')).toBeNull()
    expect(host.querySelector('input[placeholder="Search devices…"]')).toBeNull()
    expect(host.querySelector('[aria-label="Group devices by"]')).toBeNull()
    expect(host.textContent).not.toContain('No flagged devices.')
    expect(host.textContent).not.toContain('Cross-account')
    expect(host.querySelector('[data-testid="anti-gaming-not-checked"]')?.textContent).toContain('Not checked yet')
    expect(host.textContent).not.toContain('Waiting for SDK devices')
    expect(host.querySelectorAll('[data-testid="anti-gaming-empty-line"]').length).toBeGreaterThan(0)
    expect(host.querySelector('.border-dashed')).toBeNull()
  })

  it('keeps the filter in words once a device is tracked', async () => {
    mockState.tracked = 3
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(AntiGamingPage))))
    })
    const filter = host.querySelector('select') as HTMLSelectElement
    expect([...filter.options].map((o) => o.textContent)).toContain('Flagged')
    expect(host.querySelector('input[placeholder="Search devices…"]')).not.toBeNull()
  })
})
