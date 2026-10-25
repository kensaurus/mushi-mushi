/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/dashboard/fetchStates.test.tsx
 * PURPOSE: Dashboard tiles that fetch on their own must show loading, an
 *          empty list, a failed first load with Retry, and a failed refresh
 *          that keeps the last result.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const page = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  error: null as string | null,
  reload: vi.fn(),
}))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: page.data, loading: page.loading, error: page.error, reload: page.reload }),
}))

import { PlatformHealthTile } from './PlatformHealthTile'
import { QaCoverageTile } from './QaCoverageTile'
import { QuotaBanner } from './QuotaBanner'
import { SdkUpgradeBanner } from './SdkUpgradeBanner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  page.data = null
  page.loading = false
  page.error = null
  page.reload.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(node: ReturnType<typeof createElement>) {
  act(() => root.render(createElement(MemoryRouter, null, node)))
}

function retry(): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Retry')
}

describe('PlatformHealthTile states', () => {
  it('loads, explains a missing rollup with Retry, and keeps rows after a failed refresh', () => {
    page.loading = true
    render(createElement(PlatformHealthTile, { projectId: 'p1' }))
    expect(host.querySelector('[aria-label="Loading platform health"]')).not.toBeNull()
    expect(host.textContent).not.toContain('No multi-platform data yet')

    page.loading = false
    page.error = 'missing'
    render(createElement(PlatformHealthTile, { projectId: 'p1' }))
    expect(host.textContent).toContain('Platform rollup unavailable.')
    expect(host.textContent).toContain('may not be deployed yet')
    expect(host.textContent).not.toContain('No multi-platform data yet')
    const missing = Array.from(host.querySelectorAll('p')).find((p) => p.textContent?.includes('Platform rollup unavailable.'))
    expect(missing?.getAttribute('role')).not.toBe('alert')
    expect(missing?.className).toContain('text-fg-muted')
    expect(missing?.className ?? '').not.toContain('text-danger')
    expect(host.querySelector('.border-dashed')).not.toBeNull()
    retry()?.click()
    expect(page.reload).toHaveBeenCalledOnce()

    page.error = null
    page.data = { platforms: [] }
    render(createElement(PlatformHealthTile, { projectId: 'p1' }))
    expect(host.textContent).toContain('No multi-platform data yet')

    page.error = 'refresh failed'
    page.data = {
      platforms: [{ platform: 'ios', sdk_package: '@mushi-mushi/react-native', reports_24h: 4, critical_24h: 1, high_24h: 0, sdk_versions: ['1.2.0'] }],
    }
    render(createElement(PlatformHealthTile, { projectId: 'p1' }))
    expect(host.textContent).toContain('ios')
    expect(host.textContent).toContain('4')
    expect(host.textContent).toContain("Couldn't refresh. Showing the last result.")
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Couldn't refresh. Showing the last result.")
    expect(host.textContent).not.toContain('Platform rollup unavailable.')
  })
})

describe('QaCoverageTile states', () => {
  it('loads, offers Retry when coverage fails, and keeps the last stories', () => {
    page.loading = true
    render(createElement(QaCoverageTile, { projectId: 'p1' }))
    expect(host.querySelector('[aria-label="Loading QA coverage"]')).not.toBeNull()

    page.loading = false
    page.error = 'down'
    render(createElement(QaCoverageTile, { projectId: 'p1' }))
    expect(host.textContent).toContain("Couldn't load QA coverage.")
    expect(host.textContent).not.toContain('No QA stories yet')
    retry()?.click()
    expect(page.reload).toHaveBeenCalledOnce()

    page.error = null
    page.data = { total: 0, passing: 0, failing: 0, error: 0, top_failing: [] }
    render(createElement(QaCoverageTile, { projectId: 'p1' }))
    expect(host.textContent).toContain('No QA stories yet')

    page.error = 'refresh failed'
    page.data = { total: 4, passing: 3, failing: 1, error: 0, top_failing: [{ story_id: 's1', name: 'Login', pass_rate_pct: 20 }] }
    render(createElement(QaCoverageTile, { projectId: 'p1' }))
    expect(host.textContent).toContain('Login')
    expect(host.textContent).toContain('75% passing')
    expect(host.textContent).toContain("Couldn't refresh. Showing the last result.")
  })
})

describe('QuotaBanner states', () => {
  const quota = {
    projects: [{
      project_id: 'p',
      project_name: 'mushi',
      plan: 'free',
      usage: { reports: 90 },
      limit_reports: 100,
      over_quota: false,
    }],
    free_limit_reports_per_month: 100,
  }

  it('says when the quota check fails, and keeps the last banner on a failed refresh', () => {
    page.error = 'down'
    render(createElement(QuotaBanner))
    expect(host.textContent).toContain("Couldn't check report quota.")
    retry()?.click()
    expect(page.reload).toHaveBeenCalledOnce()

    page.data = quota
    render(createElement(QuotaBanner))
    expect(host.textContent).toContain('mushi')
    expect(host.textContent).toContain("Couldn't refresh. Showing the last result.")
  })

  it('stays quiet when a refresh fails and no project is near quota', () => {
    page.error = 'refresh failed'
    page.data = {
      projects: [{
        project_id: 'p',
        project_name: 'quiet',
        plan: 'free',
        usage: { reports: 10 },
        limit_reports: 100,
        over_quota: false,
      }],
      free_limit_reports_per_month: 100,
    }
    render(createElement(QuotaBanner))
    expect(host.textContent ?? '').not.toContain("Couldn't refresh")
    expect(host.textContent ?? '').not.toContain('quiet')
  })
})

describe('SdkUpgradeBanner states', () => {
  it('says when the upgrade check fails, and keeps an available upgrade on a failed refresh', () => {
    page.error = 'down'
    render(createElement(SdkUpgradeBanner, { projectId: 'p1' }))
    expect(host.textContent).toContain("Couldn't check for an SDK upgrade.")
    retry()?.click()
    expect(page.reload).toHaveBeenCalledOnce()

    page.data = { projects: [{ id: 'p1', sdk_status: 'outdated', sdk_version: '1.0.0', sdk_latest_version: '1.2.0' }] }
    render(createElement(SdkUpgradeBanner, { projectId: 'p1' }))
    expect(host.textContent).toContain('SDK upgrade available')
    expect(host.textContent).toContain("Couldn't refresh. Showing the last result.")
  })

  it('stays quiet when a refresh fails and the SDK is current', () => {
    page.error = 'refresh failed'
    page.data = { projects: [{ id: 'p1', sdk_status: 'current', sdk_version: '1.2.0', sdk_latest_version: '1.2.0' }] }
    render(createElement(SdkUpgradeBanner, { projectId: 'p1' }))
    expect(host.textContent ?? '').not.toContain("Couldn't refresh")
    expect(host.textContent ?? '').not.toContain("Couldn't check for an SDK upgrade")
    expect(host.textContent ?? '').not.toContain('SDK upgrade available')
  })
})
