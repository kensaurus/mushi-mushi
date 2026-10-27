/**
 * @vitest-environment jsdom
 */

/**
 * Console journeys 2026-10-27, User stories: an empty page showed SDK/YAML
 * instructions beside "22 open findings are not tied to a story action", and
 * the tabs read Gates / Synthetic / Drift / Yaml. Empty now means one
 * "Turn on discovery" step and nothing else; a filled page leads with one
 * status sentence and the page → action map, broken actions first. Tab ids
 * are unchanged so `?tab=gates` links keep working.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inventory: null as unknown,
  findings: { runs: [], findings: [] } as unknown,
}))

vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: {} })) }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null }
    if (path === '/v1/admin/inventory/p1') return { ...base, data: mocks.inventory }
    if (path === '/v1/admin/inventory/p1/user-stories') return { ...base, data: { tree: [] } }
    if (path === '/v1/admin/inventory/p1/findings') return { ...base, data: mocks.findings }
    return { ...base, data: null }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({ has: () => true, loading: false, planName: 'pro', isSuperAdmin: false }),
}))
vi.mock('../lib/mode', () => ({ useAdminMode: () => ({ isAdvanced: false }) }))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => undefined }))
vi.mock('../lib/useNextBestAction', () => ({ useNextBestAction: () => null }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: { guide: 1 } }))
vi.mock('../components/inventory/DiscoveryTab', () => ({
  DiscoveryTab: () => createElement('div', { 'data-testid': 'discovery-tab' }),
}))
vi.mock('../components/inventory/ActionDetailDrawer', () => ({ ActionDetailDrawer: () => null }))

import { InventoryPage, inventorySentence } from './InventoryPage'
import { ToastProvider } from '../lib/toast'
import { PageHelpProvider } from '../lib/pageHelpContext'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(url = '/inventory') {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(ToastProvider, null, createElement(PageHelpProvider, null, createElement(InventoryPage))),
      ),
    )
  })
}

const FILLED = {
  snapshot: {
    id: 'inv1',
    parsed: {
      pages: [
        { id: 'checkout', path: '/checkout', elements: [{ id: 'pay', action: 'Pay', status: 'regressed' }, { id: 'coupon', action: 'Apply coupon', status: 'verified' }] },
        { id: 'home', path: '/home', elements: [{ id: 'search', action: 'Search', status: 'verified' }] },
      ],
    },
  },
  summary: { total: 3, verified: 2, regressed: 1, stub: 0 },
}

describe('InventoryPage', () => {
  it('opens an empty app on one "Turn on discovery" step and nothing else', async () => {
    mocks.inventory = { snapshot: null, summary: null }
    mocks.findings = { runs: [], findings: [{ id: 'f1', message: 'x', severity: 'warn', node_id: null }] }
    await render()
    const step = host.querySelector('[data-testid="inventory-first-step"]')
    expect(step?.textContent).toContain('Turn on discovery')
    expect(step?.querySelector('a[href="/inventory?tab=discovery"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="inventory-status"]')).toBeNull()
    expect(host.textContent).not.toContain('not tied to')
    expect(host.textContent).not.toContain('Check every action')
  })

  it('names the tabs in plain words', async () => {
    mocks.inventory = { snapshot: null, summary: null }
    await render()
    const text = host.textContent ?? ''
    for (const label of ['All actions', 'Code checks', 'Live probes', 'Out of sync', 'Map file']) expect(text).toContain(label)
    for (const jargon of ['Gates', 'Synthetic', 'Drift', 'Yaml']) expect(text).not.toContain(jargon)
  })

  it('keeps ?tab= deep links working', async () => {
    mocks.inventory = { snapshot: null, summary: null }
    await render('/inventory?tab=discovery')
    expect(host.querySelector('[data-testid="discovery-tab"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="inventory-first-step"]')).toBeNull()
  })

  it('leads a filled app with the status sentence and the page map, broken first', async () => {
    mocks.inventory = FILLED
    mocks.findings = { runs: [], findings: [] }
    await render()
    expect(host.querySelector('[data-testid="inventory-status"]')?.textContent).toContain('1 of 3 actions is broken')
    const pages = host.querySelectorAll('[data-testid="inventory-page-map-page"]')
    expect(pages[0]?.textContent).toContain('/checkout')
    expect(pages[0]?.textContent).toContain('1 broken')
    expect(host.querySelector('[data-testid="inventory-first-step"]')).toBeNull()
  })
})

describe('inventorySentence', () => {
  it('says what is broken first, then what is proven', () => {
    expect(inventorySentence({ total: 10, verified: 4, regressed: 1, stub: 2 })).toBe(
      '3 of 10 actions are broken: 1 stopped working, 2 have no code behind them yet.',
    )
    expect(inventorySentence({ total: 5, verified: 5, regressed: 0, stub: 0 })).toBe('All 5 actions work and a test proves each one.')
    expect(inventorySentence({ total: 5, verified: 1, regressed: 0, stub: 0 })).toBe(
      'Nothing is broken. 1 of 5 actions has a test that proves it works.',
    )
  })
})
