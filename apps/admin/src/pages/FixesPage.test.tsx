/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/FixesPage.test.tsx
 * PURPOSE: /fixes console QA group C, on the real page.
 *   94   `/fixes?status=failed` (banner, alert, tile) opens the failed list.
 *        `?tab=pipeline` (server link, old bookmarks) opens In flight.
 *   96   A single-row Retry asks first; it spends LLM budget.
 *   241  The retry dialog defaults to the failed attempt's own agent and
 *        sends it as `agentOverride`.
 *   92   Each row has its own selection checkbox.
 *   93   A "Common causes" chip narrows the failed list to that cause.
 *        PR open counts attempts with an open PR whatever CI says, as /repo does.
 *   91   The header counts every attempt, and older ones can be loaded.
 *        The summary strip is reserved while loading, and the merge queue
 *        paints with the list rather than after it. A queue read that
 *        rejects leaves the list up, and a later reload applies once.
 *        Stats keep that summary box; they do not hide the list. A queue
 *        snapshot started before the panel reloads itself does not win.
 */

import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FixAttempt } from '../components/fixes/types'
import { EMPTY_FIXES_STATS } from '../components/fixes/FixesStatsTypes'

function queuePayload(detail: string) {
  return {
    ok: true,
    data: {
      rows: [{
        id: 'q1',
        fix_attempt_id: 'f1',
        project_id: 'p1',
        repo: 'acme/app',
        pr_number: 12,
        state: 'queued',
        detail,
        head_sha: null,
        queued_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
        merged_at: null,
        conflict_agents: 0,
      }],
      trains: [],
      release: [{ projectId: 'p1', mode: 'train', intervalMinutes: 360, maxMembers: 15 }],
    },
  }
}

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

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  fixes: [] as unknown[],
  total: 0,
  reloadFixes: null as (() => void) | null,
  statsLoading: false,
  statsData: null as Record<string, unknown> | null,
  hideFixesSnapshot: true,
  projectId: 'p1' as string | null,
}))

vi.mock('../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: mocks.statsData,
    loading: mocks.statsLoading,
    error: null,
    reload: vi.fn(),
    lastFetchedAt: null,
    isValidating: false,
  }),
}))
vi.mock('../lib/realtime', () => ({
  useRealtimeReload: (_tables: unknown, reload: () => void) => {
    mocks.reloadFixes = reload
    return { channelState: 'idle' }
  },
}))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
vi.mock('../lib/usePlatformIntegrations', () => ({ usePlatformIntegrations: () => ({ traceUrl: () => null }) }))
vi.mock('../lib/useSetupStatus', () => ({ useSetupStatus: () => ({ activeProject: { project_name: 'App' } }) }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => mocks.projectId }))
vi.mock('../lib/copy', () => ({ usePageCopy: () => null }))
vi.mock('../lib/track', () => ({ trackSelf: vi.fn() }))
vi.mock('../lib/fixesModeUx', () => ({
  useFixesUx: () => ({
    isQuickstart: false,
    isBeginner: false,
    isAdvanced: true,
    compactTable: false,
    plainBanner: false,
    hideTableChrome: false,
    hideFailureCategories: false,
    hideSnapshotLinks: false,
    hideFixesSnapshot: mocks.hideFixesSnapshot,
  }),
}))
vi.mock('../components/PagePosture', () => ({ PagePosture: () => null, POSTURE_PRIORITY: {} }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ children }: { children?: unknown }) => createElement('div', { 'data-testid': 'header' }, children as never),
}))

import { FixesPage } from './FixesPage'
import { FixesSnapshotStrip } from '../components/fixes/FixesSnapshotStrip'
import { FixesStatusBanner } from '../components/fixes/FixesStatusBanner'
import { FIXES_BANNER_RESERVE, FIXES_QUEUE_RESERVE, FIXES_SUMMARY_RESERVE } from '../components/fixes/fixesReserve'
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
  mocks.reloadFixes = null
  mocks.statsLoading = false
  mocks.statsData = { ...EMPTY_FIXES_STATS, hasAnyProject: true }
  mocks.hideFixesSnapshot = true
  mocks.projectId = 'p1'
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

async function render(url: string, opts?: { strict?: boolean }) {
  const page = createElement('div', null, createElement(LocationProbe), createElement(FixesPage))
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(
          ToastProvider,
          null,
          opts?.strict
            ? createElement(StrictMode, null, createElement(Routes, null, createElement(Route, { path: '/fixes', element: page })))
            : createElement(Routes, null, createElement(Route, { path: '/fixes', element: page })),
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

function expectReserve(el: Element | null | undefined, classes: string) {
  expect(el).not.toBeNull()
  for (const cls of classes.split(' ')) expect(el!.classList.contains(cls)).toBe(true)
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
    await render('/fixes')
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
    await render('/fixes')
    const box = document.querySelector('input[aria-label="Select the fix for Login loops"]') as HTMLInputElement
    click(box)
    expect(document.body.textContent).toContain('1 selected')
  })

  it('freezes row selection while a bulk retry runs against its start-time selection', async () => {
    mocks.fixes = [fix({ id: 'a', report_id: 'r1' }), fix({ id: 'b', report_id: 'r2', report_title: 'Login loops' })]
    mocks.total = 2
    let release: (v: unknown) => void = () => {}
    const base = mocks.apiFetch.getMockImplementation()!
    mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
      path === '/v1/admin/fixes/dispatch'
        ? new Promise((resolve) => { release = () => resolve({ ok: true, data: { dispatchId: 'd1' } }) })
        : base(path, init),
    )
    await render('/fixes')
    const box = () => document.querySelector('input[aria-label="Select the fix for Login loops"]') as HTMLInputElement
    click(box())
    click(buttons('Retry 1').find((b) => !b.closest('[role="dialog"]')))
    click(buttons('Retry').find((b) => !b.closest('tr')))
    await flush()
    expect(box().disabled).toBe(true)
    await act(async () => { release(null) })
    await flush()
    expect(box().disabled).toBe(false)
  })

  it('QA 94: the old pipeline tab link opens the In flight filter', async () => {
    mocks.fixes = [fix({ id: 'a', status: 'running', report_fix_state: 'in_flight' }), fix({ id: 'b', report_id: 'r2', report_title: 'Login loops' })]
    mocks.total = 2
    await render('/fixes?tab=pipeline')
    const inflight = document.querySelector('[role="radiogroup"][aria-label="Filter fix attempts by status"] [aria-checked="true"]')
    expect(inflight?.textContent).toContain('In flight')
    expect(document.body.textContent).not.toContain('Login loops')
  })

  it('PR open counts an open PR with red CI, like Pull requests', async () => {
    mocks.fixes = [fix({ id: 'a', status: 'completed', pr_url: 'https://github.com/o/r/pull/1', pr_state: 'open', check_run_conclusion: 'failure', report_fix_state: 'failed' })]
    mocks.total = 1
    await render('/fixes')
    const segments = [...document.querySelectorAll('[aria-label="Filter fix attempts by status"] [role="radio"]')]
    expect(segments.find((b) => b.textContent?.startsWith('PR open'))?.textContent).toBe('PR open1')
    expect(segments.find((b) => b.textContent?.startsWith('Failed'))?.textContent).toBe('Failed / skipped1')
  })

  it('Opus: merge lists only open PRs the review said to merge (?status=review_merge)', async () => {
    const pr = (n: number) => ({ status: 'completed', pr_url: `https://github.com/o/r/pull/${n}`, pr_state: 'open' as const, report_fix_state: 'pr_open' as const })
    mocks.fixes = [
      fix({ id: 'a', report_id: 'r1', report_title: 'Approved fix', review_verdict: 'merge', ...pr(1) }),
      fix({ id: 'b', report_id: 'r2', report_title: 'Held fix', review_verdict: 'hold', ...pr(2) }),
      fix({ id: 'c', report_id: 'r3', report_title: 'Merged fix', review_verdict: 'merge', status: 'completed', pr_url: 'https://github.com/o/r/pull/3', pr_state: 'merged' as const, merged_at: '2026-10-22T00:00:00Z' }),
    ]
    mocks.total = 3
    await render('/fixes?status=review_merge')
    const segments = [...document.querySelectorAll('[aria-label="Filter fix attempts by status"] [role="radio"]')]
    expect(segments.find((b) => b.textContent?.startsWith('Opus: merge'))?.textContent).toBe('Opus: merge1')
    expect(document.body.textContent).toContain('Approved fix')
    expect(document.body.textContent).not.toContain('Held fix')
    expect(document.body.textContent).not.toContain('Merged fix')
  })

  it('?report= (Voice reports link) narrows the list to that report', async () => {
    mocks.fixes = [fix({ id: 'a', report_id: 'r1' }), fix({ id: 'b', report_id: 'r2', report_title: 'Login loops' })]
    mocks.total = 2
    await render('/fixes?report=r2')
    expect(document.body.textContent).toContain('Login loops')
    expect(document.body.textContent).not.toContain('Checkout button does nothing')
  })

  it('QA 93: a cause chip narrows the failed list to it', async () => {
    mocks.fixes = [
      fix({ id: 'a', report_id: 'r1', failure_category: 'ci_failed' } as Partial<FixAttempt>),
      fix({ id: 'b', report_id: 'r2', report_title: 'Login loops', error: 'Embedding API error: 401', failure_category: 'credential' } as Partial<FixAttempt>),
    ]
    mocks.total = 2
    await render('/fixes?status=failed')
    const chip = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Show the 1 failed fix'))
    click(chip)
    await flush()
    expect(new URLSearchParams(currentSearch).get('status')).toBe('failed')
    expect(new URLSearchParams(currentSearch).get('cause')).not.toBeNull()
    expect(document.body.textContent).toContain('Cause')
  })

  it('QA 91: counts every attempt and loads older ones', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 2
    await render('/fixes')
    expect(document.querySelector('[data-testid="header"]')?.textContent).toContain('1 of 2 attempts')
    click(buttons('Load 1 older')[0])
    await flush()
    expect(mocks.apiFetch.mock.calls.some(([p]) => String(p).includes('offset=1'))).toBe(true)
    expect(document.querySelector('[data-testid="header"]')?.textContent).toContain('2 attempts')
  })

  it('reserves the summary strip and paints the merge queue with the fix list', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 1
    const payload = queuePayload('Waiting for CI')
    let resolveFixes: (v: unknown) => void = () => {}
    let resolveQueue: (v: unknown) => void = () => {}
    let queueCalls = 0
    const base = mocks.apiFetch.getMockImplementation()!
    mocks.apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/admin/fixes?')) {
        return new Promise((resolve) => { resolveFixes = () => resolve({ ok: true, data: { fixes: mocks.fixes, total: 1 } }) })
      }
      if (path.startsWith('/v1/admin/merge-queue')) {
        queueCalls += 1
        if (queueCalls === 1) return new Promise((resolve) => { resolveQueue = () => resolve(payload) })
        return Promise.resolve(payload)
      }
      return base(path, init)
    })

    await render('/fixes')
    const summary = document.querySelector('[data-testid="fixes-loading-summary"]')
    expect(summary).not.toBeNull()
    expect(document.querySelector('table')).toBeNull()
    expect(summary!.compareDocumentPosition(document.querySelector('[aria-label="Loading fixes"]')!) & Node.DOCUMENT_POSITION_CONTAINS).not.toBe(0)
    expectReserve(summary, FIXES_SUMMARY_RESERVE)
    expectReserve(document.querySelector('[data-testid="fixes-loading-banner"]'), FIXES_BANNER_RESERVE)
    expectReserve(document.querySelector('[data-testid="fixes-loading-queue"]'), FIXES_QUEUE_RESERVE)

    await act(async () => {
      resolveFixes(null)
      resolveQueue(null)
    })
    await flush()

    expect(document.querySelector('[data-testid="fixes-loading-summary"]')).toBeNull()
    const queue = document.querySelector('[aria-label="Merge queue"]')
    const table = document.querySelector('table')
    expect(queue).not.toBeNull()
    expect(table).not.toBeNull()
    expect(queue!.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(document.body.textContent).toContain('Merge when ready')
    expect(queueCalls).toBe(1)
    expectReserve(queue!.firstElementChild, FIXES_QUEUE_RESERVE)
  })

  it('reads no merge queue without an active app (an unfiltered read lists every app)', async () => {
    mocks.projectId = null
    mocks.fixes = [fix({})]
    mocks.total = 1
    await render('/fixes')
    const queueCalls = mocks.apiFetch.mock.calls.filter(([p]) => String(p).startsWith('/v1/admin/merge-queue'))
    expect(queueCalls).toEqual([])
  })

  it('does not refetch the queue on mount under StrictMode', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 1
    const base = mocks.apiFetch.getMockImplementation()!
    mocks.apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/admin/merge-queue')) return Promise.resolve(queuePayload('Waiting for CI'))
      return base(path, init)
    })
    await render('/fixes', { strict: true })
    const queueCalls = mocks.apiFetch.mock.calls.filter(([p]) => String(p).startsWith('/v1/admin/merge-queue')).length
    expect(queueCalls).toBe(1)
    expect(document.body.textContent).toContain('Waiting for CI')
  })

  it('shows the fix list when the merge queue rejects', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 1
    let queueCalls = 0
    const base = mocks.apiFetch.getMockImplementation()!
    mocks.apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/admin/merge-queue')) {
        queueCalls += 1
        throw new Error('queue down')
      }
      return base(path, init)
    })
    await render('/fixes')
    expect(document.body.textContent).toContain('Checkout button does nothing')
    expect(document.body.textContent).not.toContain('Failed to load fix attempts.')
    expect(queueCalls).toBe(1)
  })

  it('applies a later merge-queue snapshot from one reload', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 1
    let queueCalls = 0
    const details = ['Waiting for CI', 'Branch is behind']
    const base = mocks.apiFetch.getMockImplementation()!
    mocks.apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/admin/merge-queue') && (init?.method ?? 'GET') === 'GET') {
        const detail = details[Math.min(queueCalls, details.length - 1)]!
        queueCalls += 1
        return Promise.resolve(queuePayload(detail))
      }
      return base(path, init)
    })
    await render('/fixes')
    expect(document.body.textContent).toContain('Waiting for CI')
    expect(queueCalls).toBe(1)

    await act(async () => { mocks.reloadFixes?.() })
    await flush()
    expect(document.body.textContent).toContain('Branch is behind')
    expect(document.body.textContent).not.toContain('Waiting for CI')
    expect(queueCalls).toBe(2)
  })

  it('shows the fix list while stats are still loading, with the summary box held', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 1
    mocks.statsLoading = true
    mocks.statsData = null
    mocks.hideFixesSnapshot = false
    await render('/fixes')
    expect(document.querySelector('[aria-label="Loading fixes"]')).toBeNull()
    expect(document.querySelector('table')).not.toBeNull()
    expect(document.body.textContent).toContain('Checkout button does nothing')
    const summary = document.querySelector('[data-testid="fixes-summary-placeholder"]')
    const table = document.querySelector('table')
    expectReserve(summary, FIXES_SUMMARY_RESERVE)
    expectReserve(document.querySelector('[data-testid="fixes-banner-placeholder"]'), FIXES_BANNER_RESERVE)
    expect(summary!.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('ignores a merge-queue snapshot that started before the panel reloaded', async () => {
    mocks.fixes = [fix({})]
    mocks.total = 1
    let releaseStale: (v: unknown) => void = () => {}
    let queueGets = 0
    const base = mocks.apiFetch.getMockImplementation()!
    mocks.apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (path.startsWith('/v1/admin/merge-queue/') && method === 'DELETE') {
        return Promise.resolve({ ok: true, data: { id: 'q1', state: 'removed' } })
      }
      if (path.startsWith('/v1/admin/merge-queue') && method === 'GET') {
        queueGets += 1
        if (queueGets === 1) return Promise.resolve(queuePayload('Waiting for CI'))
        if (queueGets === 2) return new Promise((resolve) => { releaseStale = () => resolve(queuePayload('Waiting for CI')) })
        return Promise.resolve(queuePayload('Branch updated'))
      }
      return base(path, init)
    })
    await render('/fixes')
    expect(document.body.textContent).toContain('Waiting for CI')

    await act(async () => { mocks.reloadFixes?.() })
    click(buttons('Remove')[0])
    await flush()
    expect(queueGets).toBe(3)
    expect(document.body.textContent).toContain('Branch updated')
    expect(document.body.textContent).not.toContain('Waiting for CI')

    await act(async () => { releaseStale(null) })
    await flush()
    expect(document.body.textContent).toContain('Branch updated')
    expect(document.body.textContent).not.toContain('Waiting for CI')
  })

  it('uses the same summary and banner boxes the loaded blocks use', async () => {
    const stats = { ...EMPTY_FIXES_STATS, hasAnyProject: true, topPriority: 'healthy' as const }
    await act(async () => {
      root.render(createElement(MemoryRouter, null,
        createElement('div', null,
          createElement(FixesStatusBanner, { stats }),
          createElement(FixesSnapshotStrip, { stats, statsFetchedAt: null }),
        ),
      ))
    })
    expectReserve(document.querySelector('[class~="min-h-40"]'), FIXES_BANNER_RESERVE)
    expectReserve(document.querySelector('[class~="min-h-112"]'), FIXES_SUMMARY_RESERVE)
  })
})
