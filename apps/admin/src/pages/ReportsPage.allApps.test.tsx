/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/pages/ReportsPage.allApps.test.tsx
 * PURPOSE: Toggling All apps on a mounted Reports page refetches the list,
 *          the stats and the severity tiles without the project pin, and a
 *          bug from another app does not reuse the pinned app's actions.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_REPORTS_STATS } from '../components/reports/ReportsStatsTypes'
import { setStoredProjectScopeMode } from '../lib/projectScope'

const PINNED = '450e6ba8-cf2b-4841-bb38-08141e1ebe77'
const OTHER = '542b34e0-019e-41fe-b900-7b637717bb86'

const ROWS = [
  {
    id: 'c0e99783-a48f-43bf-9fd9-84708dec1a3c',
    project_id: PINNED,
    project_name: 'solo-boss-cloud',
    description: 'Pinned bug',
    category: 'bug',
    severity: 'high',
    summary: 'Pinned summary',
    status: 'classified',
    created_at: '2026-10-02T10:00:00Z',
    user_category: 'bug',
    confidence: 0.9,
    component: null,
  },
  {
    id: 'd1e99783-a48f-43bf-9fd9-84708dec1a3d',
    project_id: OTHER,
    project_name: 'yen-yen',
    description: 'Other bug',
    category: 'bug',
    severity: 'critical',
    summary: 'Other summary',
    status: 'classified',
    created_at: '2026-10-02T11:00:00Z',
    user_category: 'bug',
    confidence: 0.8,
    component: null,
  },
]

const calls = vi.hoisted(() => ({ list: [] as Array<{ path: string; scope?: string }> }))

vi.mock('../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    apiFetch: async (path: string, opts: { scope?: string } = {}) => {
      calls.list.push({ path, scope: opts.scope })
      if (path.startsWith('/v1/admin/reports?')) return { ok: true, data: { reports: ROWS, total: ROWS.length } }
      if (path.startsWith('/v1/admin/reports/stats')) {
        return { ok: true, data: { ...EMPTY_REPORTS_STATS, hasAnyProject: true, projectCount: 2, totalAllTime: 5 } }
      }
      if (path.startsWith('/v1/admin/reports/severity-stats')) {
        return {
          ok: true,
          data: {
            window_days: 14,
            bySeverity: { critical: 1, high: 1, medium: 0, low: 0 },
            total: 2,
            byDay: [],
          },
        }
      }
      if (path.startsWith('/v1/admin/setup')) return { ok: true, data: { has_any_project: true, projects: [] } }
      if (path.startsWith('/v1/admin/stats')) return { ok: true, data: { byStatus: {}, bySeverity: {}, total: 2, openCount: 2 } }
      return { ok: true, data: {} }
    },
  }
})

vi.mock('../lib/useDispatchPreflight', () => ({
  useDispatchPreflight: () => ({
    loading: false,
    ready: false,
    checks: [],
    failing: [{ key: 'github', ready: false, label: 'GitHub connected', hint: '', fixHref: '/connect' }],
    error: null,
    reload: () => {},
    repoUrl: 'https://github.com/acme/pinned',
  }),
}))

vi.mock('../lib/useStagedRealtime', () => ({
  useStagedRealtime: () => ({ stagedCount: 0, apply: () => {}, discard: () => {}, channelState: 'idle' }),
}))

vi.mock('../lib/realtime', () => ({
  useRealtimeReload: () => ({ channelState: 'idle' }),
}))

import { ReportsPage } from './ReportsPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  calls.list = []
  window.localStorage.clear()
  window.matchMedia = ((q: string) => ({
    matches: true,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function render(url: string) {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(ReportsPage)))
  })
  await settle()
}

function of(prefix: string) {
  return calls.list.filter((c) => c.path.startsWith(prefix))
}

function row(name: string) {
  return Array.from(host.querySelectorAll('tr')).find((tr) => tr.textContent?.includes(name)) ?? null
}

describe('ReportsPage All apps', () => {
  it('refetches the list, stats and tiles without the project pin when All apps is turned on', async () => {
    await render(`/reports?project=${PINNED}`)

    expect(of('/v1/admin/reports?').some((c) => c.scope === 'project')).toBe(true)
    expect(of('/v1/admin/reports/stats').some((c) => c.scope === 'project' && !c.path.includes('apps=all'))).toBe(true)
    expect(of('/v1/admin/reports/severity-stats').some((c) => c.scope === 'project')).toBe(true)

    const before = calls.list.length
    await act(async () => {
      setStoredProjectScopeMode('all')
    })
    await settle()

    const after = calls.list.slice(before)
    const list = after.filter((c) => c.path.startsWith('/v1/admin/reports?'))
    const stats = after.filter((c) => c.path.startsWith('/v1/admin/reports/stats'))
    const tiles = after.filter((c) => c.path.startsWith('/v1/admin/reports/severity-stats'))
    // enumeration is the scope that omits X-Mushi-Project-Id.
    expect(list.some((c) => c.scope === 'enumeration')).toBe(true)
    expect(stats.some((c) => c.scope === 'enumeration' && c.path.includes('apps=all'))).toBe(true)
    expect(tiles.some((c) => c.scope === 'enumeration')).toBe(true)
    expect(list.some((c) => c.scope === 'project')).toBe(false)
    expect(stats.some((c) => c.scope === 'project')).toBe(false)
  })

  it('does not apply the pinned app checklist or bulk edit to a bug from another app', async () => {
    setStoredProjectScopeMode('all')
    await render(`/reports?project=${PINNED}&apps=all`)

    expect(host.textContent).toContain('yen-yen')
    const other = row('yen-yen')
    expect(other).not.toBeNull()
    const trigger = other!.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
    await act(async () => trigger?.click())
    const reason = document.body.querySelector('[data-testid="dispatch-block-reason"]')
    expect(reason?.textContent).toContain('yen-yen')
    expect(document.body.textContent).not.toContain('GitHub connected')

    await act(async () => trigger?.click())
    const box = other!.querySelector<HTMLInputElement>('input[aria-label="Select report"]')
    await act(async () => box?.click())
    const note = host.querySelector('[data-testid="bulk-other-apps"]')
    expect(note?.textContent).toMatch(/other apps/)
    const dismiss = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Dismiss')
    expect(dismiss?.disabled).toBe(true)
  })
})
