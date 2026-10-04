/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/IteratePage.test.tsx
 * PURPOSE: /iterate console QA 21 and 244.
 *   - Abort asks first (it is irreversible), from the table and the drawer.
 *   - After Abort or Trigger the open drawer shows the new state instead of
 *     the one it opened with ("Running" with an enabled Abort; a queued run
 *     still offering "Trigger now", inviting a second paid trigger).
 *   - The runs list pages through every run the tab badge counts.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdcaRun } from '../components/iterate/types'
import { EMPTY_ITERATE_STATS } from '../components/iterate/IterateStatsTypes'

function run(over: Partial<PdcaRun>): PdcaRun {
  return {
    id: 'r1',
    project_id: 'p1',
    target_url: 'https://app.test/home',
    goal: 'g',
    iterations_target: 5,
    current_iteration: 1,
    status: 'running',
    primary_model: 'claude-sonnet-5-5',
    judge_model: 'claude-sonnet-5-5',
    persona: 'wcag-a11y',
    target_score: 0.7,
    started_at: null,
    finished_at: null,
    final_score: null,
    created_at: '2026-10-04T00:00:00Z',
    iterations: [],
    ...over,
  }
}

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  paths: [] as string[],
  listTotal: 1,
  listRuns: [] as unknown[],
}))

vi.mock('../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    if (path) mocks.paths.push(path)
    const base = { reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null }
    if (path === '/v1/admin/pdca/stats') {
      return { ...base, data: { ...EMPTY_ITERATE_STATS, hasAnyProject: true, total: mocks.listTotal, running: 1 } }
    }
    if (path?.startsWith('/v1/admin/pdca?')) {
      return { ...base, data: { data: mocks.listRuns, total: mocks.listTotal, page: 1, limit: 50 } }
    }
    return { ...base, data: null }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => ({ activeProject: { project_name: 'App' } }) }))
vi.mock('../lib/copy', () => ({ usePageCopy: () => null }))
vi.mock('../lib/iterateModeUx', () => ({
  useIterateUx: () => ({
    isQuickstart: false,
    isBeginner: false,
    isAdvanced: true,
    hideTabs: false,
    plainBanner: false,
    hideOverviewChrome: true,
    hideIterateSnapshot: true,
  }),
  resolveQuickIterateTab: () => 'runs',
}))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => undefined }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../lib/heroSnapshots', () => ({ usePublishPageHeroStats: () => undefined }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: {} }))

import { IteratePage } from './IteratePage'
import { ToastProvider } from '../lib/toast'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.apiFetch.mockReset()
  mocks.paths = []
  mocks.listTotal = 1
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

function render() {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/iterate?tab=runs'] },
        createElement(ToastProvider, null, createElement(IteratePage)),
      ),
    )
  })
}

function buttons(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label) as HTMLButtonElement[]
}

function click(el: HTMLElement) {
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('IteratePage abort (QA 21)', () => {
  it('asks before aborting, then shows the aborted state in the open drawer', async () => {
    let current = run({ status: 'running' })
    mocks.listRuns = [current]
    mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        current = { ...current, status: 'aborted' }
        return { ok: true }
      }
      return { ok: true, data: current }
    })
    render()

    // Open the drawer for the running run.
    click(document.querySelector('button[aria-label="Open run detail"]') as HTMLElement)
    await flush()
    expect(document.body.textContent).toContain('Running')

    // Abort from the drawer asks first and sends nothing yet.
    const abortButtons = buttons('Abort')
    click(abortButtons[abortButtons.length - 1]!)
    expect(document.body.textContent).toContain('Abort this PDCA run?')
    expect(mocks.apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)

    click(buttons('Abort run')[0]!)
    await flush()
    expect(mocks.apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(true)
    // The drawer re-read the run: Aborted, and no Abort button left in it.
    expect(document.body.textContent).toContain('Aborted')
    expect(document.body.textContent).not.toContain('Abort this PDCA run?')
  })

  it('refreshes the drawer after Trigger so "Trigger now" is not offered twice', async () => {
    let current = run({ status: 'queued', current_iteration: 0 })
    mocks.listRuns = [current]
    mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(path).endsWith('/trigger')) {
        current = { ...current, status: 'running' }
        return { ok: true }
      }
      return { ok: true, data: current }
    })
    render()
    click(document.querySelector('button[aria-label="Open run detail"]') as HTMLElement)
    await flush()
    click(buttons('Trigger now')[0]!)
    await flush()
    expect(buttons('Trigger now')).toHaveLength(0)
  })
})

describe('IteratePage runs paging (QA 244)', () => {
  it('requests a page and offers the next one when the badge counts more', () => {
    mocks.listTotal = 73
    mocks.listRuns = Array.from({ length: 50 }, (_, i) => run({ id: `r${i}`, status: 'succeeded' }))
    render()
    expect(mocks.paths.some((p) => p.includes('limit=50') && p.includes('page=1'))).toBe(true)
    expect(document.body.textContent).toContain('Showing 1–50 of 73 runs')
    click(buttons('Next →')[0]!)
    expect(mocks.paths.some((p) => p.includes('page=2'))).toBe(true)
  })
})
