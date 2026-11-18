/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/pages/QaCoveragePage.empty.test.tsx
 * PURPOSE: An app with no scheduled tests shows one empty state with one
 *          "+ New story" (2026-11-18 sweep: a banner, a snapshot of zeros and
 *          an empty card said it three times, with three buttons).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ coverage: [] as unknown[] }))

vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ has: () => false, canEditProject: true }) }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null }
    if (!path) return { ...base, data: null }
    if (path.endsWith('/qa-coverage/stats')) {
      return { ...base, data: { hasAnyProject: true, projectId: 'p1', projectName: 'Shop', totalStories: 0, enabledStories: 0, topPriority: 'no_stories', topPriorityLabel: null } }
    }
    if (path.endsWith('/qa-coverage')) return { ...base, data: { coverage: mocks.coverage } }
    return { ...base, data: null }
  },
}))
vi.mock('../lib/realtime', () => ({ useRealtime: () => undefined, useRealtimeReload: () => undefined }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title, children }: { title: string; children?: unknown }) =>
    createElement('header', { 'data-testid': 'header' }, title, children as never),
}))

import { QaCoveragePage } from './QaCoveragePage'
import { ToastProvider } from '../lib/toast'
import { QaCoverageSnapshotStrip } from '../components/qa-coverage/QaCoverageSnapshotStrip'
import { EMPTY_QA_COVERAGE_STATS } from '../components/qa-coverage/QaCoverageStatsTypes'

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

describe('QaCoveragePage with no scheduled tests', () => {
  it('says so once, with one "+ New story" and no snapshot of zeros', async () => {
    mocks.coverage = []
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(QaCoveragePage))))
    })
    const text = host.textContent ?? ''
    expect(text).toContain('No scheduled tests yet')
    expect(text).not.toContain('No scheduled tests on Shop')
    expect(text).not.toContain('Summary')
    const newStory = [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes('New story'))
    expect(newStory).toHaveLength(1)
    expect(host.querySelector('[data-testid="header"]')!.textContent).not.toContain('New story')
  })

  it('puts the CTA before a collapsed, neutral runner guide with real code (round-2 sweep)', async () => {
    mocks.coverage = []
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(QaCoveragePage))))
    })
    const text = host.textContent ?? ''
    const details = host.querySelector('details')!
    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
    // "+ New story" comes before the guide in document order.
    const newStory = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('New story'))!
    expect(newStory.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(text).not.toContain('No stories')
    expect(text).not.toContain('`')
    expect(details.querySelector('code')?.textContent).toBe('mushi qa run')
    expect(details.querySelector('[class*="bg-warn"]')).toBeNull()
  })
})

describe('QaCoverageSnapshotStrip', () => {
  it('keeps its three numbers on one row at phone width (no orphan tile)', async () => {
    await act(async () => {
      root.render(
        createElement(MemoryRouter, null, createElement(QaCoverageSnapshotStrip, { stats: { ...EMPTY_QA_COVERAGE_STATS, totalStories: 2 }, statsFetchedAt: null, hideLinks: true })),
      )
    })
    const grid = host.querySelector('[aria-label="Scheduled tests summary"]')!
    expect(grid.className).toContain('grid-cols-3')
    expect(grid.className).not.toContain('grid-cols-2')
    expect(grid.children).toHaveLength(3)
  })
})
