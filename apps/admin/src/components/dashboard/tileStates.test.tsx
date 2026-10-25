/**
 * @vitest-environment jsdom
 *
 * FILE: tileStates.test.tsx
 * PURPOSE: Dashboard tiles that fetch on their own must not paint a failed
 *          request as an empty list. Loading, empty, and error stay distinct.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const page = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  error: null as string | null,
  errorCode: null as string | null,
  reload: vi.fn(),
}))

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({
    data: page.data,
    loading: page.loading,
    error: page.error,
    errorCode: page.errorCode,
    reload: page.reload,
  }),
}))

import { PlatformHealthTile } from './PlatformHealthTile'
import { QaCoverageTile } from './QaCoverageTile'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  page.data = null
  page.loading = false
  page.error = null
  page.errorCode = null
  page.reload = vi.fn()
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

describe('PlatformHealthTile states', () => {
  it('shows an error with retry when the rollup fails', () => {
    page.error = 'Request failed (FORBIDDEN)'
    render(createElement(PlatformHealthTile, { projectId: 'p1' }))
    expect(host.textContent).toContain('You do not have access to this.')
    expect(host.textContent).not.toContain('No multi-platform data yet.')
    const retry = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Retry')
    act(() => retry!.click())
    expect(page.reload).toHaveBeenCalledOnce()
  })

  it('shows the empty state when the rollup succeeded with no platforms', () => {
    page.data = { platforms: [] }
    render(createElement(PlatformHealthTile, { projectId: 'p1' }))
    expect(host.textContent).toContain('No multi-platform data yet.')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('names the loading state', () => {
    page.loading = true
    render(createElement(PlatformHealthTile, { projectId: 'p1' }))
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading platform health')
  })
})

describe('QaCoverageTile states', () => {
  it('shows an error with retry when the summary fails', () => {
    page.error = 'Request failed'
    render(createElement(QaCoverageTile, { projectId: 'p1' }))
    expect(host.textContent).toContain("Couldn't load QA coverage.")
    expect(host.textContent).not.toContain('No QA stories yet.')
    expect(host.textContent).not.toContain('QA Coverage not available.')
  })

  it('shows the empty state with a way to create a story', () => {
    page.data = { total: 0, passing: 0, failing: 0, error: 0, top_failing: [] }
    render(createElement(QaCoverageTile, { projectId: 'p1' }))
    expect(host.textContent).toContain('No QA stories yet.')
    expect(host.textContent).toContain('Create your first user story test')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('names the loading state', () => {
    page.loading = true
    render(createElement(QaCoverageTile, { projectId: 'p1' }))
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading QA coverage')
  })
})
