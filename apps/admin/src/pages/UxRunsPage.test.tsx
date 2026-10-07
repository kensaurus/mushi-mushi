/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/UxRunsPage.test.tsx
 * PURPOSE: Plan 021 UX runs page: shows how to start when there is no run,
 *          puts screens that need a human first, files a screen as a bug, and
 *          starts a cloud run (or shows the command when Mushi cannot).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P = '1000000f-0000-4000-8000-000000000000'
const mocks = vi.hoisted(() => ({ usePageData: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../lib/usePageData', () => ({ usePageData: mocks.usePageData }))
vi.mock('../lib/supabase', () => ({ apiFetchMutate: mocks.apiFetchMutate }))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => P }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: ({ title }: { title: string }) => createElement('h1', null, title) }))

import { UxRunsPage } from './UxRunsPage'

const RUN = {
  id: 'r1',
  local_run_id: '20261006-011207-qafu',
  mode: 'local',
  status: 'done',
  agent: 'claude-code',
  model: null,
  judge_model: null,
  branch: 'mushi-ux/20261006-011207-qafu',
  counts: { accepted: 1, regressed: 1 },
  started_at: '2026-10-06T01:12:07Z',
  finished_at: '2026-10-06T01:13:19Z',
  updated_at: '2026-10-06T01:13:19Z',
}
const surface = (key: string, label: string, status: string) => ({
  id: `s-${key}`,
  surface_key: key,
  kind: 'page',
  path: `/${key}`,
  label,
  status,
  note: null,
  penalty_before: 4,
  penalty_after: 0,
  probe_before: null,
  probe_after: { axe: [], overflowX: false, smallTargets: 0, consoleErrors: 0, cls: 0 },
  judge: null,
  report_id: null,
  thumb_before_url: null,
  thumb_after_url: null,
  thumb_diff_url: null,
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.usePageData.mockReset()
  mocks.apiFetchMutate.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const MODELS = {
  models: [
    {
      id: 'grok-4.7',
      displayName: 'Grok 4.7',
      parameters: [
        { id: 'reasoning_effort', values: [{ value: 'high' }, { value: 'xhigh', displayName: 'Extra high' }] },
        { id: 'context', values: [{ value: '200k' }, { value: '500k' }] },
      ],
    },
  ],
}
const SKILLS = { data: [{ slug: 'enhance-mobile-native-feel', title: 'Native feel', category: 'enhance' }] }

function render(list: unknown, detail: unknown = null) {
  const reload = vi.fn()
  mocks.usePageData.mockImplementation((path: string | null) => {
    if (path === null) return { data: null, loading: false, error: null, reload }
    if (path.endsWith('/ux-runs')) return { data: list, loading: false, error: null, reload }
    if (path.includes('/cursor/models')) return { data: MODELS, loading: false, error: null, reload }
    if (path.startsWith('/v1/admin/skills')) return { data: SKILLS, loading: false, error: null, reload }
    return { data: detail, loading: false, error: null, reload }
  })
  act(() => root.render(createElement(MemoryRouter, null, createElement(UxRunsPage))))
  return { reload }
}

describe('UxRunsPage', () => {
  it('explains how to start a run when there is none', () => {
    render({ runs: [] })
    expect(host.textContent).toContain('Start your first run')
    expect(host.textContent).toContain('mushi ux ui')
    for (const step of ['1. What to improve', '2. Who does the work', '3. How much', '4. Your app']) expect(host.textContent).toContain(step)
    // Cost is stated plainly, with no invented balance and no automatic account switching.
    expect(host.textContent).toContain('No agent reports how much credit is left')
    expect(host.textContent).toContain('never switches accounts for you')
  })

  it('lists screens that need a human first and files one as a bug', async () => {
    mocks.apiFetchMutate.mockResolvedValue({ ok: true, data: { report_id: 'rep-1' } })
    render(
      { runs: [RUN] },
      {
        run: RUN,
        surfaces: [surface('home', 'Home', 'accepted'), surface('about', 'About', 'regressed')],
        iterations: [],
      },
    )
    const screens = [...host.querySelectorAll('ul[aria-label="Screens"] button')].map((b) => b.textContent)
    expect(screens[0]).toContain('About')
    expect(screens[0]).toContain('Moved by another fix')
    expect(host.textContent).toContain('mushi-ux/20261006-011207-qafu')

    const file = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('File as bug'))
    await act(async () => {
      file?.click()
      await Promise.resolve()
    })
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/projects/${P}/ux-runs/20261006-011207-qafu/surfaces/about/report`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('starts a cloud run, and shows the command when the workflow is missing', async () => {
    render({ runs: [] })
    const start = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Start a cloud run'))
    mocks.apiFetchMutate.mockResolvedValueOnce({
      ok: false,
      error: { code: 'WORKFLOW_MISSING', message: 'o/web has no .github/workflows/mushi-ux.yml on main.' },
      data: { fallback: { command: 'gh workflow run mushi-ux.yml --repo o/web -f agent=cursor-cloud', template_url: 'https://example.test/t' } },
    })
    await act(async () => {
      start()?.click()
      await Promise.resolve()
    })
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/projects/${P}/ux-runs/cloud`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ max_surfaces: 5 }) }),
    )
    expect(host.textContent).toContain('has no .github/workflows/mushi-ux.yml')
    expect(host.textContent).toContain('gh workflow run mushi-ux.yml --repo o/web')

    mocks.apiFetchMutate.mockResolvedValueOnce({ ok: true, data: { repo: 'o/web', actions_url: 'https://github.com/o/web/actions/workflows/mushi-ux.yml' } })
    await act(async () => {
      start()?.click()
      await Promise.resolve()
    })
    expect(host.textContent).toContain('Started on o/web')
    expect(host.textContent).not.toContain('gh workflow run')
  })
})

describe('UxRunsPage, live progress and choices', () => {
  const change = (el: HTMLSelectElement, value: string) =>
    act(() => {
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })

  it('shows a small-steps plan, names attempts by step, and counts kept edits not screens', () => {
    const steps = { ...RUN, counts: { accepted: 1 }, skill: 'enhance-mobile-native-feel' }
    const home = {
      ...surface('home', 'Home', 'accepted'),
      plan: [
        { text: 'Unify the tile accents', status: 'done', attempt: 1 },
        { text: 'Respect reduced motion', status: 'skipped', attempt: 2 },
        { text: 'Raise the hint text size', status: 'done', attempt: 3 },
      ],
    }
    const it3 = (n: number, outcome: string, step: string) => ({ id: `i${n}`, surface_id: 's-home', n, agent: 'cursor', model: null, duration_ms: 1000, outcome, reason: 'r', commit_sha: null, step, steps: '[find] a search\n[find] a search\n[edit] a.tsx' })
    render(
      { runs: [steps] },
      { run: steps, surfaces: [home], iterations: [it3(1, 'accepted', 'Unify the tile accents'), it3(2, 'no_change', 'Respect reduced motion'), it3(3, 'accepted', 'Raise the hint text size')] },
    )
    expect(host.textContent).toContain('Plan: 2 of 3 steps kept')
    expect(host.textContent).toContain('Step 2. Respect reduced motion (not needed)')
    expect(host.textContent).toContain('What the agent did in step 3')
    expect(host.textContent).toContain('Edits kept2on 1 improved screen')
    expect(host.textContent).toContain('1 screen · 1 improved')
    expect(host.textContent).toContain('enhance-mobile-native-feel')
    expect(host.textContent).not.toContain('Attempt 3')
    // An improved screen with nothing measured wrong offers no "File as bug".
    expect(host.textContent).not.toContain('File as bug')
    expect(host.querySelector('pre')?.textContent).toContain('[find] 2 searches')
  })

  it('shows where a running run is and each attempt’s screenshot', () => {
    const live = { ...RUN, status: 'running', phase: 'working', current_surface: 'home', current_attempt: 2, skill: 'enhance-mobile-native-feel', base_ref: 'origin/main' }
    const home = {
      ...surface('home', 'Home', 'iterating'),
      thumb_urls: { 'before-mobile': 'https://img.test/before-mobile.png' },
    }
    render(
      { runs: [live] },
      {
        run: live,
        surfaces: [home, surface('about', 'About', 'accepted')],
        iterations: [
          { id: 'i1', surface_id: 's-home', n: 1, agent: 'cursor', model: 'grok-4.7', duration_ms: 61000, outcome: 'rejected', reason: 'scrolls sideways', commit_sha: null, pixel_diff: { mobile: 0.12 }, thumb_urls: { 'after-mobile': 'https://img.test/iter1-mobile.png' } },
        ],
      },
    )
    expect(host.textContent).toContain('Working')
    expect(host.textContent).toContain('Home, attempt 2')
    expect(host.textContent).toContain('1 of 2 screens done')
    expect(host.textContent).toContain('skill enhance-mobile-native-feel')
    // The screen the agent is on is selected, on mobile, with its attempt and the one in progress.
    const imgs = [...host.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(imgs).toContain('https://img.test/before-mobile.png')
    expect(imgs).toContain('https://img.test/iter1-mobile.png')
    expect(host.textContent).toContain('Attempt 2 in progress')
    expect(host.textContent).toContain('12.0% px')
  })

  it('shows the agent’s live step and files, each attempt’s steps, and a run that went quiet', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-06T09:05:00Z'))
      const progress = { steps: 7, last_step: '[edit] app/page.tsx', files: ['app/page.tsx', 'app/globals.css'], started_at: '2026-10-06T09:02:00Z', timeout_ms: 900_000 }
      const live = { ...RUN, status: 'running', phase: 'working', current_surface: 'home', current_attempt: 2, current_progress: progress, updated_at: '2026-10-06T09:04:40Z' }
      const iterations = [
        { id: 'i1', surface_id: 's-home', n: 1, agent: 'cursor', model: 'grok-4.7', duration_ms: 61000, outcome: 'no_change', reason: 'no edits', commit_sha: null, steps: '[read] app/page.tsx\n› Already fine.' },
      ]
      render({ runs: [live] }, { run: live, surfaces: [surface('home', 'Home', 'iterating')], iterations })
      expect(host.textContent).toContain('3m 00s of 15m 00s')
      expect(host.textContent).toContain('7 steps · [edit] app/page.tsx')
      expect(host.textContent).toContain('Changed so far: app/page.tsx, app/globals.css')
      expect(host.textContent).toContain('What the agent did in attempt 1')
      expect(host.querySelector('details pre')?.textContent).toContain('[read] app/page.tsx')
      expect(host.textContent).not.toContain('No update for')

      act(() => root.unmount())
      root = createRoot(host)
      const quiet = { ...live, updated_at: '2026-10-06T08:55:00Z' }
      render({ runs: [quiet] }, { run: quiet, surfaces: [surface('home', 'Home', 'iterating')], iterations })
      expect(host.textContent).toContain('No update for 10 min')
      expect(host.textContent).toContain(`mushi ux run --resume ${RUN.local_run_id}`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a cloud run with a model from the account, its settings, and a skill', async () => {
    render({ runs: [] })
    const selects = () => [...host.querySelectorAll('select')] as HTMLSelectElement[]
    change(selects()[0], 'grok-4.7')
    // The model's own settings appear once it is chosen.
    expect(selects()).toHaveLength(4)
    change(selects()[1], 'xhigh')
    change(selects()[2], '500k')
    change(selects()[3], 'enhance-mobile-native-feel')
    mocks.apiFetchMutate.mockResolvedValueOnce({ ok: true, data: { repo: 'o/web', actions_url: 'https://github.com/o/web/actions' } })
    const start = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Start a cloud run'))
    await act(async () => {
      start?.click()
      await Promise.resolve()
    })
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/projects/${P}/ux-runs/cloud`,
      expect.objectContaining({
        body: JSON.stringify({ max_surfaces: 5, model: 'grok-4.7?reasoning_effort=xhigh&context=500k', skill: 'enhance-mobile-native-feel' }),
      }),
    )
  })
})
