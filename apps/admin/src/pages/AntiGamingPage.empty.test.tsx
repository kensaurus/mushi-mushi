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

const mockState = vi.hoisted(() => ({ tracked: 0, events: [] as unknown[], devices: [] as unknown[] }))

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
    if (path.startsWith('/v1/admin/anti-gaming/devices')) return { ...base, data: { devices: mockState.devices } }
    if (path.startsWith('/v1/admin/anti-gaming/events')) return { ...base, data: { events: mockState.events } }
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
    // 2026-11-19: empty is said once, by the status card; the device and event cards wait for data.
    expect(host.querySelectorAll('[data-testid="anti-gaming-empty-line"]')).toHaveLength(0)
    expect(host.textContent).not.toContain('No anti-gaming events yet.')
    expect(host.textContent).not.toContain('No tracked devices yet.')
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

  // Audit 2026-11-21: event rows read `velocity_anomaly` and "10/28/2026, 2:5…".
  it('names event types in words and dates them as an age', async () => {
    mockState.tracked = 3
    mockState.events = [
      { id: 'e1', reporter_token_hash: 'device-hash-1', ip_address: '10.0.0.1', event_type: 'velocity_anomaly', reason: 'Velocity anomaly: 11 reports in 24h', created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() },
    ]
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(AntiGamingPage))))
    })
    expect(host.textContent).toContain('Too many reports')
    expect(host.textContent).not.toContain('velocity_anomaly')
    const typeFilter = [...host.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === 'Type') as HTMLSelectElement
    expect([...typeFilter.options].map((o) => o.textContent)).toContain('Multi-account')
    mockState.events = []
  })
  // Report 35d0d73d (2026-11-21): the device row's eye and flag controls were icon-only.
  it('labels the device row actions in words, not icons alone', async () => {
    mockState.tracked = 1
    const now = new Date().toISOString()
    mockState.devices = [
      { id: 'd1', project_id: 'p1', device_fingerprint: 'fp-1', fingerprint_hash: null, reporter_tokens: ['t1'], ip_addresses: ['10.0.0.1'], report_count: 2, distinct_user_count: 1, flagged_as_suspicious: false, cross_account_flagged: false, flag_reason: null, updated_at: now, created_at: now },
    ]
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(AntiGamingPage))))
    })
    const details = host.querySelector('button[aria-label="Show device details"]')
    const flag = host.querySelector('button[aria-label="Flag as suspicious"]')
    expect(details?.textContent).toContain('Details')
    expect(flag?.textContent).toContain('Flag')
    mockState.devices = []
  })
})
