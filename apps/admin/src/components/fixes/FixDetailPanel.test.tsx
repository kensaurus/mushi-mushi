/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/fixes/FixDetailPanel.test.tsx
 * PURPOSE: The expanded fix row, console QA group C.
 *   88  "Refresh from GitHub" never reported a failed CI sync: apiFetch
 *       returns { ok:false } instead of throwing, so the catch was dead.
 *   95  The receipt's "Open source report" was a raw <a href="/reports/…">
 *       that dropped the deployed base path (/mushi-mushi/admin/).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FixAttempt } from './types'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('@sentry/react', () => ({ captureMessage: vi.fn() }))

import { FixDetailPanel } from './FixDetailPanel'
import { ToastProvider } from '../../lib/toast'

const FIX = {
  id: 'f1',
  report_id: 'r1',
  agent: 'cursor_cloud',
  status: 'completed',
  started_at: '2026-10-03T09:00:00Z',
  pr_url: 'https://github.com/o/r/pull/7',
  pr_number: 7,
} as FixAttempt

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.apiFetch.mockReset()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

function render() {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        { basename: '/mushi-mushi/admin', initialEntries: ['/mushi-mushi/admin/fixes'] },
        createElement(
          ToastProvider,
          null,
          createElement(FixDetailPanel, { fix: FIX, timeline: [], traceUrl: null, onRetry: async () => {} }),
        ),
      ),
    )
  })
}

describe('FixDetailPanel', () => {
  it('QA 88: says when the CI sync failed', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: false, error: { code: 'CI_SYNC_FAILED', message: 'ci-sync 401' } })
    render()
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Refresh from GitHub')
    act(() => btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flush()
    expect(document.body.textContent).toContain("Couldn't read CI from GitHub")
  })

  it('QA 88: confirms a sync with the CI state it read', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { check_run_conclusion: 'success' } })
    render()
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Refresh from GitHub')
    act(() => btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flush()
    expect(document.body.textContent).toContain('Synced with GitHub')
  })

  it('QA 95: the receipt link keeps the console base path', () => {
    render()
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent === 'Open source report')
    expect(link?.getAttribute('href')).toBe('/mushi-mushi/admin/reports/r1')
  })
})
