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
 *   Journeys 2026-10-27: the page opens on Ready to merge (Opus merge on the
 *        current commit, CI green) with "Merge when ready", and on stopped
 *        reports grouped by reason with Retry beside each reason; the header
 *        has no bulk paid Retry.
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
  usePageData: (path: string | null) => ({
    // The stats read; the pipeline read (release stations) is not under test here.
    data: path?.startsWith('/v1/admin/pipeline') ? null : { ...EMPTY_FIXES_STATS, hasAnyProject: true },
    loading: false,
    error: null,
    reload: vi.fn(),
    lastFetchedAt: null,
    isValidating: false,
  }),
}))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => undefined }))
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
    plainBanner: false,
    hideTableChrome: false,
    hideFailureCategories: false,
    hideSnapshotLinks: false,
    hideFixesSnapshot: true,
  }),
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
    click(buttons('Retry 1').find((b) => b.closest('[data-testid="fixes-bulk-action-bar"]')))
    click(buttons('Retry').find((b) => !b.closest('tr')))
    await flush()
    expect(box().disabled).toBe(true)
    await act(async () => { release(null) })
    await flush()
    expect(box().disabled).toBe(false)
  })

  it('In flight counts the report that is running, not a stale attempt on a shipped report', async () => {
    mocks.fixes = [
      fix({ id: 'live', report_id: 'r1', status: 'running', report_fix_state: 'in_flight', is_latest_attempt: true, report_title: 'Still running' }),
      fix({ id: 'stale', report_id: 'r2', status: 'running', report_fix_state: 'resolved', is_latest_attempt: false, report_title: 'Already shipped' }),
      fix({ id: 'earlier', report_id: 'r1', status: 'queued', report_fix_state: 'in_flight', is_latest_attempt: false, report_title: 'Earlier attempt' }),
    ]
    mocks.total = 3
    await render('/fixes')
    const segments = [...document.querySelectorAll('[aria-label="Filter fix attempts by status"] [role="radio"]')]
    expect(segments.find((b) => b.textContent?.startsWith('In flight'))?.textContent).toBe('In flight1')
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

  describe('what the page shows first (journeys 2026-10-27)', () => {
    const open = (n: number, over: Partial<FixAttempt> = {}) =>
      fix({
        id: `pr${n}`,
        report_id: `r${n}`,
        report_title: `Fix ${n}`,
        status: 'completed',
        pr_url: `https://github.com/o/r/pull/${n}`,
        pr_number: n,
        pr_state: 'open',
        report_fix_state: 'pr_open',
        retryable: false,
        commit_sha: `head${n}`,
        check_run_conclusion: 'success',
        review_verdict: 'merge',
        review_head_sha: `head${n}`,
        ...over,
      })

    it('lists Ready to merge only for an Opus merge on the current commit with CI green, and queues them', async () => {
      mocks.fixes = [
        open(1),
        open(2, { review_head_sha: 'older' }),
        open(3, { check_run_conclusion: 'failure' }),
        open(4, { review_verdict: 'hold' }),
      ]
      mocks.total = 4
      await render('/fixes')
      const list = document.querySelector('[data-testid="fixes-ready-list"]')!
      expect(list.textContent).toContain('Fix 1')
      expect(list.textContent).not.toContain('Fix 2')
      expect(list.textContent).not.toContain('Fix 3')
      expect(list.textContent).not.toContain('Fix 4')
      click(document.querySelector('[data-testid="fixes-ready-queue-all"]'))
      await flush()
      const call = mocks.apiFetch.mock.calls.find(([p]) => p === '/v1/admin/merge-queue')
      expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ fixIds: ['pr1'] })
    })

    it('groups stopped reports by reason, with Retry beside a reason a retry can clear', async () => {
      mocks.fixes = [
        fix({ id: 'a', report_id: 'r1', failure_category: 'sandbox_timeout' } as Partial<FixAttempt>),
        fix({ id: 'b', report_id: 'r2', report_title: 'Ops task', failure_category: 'needs_human', retryable: false } as Partial<FixAttempt>),
      ]
      mocks.total = 2
      await render('/fixes')
      expect(buttons('Retry 1 unfixed')).toHaveLength(0)
      const timeout = document.querySelector('[data-testid="fixes-stopped-sandbox_timeout"]')!
      expect(timeout.textContent).toContain('Ran out of time')
      expect(document.querySelector('[data-testid="fixes-stopped-needs_human-retry"]')).toBeNull()
      expect(document.querySelector('[data-testid="fixes-stopped-needs_human-no-retry"]')!.textContent).toContain('would stop the same way')
      click(document.querySelector('[data-testid="fixes-stopped-sandbox_timeout-retry"]'))
      expect(document.body.textContent).toContain('stopped by "Ran out of time"')
      expect(mocks.apiFetch.mock.calls.some(([p]) => p === '/v1/admin/fixes/dispatch')).toBe(false)
      click(buttons('Retry').find((b) => b.closest('[role="dialog"]')))
      await flush()
      const calls = mocks.apiFetch.mock.calls.filter(([p]) => p === '/v1/admin/fixes/dispatch')
      expect(calls).toHaveLength(1)
      expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toMatchObject({ reportId: 'r1' })
    })
  })
})
