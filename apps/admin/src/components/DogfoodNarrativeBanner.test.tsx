/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/DogfoodNarrativeBanner.test.tsx
 * PURPOSE: The fragile-area line tells the reports page when it has
 *          decided, so the page can leave its loading skeleton.
 */

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  dashboardLoading: true,
  top: null as { component: string; count: number } | null,
  setupLoading: false,
  reportCount: 6,
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: state.top ? { topComponents: [state.top] } : { topComponents: [] },
    loading: state.dashboardLoading,
    error: null,
    reload: () => {},
  }),
}))

vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({
    loading: state.setupLoading,
    activeProject: state.reportCount < 0
      ? null
      : {
          project_name: 'Glot It',
          report_count: state.reportCount,
          fix_count: 3,
          merged_fix_count: 1,
        },
  }),
}))

vi.mock('./ProjectSwitcher', () => ({
  useActiveProjectId: () => 'p1',
}))

import { DogfoodNarrativeBanner } from './DogfoodNarrativeBanner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('DogfoodNarrativeBanner', () => {
  let container: HTMLDivElement
  let root: Root
  let settled: boolean

  beforeEach(() => {
    state.dashboardLoading = true
    state.top = null
    state.setupLoading = false
    state.reportCount = 6
    settled = false
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function paint() {
    act(() => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(DogfoodNarrativeBanner, { onSettled: () => { settled = true } }),
        ),
      )
    })
  }

  it('does not settle or render the line while the dashboard is loading', () => {
    paint()
    expect(settled).toBe(false)
    expect(container.querySelector('aside')).toBeNull()
  })

  it('settles with the fragile-area line once the dashboard names a component', () => {
    function Host() {
      const [loading, setLoading] = useState(true)
      state.dashboardLoading = loading
      state.top = loading ? null : { component: 'Sing Along', count: 6 }
      return createElement(
        'div',
        null,
        createElement('button', { type: 'button', onClick: () => setLoading(false) }, 'arrive'),
        createElement(DogfoodNarrativeBanner, { onSettled: () => { settled = true } }),
      )
    }
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(Host)))
    })
    expect(settled).toBe(false)
    act(() => {
      container.querySelector('button')?.click()
    })
    expect(settled).toBe(true)
    expect(container.querySelector('aside')?.textContent).toContain('Sing Along')
    expect(container.querySelector('aside')?.textContent).toMatch(/fragile area|most fragile/i)
  })
})
