/**
 * @vitest-environment jsdom
 */

/**
 * Home's views disagreed with no way to tell why (console sweep, 2026-10-28):
 * Overview said "Sessions (7d) 75" and User activity said "Sessions 139" with
 * no window, and Users & funnels titled a tile "Anonymous 2" with the hint
 * "60% identified", the share of the other group. An Overview card said
 * "65 open" three times (badge, KPI line, footer link).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({ byPath: {} as Record<string, unknown> }))

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({
    data: path ? (Object.entries(data.byPath).find(([p]) => path.startsWith(p))?.[1] ?? null) : null,
    loading: false,
    error: null,
    reload: vi.fn(),
    lastFetchedAt: null,
    isValidating: false,
  }),
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => ({ activeProject: { project_name: 'mushi-mushi' } }) }))
vi.mock('../components/OrgSwitcher', () => ({ useActiveOrgId: () => null }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title }: { title: string }) => createElement('h1', null, title),
}))

import { ActivityPage } from './ActivityPage'
import { AnalyticsPage } from './AnalyticsPage'
import { OverviewPage } from './OverviewPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(page: () => ReturnType<typeof ActivityPage>) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(page)))
  })
  return container.textContent ?? ''
}

describe('Home views', () => {
  it('User activity names the window its session counts cover', async () => {
    data.byPath = {
      '/v1/admin/activity': {
        window_days: 30,
        sessions: 139,
        completed_sessions: 84,
        unique_devices: 57,
        identified_users: 0,
        avg_page_views: 1,
        avg_session_minutes: 40,
        dau_series: [],
        top_routes: [],
        reports: { total: 65, open: 65, critical: 0, high: 24 },
        user_split: { identified: 0, anonymous: 57 },
      },
    }
    const text = await render(ActivityPage)
    expect(text).toContain('Sessions (30d)')
    expect(text).toContain('Unique devices (30d)')
  })

  it('Overview says an app has 65 open bugs once per card', async () => {
    data.byPath = {
      '/v1/admin/portfolio': [
        {
          project_id: 'p1',
          name: 'mushi-mushi',
          label: 'mushi-mushi',
          slug: 'mushi-mushi',
          sessions_7d: 75,
          users_7d: 18,
          open_reports: 65,
          critical_reports: 0,
          last_report_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          dau_spark: [],
        },
      ],
    }
    const text = await render(OverviewPage)
    expect(text.match(/65 open/g)?.length).toBe(1)
    expect(container.querySelector('a[href="/reports?status=open"]')?.textContent).toBe('Open bugs')
    expect(container.querySelector('a[href="/dashboard?view=users"]')?.textContent).toContain('User activity')
  })

  it('Users & funnels gives the Anonymous tile its own share', async () => {
    data.byPath = {
      '/v1/admin/events/summary': { window_days: 30, events_total: 575, persons: 5, identified: 3, anonymous: 2, distinct_events: 13, top_events: [], daily: [] },
    }
    const text = await render(AnalyticsPage)
    expect(text).toContain('40% of people')
    expect(text).not.toContain('60% identified')
  })
})
