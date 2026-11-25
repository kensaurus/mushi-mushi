/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/fixes/FixesSnapshotStrip.test.tsx
 * PURPOSE: Fresh-eyes sweep 2026-11-18: "● No fixes in the last 30 days." used
 *          a green ok dot while 4 bugs waited. With no fix yet the line has the
 *          off mark (○) and links the bugs waiting for one.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const page = vi.hoisted(() => ({ path: null as string | null, total: 4 as number | undefined }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    page.path = path
    return { data: path ? { total: page.total } : null, loading: false, error: null }
  },
}))

import { FixesSnapshotStrip } from './FixesSnapshotStrip'
import { EMPTY_FIXES_STATS } from './FixesStatsTypes'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  page.path = null
  page.total = 4
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(stats = EMPTY_FIXES_STATS, inFlight = 0) {
  act(() => root.render(createElement(MemoryRouter, null, createElement(FixesSnapshotStrip, { stats, inFlight }))))
}

describe('FixesSnapshotStrip with no fixes yet', () => {
  it('draws the off mark, never a green dot, and links the bugs waiting for a fix', () => {
    render()
    const line = container.querySelector('[data-testid="fixes-none-yet"]')!
    expect(line.querySelector('svg[data-tone="off"]')).toBeTruthy()
    expect(line.querySelector('.bg-ok')).toBeNull()
    const link = line.querySelector('a')!
    expect(link.textContent).toBe('4 bugs waiting for a fix')
    expect(link.getAttribute('href')).toContain('/reports?status=open')
  })

  it('says nothing about waiting bugs when there are none', () => {
    page.total = 0
    render()
    expect(container.querySelector('[data-testid="fixes-none-yet"] a')).toBeNull()
  })

  it('keeps the counted status once a fix has run, without fetching open bugs', () => {
    render({ ...EMPTY_FIXES_STATS, totalAttempts: 3, completed: 2 })
    expect(container.querySelector('[data-testid="fixes-none-yet"]')).toBeNull()
    expect(page.path).toBeNull()
  })
})

describe('FixesSnapshotStrip once fixes have run (ADR 0069)', () => {
  it('is one line: each clause links to the list it counts, with no number tiles', () => {
    render({ ...EMPTY_FIXES_STATS, totalAttempts: 5, failed: 2, prsOpen: 1, completed: 3 }, 1)
    const status = container.querySelector('[aria-label="Fixes status"]')!
    expect(status.querySelector('dl')).toBeNull()
    const links = [...status.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
    expect(links).toContainEqual(['1 fix running', '/fixes?status=inflight'])
    expect(links.some(([, href]) => href?.includes('status=failed'))).toBe(true)
    expect(links.some(([text, href]) => text?.includes('fixed in the last 30 days') && href?.includes('status=merged'))).toBe(true)
  })
})
