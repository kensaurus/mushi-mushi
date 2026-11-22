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
  it('says so once, with one "+ New test" and no snapshot of zeros', async () => {
    mocks.coverage = []
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(QaCoveragePage))))
    })
    const text = host.textContent ?? ''
    expect(text).toContain('No scheduled tests yet')
    expect(text).not.toContain('No scheduled tests on Shop')
    expect(text).not.toContain('Summary')
    const newStory = [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes('New test'))
    expect(newStory).toHaveLength(1)
    expect(host.querySelector('[data-testid="header"]')!.textContent).not.toContain('New test')
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
    const newStory = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('New test'))!
    expect(newStory.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(text).not.toContain('No stories')
    expect(text).not.toContain('`')
    expect(details.querySelector('code')?.textContent).toBe('mushi qa run')
    expect(details.querySelector('[class*="bg-warn"]')).toBeNull()
  })
})

describe('QaCoveragePage lead when every test was skipped', () => {
  it('says why in one sentence and offers one button that moves them to the cloud', async () => {
    const story = (id: string, name: string) => ({
      story_id: id, project_id: 'p1', name, enabled: true, browser_provider: 'local', last_run_status: 'skipped',
      runs_24h: 24, passed_24h: 0, failed_24h: 0, error_24h: 0, pass_rate_pct: null, last_run_at: null, last_failure_url: null,
      last_7d: [{ day: '2026-11-19', passed: 0, failed: 0, skipped: 24 }],
    })
    mocks.coverage = [story('a', 'Login'), story('b', 'Checkout'), story('c', 'Signup')]
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(QaCoveragePage))))
    })
    const status = host.querySelector('[data-testid="qa-status"]')!
    expect(status.textContent).toContain('3 tests never ran: they are set to run on your computer only.')
    expect(host.querySelector('[data-testid="qa-run-all-in-cloud"]')?.textContent).toBe('Run all 3 in the cloud')
    // Each card says why too, and its strip marks the day as skipped, not failed.
    expect(host.querySelectorAll('[data-testid="qa-skip-reason"]')).toHaveLength(3)
    expect(host.querySelector('[data-testid="qa-run-strip"] li')?.getAttribute('data-tone')).toBe('skip')
    // The old banner and the snapshot of numbers are gone: the status is said once.
    expect(host.textContent).not.toContain('No test results yet')
    expect(host.textContent).not.toContain('Summary')
  })
})
