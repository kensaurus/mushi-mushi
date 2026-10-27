/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/ux-runs/FreshEyesPanel.test.tsx
 * PURPOSE: The Fresh eyes tab (ADR 0051): with no run it gives the command to
 *          paste; with runs it leads with time to first value and steps,
 *          shows each step with its screenshot and wait, says where a
 *          session stalled and why, and links the reports it filed. The UX
 *          runs page opens it with ?tab=fresh-eyes.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P = '1000000f-0000-4000-8000-000000000000'
const mocks = vi.hoisted(() => ({ usePageData: vi.fn() }))
vi.mock('../../lib/usePageData', () => ({ usePageData: mocks.usePageData }))
vi.mock('../../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))

import { FreshEyesPanel } from './FreshEyesPanel'
import { formatSeconds, freshEyesCommand, runHeadline, stepNotes, ttfvTrend, type FreshEyesStep } from '../../lib/freshEyes'

const RUN = {
  local_run_id: '20261027-210000-ab12',
  status: 'done',
  model: 'grok-4.7-high-fast',
  goal: 'get my first bug explained',
  start_url: 'https://kensaur.us/mushi-mushi/',
  ttfv_seconds: 372,
  steps: 11,
  reached: 2,
  stalled_at: { screen: '/mushi-mushi/admin/onboarding', reason: 'model_gave_up', sessions: 1 },
  findings: [{ fingerprint: 'abcdef0123456789', severity: 'medium', basis: 'measured', summary: 'Setting up needs a terminal at /mushi-mushi/admin/onboarding', sessions: [1, 2] }],
  dry_run: false,
  has_account: true,
  counts: { sessions: 3 },
  started_at: '2026-10-27T21:00:00Z',
  finished_at: '2026-10-27T21:20:00Z',
}

const step = (n: number, over: Partial<FreshEyesStep> = {}): FreshEyesStep => ({
  n,
  action: n === 0 ? 'Open https://kensaur.us/mushi-mushi/' : `Click the button "Next ${n}"`,
  path: '/mushi-mushi/',
  screen: '/mushi-mushi/',
  model_ms: 40_000,
  app_ms: 1500,
  read_ms: n === 0 ? 60_000 : 0,
  outcome: 'ok',
  note: null,
  opinion: null,
  backtrack: false,
  dead_end: false,
  requirements: [],
  signals: [],
  shot: `s1-step0${n}.png`,
  ...over,
})

const DETAIL = {
  run: {
    ...RUN,
    timeline: [
      { index: 1, outcome: 'reached', stall: null, ttfv_seconds: 372, app_seconds: 30, read_seconds: 342, model_seconds: 600, backtracks: 1, steps: [step(0), step(1, { backtrack: true, requirements: ['terminal'] })] },
      {
        index: 2,
        outcome: 'stalled',
        stall: { step: 1, screen: '/mushi-mushi/admin/onboarding', reason: 'model_gave_up', detail: 'Did not know which framework to pick.' },
        ttfv_seconds: null,
        app_seconds: 3,
        read_seconds: 60,
        model_seconds: 80,
        backtracks: 0,
        steps: [step(0, { shot: 's2-step00.png' }), step(1, { shot: 's2-step01.png', opinion: { category: 'too_many_choices', why: 'Nine frameworks' } })],
      },
    ],
  },
  shots: { 's1-step00.png': 'https://storage.test/s1-step00.png', 's1-step01.png': 'https://storage.test/s1-step01.png' },
  reports: [{ id: 'rep-1', title: '/mushi-mushi/admin/onboarding: Setting up needs a terminal', status: 'new', severity: 'medium', created_at: '2026-10-27T21:20:00Z' }],
}

const data = (d: unknown) => ({ data: d, loading: false, error: null, reload: vi.fn() })

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.usePageData.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render() {
  act(() => root.render(createElement(MemoryRouter, null, createElement(FreshEyesPanel, { projectId: P }))))
}

describe('FreshEyesPanel', () => {
  it('with no run, gives the exact command to paste', () => {
    mocks.usePageData.mockImplementation((path: string | null) => (path === `/v1/admin/projects/${P}/fresh-eyes` ? data({ runs: [], trend: [] }) : data(null)))
    render()
    expect(host.textContent).toContain('No fresh-eyes runs yet')
    expect(host.querySelector('[data-testid="fresh-eyes-run-now"]')?.textContent).toContain('mushi ux fresh-eyes --url "https://kensaur.us/mushi-mushi/" --goal "get my first bug explained" --mint-account --terminal --sync --file')
  })

  it('leads with time to first value, then each step with its screenshot, the stall and the filed reports', () => {
    mocks.usePageData.mockImplementation((path: string | null) =>
      path === `/v1/admin/projects/${P}/fresh-eyes`
        ? data({ runs: [RUN], trend: [{ metric_name: 'fresh_eyes.ttfv_seconds', dimension: 'a', value: 500, ts: '2026-10-20T00:00:00Z' }, { metric_name: 'fresh_eyes.ttfv_seconds', dimension: 'b', value: 372, ts: '2026-10-27T00:00:00Z' }] })
        : path === `/v1/admin/projects/${P}/fresh-eyes/${RUN.local_run_id}`
          ? data(DETAIL)
          : data(null),
    )
    render()
    expect(host.textContent).toContain('Time to first value')
    expect(host.textContent).toContain('6 min 12 s')
    expect(host.querySelector('[data-testid="fresh-eyes-trend"] svg')).not.toBeNull()
    const timeline = host.querySelector('[data-testid="fresh-eyes-timeline"]')!
    expect(timeline.querySelectorAll('img')).toHaveLength(2)
    expect(timeline.textContent).toContain('Reached the goal in 1 steps')
    expect(timeline.textContent).toContain('Went back · Needs a terminal')
    expect(timeline.textContent).toContain('is not counted')
    expect(host.querySelector('a[href="/reports/rep-1"]')).not.toBeNull()
    // Session 2 stalled: the reason, in plain words.
    const s2 = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Session 2')
    act(() => s2?.click())
    expect(host.querySelector('[data-testid="fresh-eyes-timeline"]')!.textContent).toContain('Did not know what to do next at /mushi-mushi/admin/onboarding, step 1.')
    expect(host.textContent).toContain('Felt too many choices: Nine frameworks')
  })
})

describe('freshEyes helpers', () => {
  it('format durations people read', () => {
    expect(formatSeconds(null)).toBe('not reached')
    expect(formatSeconds(45)).toBe('45 s')
    expect(formatSeconds(360)).toBe('6 min')
    expect(formatSeconds(3780)).toBe('1 h 3 min')
  })

  it('summarize a run in one line', () => {
    expect(runHeadline(RUN as never)).toBe('2 of 3 reached the goal · 6 min 12 s · 11 steps')
    expect(runHeadline({ ...RUN, reached: 0, stalled_at: { screen: '/x', reason: 'signup_wall', sessions: 3 } } as never)).toBe('Stalled at /x: needs an account to go on')
  })

  it('keep the command free of shell tricks and the trend to time only', () => {
    expect(freshEyesCommand({ url: 'https://x.test/$(rm)', goal: 'a "b"', mushi: false })).toBe('mushi ux fresh-eyes --url "https://x.test/(rm)" --goal "a b" --sync --file')
    expect(ttfvTrend([{ metric_name: 'fresh_eyes.steps', dimension: 'a', value: 3, ts: '' }, { metric_name: 'fresh_eyes.ttfv_seconds', dimension: 'a', value: 9, ts: '' }])).toEqual([9])
    expect(stepNotes({ ...step(1), outcome: 'refused', note: 'refused: "Upgrade" reads as destructive' })).toEqual(['refused: "Upgrade" reads as destructive'])
  })
})
