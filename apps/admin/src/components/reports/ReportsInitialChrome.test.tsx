/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/ReportsInitialChrome.test.tsx
 * PURPOSE: The reports queue stays out of layout until late chrome is
 *          settled, then stays put when a filter refetch clears `ready`.
 */

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  dogfoodNarrativeSettled,
  reportsInitialChromeReady,
  ReportsInitialChrome,
} from './ReportsInitialChrome'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('reportsInitialChromeReady', () => {
  const ready = {
    listLoading: false,
    hasListData: true,
    statsLoading: false,
    hasStatsData: true,
    narrativeSettled: true,
  }

  it('waits while the list, the status stats, or the fragile-area line are still unknown', () => {
    expect(reportsInitialChromeReady({ ...ready, listLoading: true, hasListData: false })).toBe(false)
    expect(reportsInitialChromeReady({ ...ready, statsLoading: true, hasStatsData: false })).toBe(false)
    expect(reportsInitialChromeReady({ ...ready, narrativeSettled: false })).toBe(false)
  })

  it('treats a cached payload as settled while its refetch is in flight', () => {
    expect(reportsInitialChromeReady({ ...ready, listLoading: true, hasListData: true })).toBe(true)
    expect(reportsInitialChromeReady({ ...ready, statsLoading: true, hasStatsData: true })).toBe(true)
  })
})

describe('dogfoodNarrativeSettled', () => {
  const pending = {
    isAdvanced: false,
    setupLoading: false,
    hasProject: true,
    reportCount: 4,
    dashboardLoading: true,
  }

  it('waits on the dashboard only when a fragile-area line can appear', () => {
    expect(dogfoodNarrativeSettled(pending)).toBe(false)
    expect(dogfoodNarrativeSettled({ ...pending, dashboardLoading: false })).toBe(true)
  })

  it('settles immediately when the line cannot appear', () => {
    expect(dogfoodNarrativeSettled({ ...pending, isAdvanced: true })).toBe(true)
    expect(dogfoodNarrativeSettled({ ...pending, setupLoading: true, isAdvanced: true })).toBe(true)
    expect(dogfoodNarrativeSettled({ ...pending, setupLoading: true })).toBe(false)
    expect(dogfoodNarrativeSettled({ ...pending, hasProject: false })).toBe(true)
    expect(dogfoodNarrativeSettled({ ...pending, reportCount: 0 })).toBe(true)
  })
})

describe('ReportsInitialChrome', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function paint(ready: boolean) {
    act(() => {
      root.render(
        createElement(ReportsInitialChrome, {
          ready,
          skeleton: createElement('p', null, 'Loading reports'),
          children: createElement('p', { 'data-testid': 'queue' }, 'Queue'),
        }),
      )
    })
  }

  it('hides the queue until chrome is ready, then drops the skeleton', () => {
    paint(false)
    const queue = container.querySelector('[data-testid="queue"]')
    expect(queue?.closest('[hidden]')).not.toBeNull()
    expect(container.textContent).toContain('Loading reports')

    paint(true)
    expect(container.querySelector('[hidden]')).toBeNull()
    expect(container.querySelector('[data-testid="queue"]')?.textContent).toBe('Queue')
    expect(container.textContent).not.toContain('Loading reports')
  })

  it('does not cover the queue again when a later fetch is not ready', () => {
    function Flip() {
      const [ready, setReady] = useState(true)
      return createElement(
        'div',
        null,
        createElement('button', { type: 'button', onClick: () => setReady(false) }, 'refetch'),
        createElement(ReportsInitialChrome, {
          ready,
          skeleton: createElement('p', null, 'Loading reports'),
          children: createElement('p', { 'data-testid': 'queue' }, 'Queue'),
        }),
      )
    }
    act(() => {
      root.render(createElement(Flip))
    })
    expect(container.querySelector('[data-testid="queue"]')?.closest('[hidden]')).toBeNull()
    act(() => {
      container.querySelector('button')?.click()
    })
    expect(container.querySelector('[data-testid="queue"]')?.closest('[hidden]')).toBeNull()
    expect(container.textContent).not.toContain('Loading reports')
  })
})
