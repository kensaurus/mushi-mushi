/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/FixesPage.test.tsx
 * PURPOSE: /fixes console QA group C, on the real page.
 *   94   `/fixes?status=failed` (banner, alert, tile) opens the failed list
 *        on Attempts, not Overview.
 *   96   A single-row Retry asks first; it spends LLM budget.
 *   241  The retry dialog defaults to the failed attempt's own agent and
 *        sends it as `agentOverride`.
 *   92   Each row has its own selection checkbox.
 *   93   A "Common causes" chip opens the failed list narrowed to that cause.
 *   91   The header counts every attempt, and older ones can be loaded.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FixAttempt } from '../components/fixes/types'
import { EMPTY_FIXES_STATS } from '../components/fixes/FixesStatsTypes'

function fix(over: Partial<FixAttempt>): FixAttempt {
  return {
    id: 'f1',
    report_id: 'r1',
    agent: 'cursor_cloud',
    status: 'failed',
    started_at: '2026-10-03T09:00:00Z',
    report_fix_state: 'failed',
    is_latest_attempt: true,
    retryable: true,
    error: 'Cursor API error 500: upstream',
    report_title: 'Checkout button does nothing',
    ...over,
  } as FixAttempt
}

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), fixes: [] as unknown[], total: 0 }))

vi.mock('../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: { ...EMPTY_FIXES_STATS, hasAnyProject: true },
    loading: false,
    error: null,
    reload: vi.fn(),
    lastFetchedAt: null,
    isValidating: false,
  }),
}))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../lib/heroSnapshots', () => ({ usePublishPageHeroStats: () => undefined }))
vi.mock('../lib/usePlatformIntegrations', () => ({ usePlatformIntegrations: () => ({ traceUrl: () => null }) }))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => ({ activeProject: { project_name: 'App' } }) }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))
vi.mock('../lib/copy', () => ({ usePageCopy: () => null }))
vi.mock('../lib/track', () => ({ trackSelf: vi.fn() }))
vi.mock('../lib/fixesModeUx', () => ({
  useFixesUx: () => ({
    isQuickstart: false,
    isBeginner: false,
    isAdvanced: true,
    compactTable: false,
    hideTabs: false,
    plainBanner: false,
    hideTableChrome: false,
    hideFailureCategories: false,
    hideSnapshotLinks: false,
    hideFixesSnapshot: true,
  }),
  resolveQuickFixesTab: () => 'attempts',
}))
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: {} }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ children }: { children?: unknown }) => createElement('div', { 'data-testid': 'header' }, children as never),
}))

import { FixesPage } from './FixesPage'
import { ToastProvider } from '../lib/toast'

let host: HTMLDivElement
let root: Root
let currentSearch = ''

function LocationProbe() {
  const loc = useLocation()
  currentSearch = loc.search
  return null
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })) as unknown as typeof window.matchMedia
  mocks.apiFetch.mockReset()
  mocks.apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith('/v1/admin/fixes?')) {
      const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset') ?? 0)
      return { ok: true, data: { fixes: offset === 0 ? mocks.fixes : [fix({ id: 'old1', report_id: 'r9', retryable: false })], total: mocks.total } }
    }
    if (path === '/v1/admin/fixes/dispatches') return { ok: true, data: { dispatches: [] } }
    if (path === '/v1/admin/fixes/dispatch') return { ok: true, data: { dispatchId: 'd1' } }
    return { ok: true, data: null }
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
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
}

async function render(url: string) {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(
          ToastProvider,
          null,
          createElement(Routes, null, createElement(Route, {
            path: '/fixes',
            element: createElement('div', null, createElement(LocationProbe), createElement(FixesPage)),
          })),
        ),
      ),
    )
  })
  await flush()
}

function buttons(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label) as HTMLButtonElement[]
}
function click(el: Element | undefined | null) {
  if (!el) throw new Error('element not found')
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('FixesPage', () => {
  it('QA 94: a status link opens the failed list on Attempts', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 1
    await render('/fixes?status=failed')
    expect(document.querySelector('[data-testid="fixes-bulk-action-bar"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Checkout button does nothing')
  })

  it('QA 96 + 241: row Retry asks first and sends the failed attempt’s agent', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 1
    await render('/fixes?tab=attempts')
    const rowRetry = buttons('Retry').find((b) => b.closest('tr'))
    click(rowRetry)
    expect(document.body.textContent).toContain('Retry this fix?')
    const select = document.querySelector('select[aria-label="Agent for the retry"]') as HTMLSelectElement
    expect(select.value).toBe('cursor_cloud')
    expect(mocks.apiFetch.mock.calls.some(([p]) => p === '/v1/admin/fixes/dispatch')).toBe(false)

    click(buttons('Retry').find((b) => !b.closest('tr')))
    await flush()
    const call = mocks.apiFetch.mock.calls.find(([p]) => p === '/v1/admin/fixes/dispatch')
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toMatchObject({ reportId: 'r1', agentOverride: 'cursor_cloud' })
  })

  it('QA 92: each row can be selected on its own', async () => {
    mocks.fixes = [fix({ id: 'a', report_id: 'r1' }), fix({ id: 'b', report_id: 'r2', report_title: 'Login loops' })]
    mocks.total = 2
    await render('/fixes?tab=attempts')
    const box = document.querySelector('input[aria-label="Select the fix for Login loops"]') as HTMLInputElement
    click(box)
    expect(document.body.textContent).toContain('1 selected')
  })

  it('QA 93: a cause chip on Pipeline opens the failed list narrowed to it', async () => {
    mocks.fixes = [
      fix({ id: 'a', report_id: 'r1', failure_category: 'ci_failed' } as Partial<FixAttempt>),
      fix({ id: 'b', report_id: 'r2', report_title: 'Login loops', error: 'Embedding API error: 401', failure_category: 'credential' } as Partial<FixAttempt>),
    ]
    mocks.total = 2
    await render('/fixes?tab=pipeline')
    const chip = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Show the 1 failed fix'))
    click(chip)
    await flush()
    expect(new URLSearchParams(currentSearch).get('tab')).toBe('attempts')
    expect(new URLSearchParams(currentSearch).get('status')).toBe('failed')
    expect(new URLSearchParams(currentSearch).get('cause')).not.toBeNull()
    expect(document.body.textContent).toContain('Cause')
  })

  it('QA 91: counts every attempt and loads older ones', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 2
    await render('/fixes?tab=attempts')
    expect(document.querySelector('[data-testid="header"]')?.textContent).toContain('1 of 2 attempts')
    click(buttons('Load 1 older')[0])
    await flush()
    expect(mocks.apiFetch.mock.calls.some(([p]) => String(p).includes('offset=1'))).toBe(true)
    expect(document.querySelector('[data-testid="header"]')?.textContent).toContain('2 attempts')
  })
})
