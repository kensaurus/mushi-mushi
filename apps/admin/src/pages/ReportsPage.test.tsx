/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/ReportsPage.test.tsx
 * PURPOSE: The reports title stays on screen while late chrome is still
 *          settling, and queue shortcuts stay off until that first paint.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_REPORTS_STATS } from '../components/reports/ReportsStatsTypes'

const state = vi.hoisted(() => ({ dashboardLoading: true }))

vi.mock('../lib/usePageData', () => ({
  usePageData: (url: string | null) => {
    const idle = {
      error: null,
      reload: () => {},
      isValidating: false,
      lastFetchedAt: null,
    }
    if (url?.startsWith('/v1/admin/reports?')) {
      return {
        ...idle,
        loading: false,
        data: {
          reports: [{
            id: 'r1',
            project_id: 'p1',
            description: 'Save button does nothing',
            category: 'bug',
            severity: 'high',
            summary: null,
            status: 'fixed',
            created_at: '2026-10-01T00:00:00.000Z',
            user_category: 'bug',
            confidence: null,
            component: null,
          }],
          total: 1,
        },
      }
    }
    if (url === '/v1/admin/reports/stats') {
      return {
        ...idle,
        loading: false,
        data: {
          ...EMPTY_REPORTS_STATS,
          hasAnyProject: true,
          hasIngest: true,
          topPriority: 'clear',
          projectName: 'App',
        },
      }
    }
    if (url === '/v1/admin/dashboard') {
      return { ...idle, loading: state.dashboardLoading, data: null }
    }
    return { ...idle, loading: false, data: null }
  },
}))

vi.mock('../lib/supabase', () => ({
  apiFetch: vi.fn(async () => ({ ok: false, error: { message: 'unused' } })),
}))
vi.mock('../lib/realtime', () => ({
  useRealtimeReload: () => ({ channelState: 'idle' }),
}))
vi.mock('../lib/useStagedRealtime', () => ({
  useStagedRealtime: () => ({
    stagedCount: 0,
    apply: () => {},
    discard: () => {},
    channelState: 'idle',
  }),
}))
vi.mock('../lib/useDispatchPreflight', () => ({
  useDispatchPreflight: () => ({
    loading: false,
    ready: true,
    checks: [],
    failing: [],
    error: null,
    reload: () => {},
    repoUrl: null,
  }),
}))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({
    loading: false,
    activeProject: { project_id: 'p1', project_name: 'App', report_count: 4 },
    data: null,
    reload: () => {},
    getStep: () => null,
  }),
}))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title }: { title: string }) => createElement('h2', { 'data-testid': 'reports-header' }, title),
}))
vi.mock('../components/reports/ReportsTable', () => ({
  ReportsTable: () => createElement('div', { 'data-testid': 'queue' }, 'Queue'),
}))
vi.mock('../components/reports/ReportsKpiStrip', () => ({
  ReportsKpiStrip: () => createElement('div', { 'data-testid': 'kpi' }, 'KPI'),
}))
vi.mock('../components/reports/ReportPreviewDrawer', () => ({
  ReportPreviewDrawer: () => null,
}))
vi.mock('../components/onboarding/FirstDiagnosisScreen', () => ({
  FirstDiagnosisInline: () => null,
}))
vi.mock('../components/SdkHealthSummary', () => ({
  SdkConnectivityEmptyState: () => null,
}))
vi.mock('../lib/track', () => ({ trackSelf: vi.fn(), trackAdHoc: vi.fn() }))

import { ReportsPage } from './ReportsPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SEARCH_LABEL = 'Search reports by summary or description'

describe('ReportsPage first paint', () => {
  let container: HTMLDivElement
  let root: Root
  let focusCalls: HTMLElement[]
  let originalFocus: typeof HTMLElement.prototype.focus

  beforeEach(() => {
    state.dashboardLoading = true
    focusCalls = []
    originalFocus = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function focus(this: HTMLElement) {
      focusCalls.push(this)
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    HTMLElement.prototype.focus = originalFocus
    act(() => root.unmount())
    container.remove()
  })

  function render() {
    act(() => {
      root.render(
        createElement(MemoryRouter, { initialEntries: ['/reports'] }, createElement(ReportsPage)),
      )
    })
  }

  function pressSlash() {
    focusCalls = []
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
    })
  }

  function searchFocused(): boolean {
    return focusCalls.some((el) => el.getAttribute('aria-label') === SEARCH_LABEL)
  }

  it('shows the title while late chrome is gated, and ignores queue shortcuts until then', () => {
    render()
    const header = container.querySelector('[data-testid="reports-header"]')
    expect(header?.textContent).toBe('Bugs')
    expect(header?.closest('[hidden]')).toBeNull()
    const skeleton = container.querySelector('[aria-label="Loading reports"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.closest('[hidden]')).toBeNull()

    pressSlash()
    expect(searchFocused()).toBe(false)

    state.dashboardLoading = false
    render()
    expect(container.querySelector('[data-testid="reports-header"]')?.closest('[hidden]')).toBeNull()
    expect(container.querySelector('[aria-label="Loading reports"]')).toBeNull()
    expect(container.querySelector('[hidden]')).toBeNull()

    pressSlash()
    expect(searchFocused()).toBe(true)
  })
})
