/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/ux-runs/FreshEyesPanel.test.tsx
 * PURPOSE: The First-time user test (fresh-eyes runs, ADR 0053 and its
 *          2026-10-28 amendment):
 *            - Run now starts from the app's own address and a plain goal (an
 *              app with no runs never gets Mushi's landing, goal or
 *              `--mint-account`), and posts one request;
 *            - with no computer that can run it, it says so in plain words
 *              with one setup action, and Run now is off;
 *            - test accounts are offered only when the server says they work;
 *            - a waiting test can be cancelled; a failed one says why;
 *            - a finished test leads with time to first value, then each step
 *              with its screenshot, the stall and the filed reports.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P = '1000000f-0000-4000-8000-000000000000'
const LIST = `/v1/admin/projects/${P}/fresh-eyes`
const mocks = vi.hoisted(() => ({ usePageData: vi.fn(), calls: [] as Array<{ path: string; method: string; body: unknown }>, reply: null as unknown }))
vi.mock('../../lib/usePageData', () => ({ usePageData: mocks.usePageData }))
vi.mock('../../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: async (path: string, opts: { method?: string; body?: string } = {}) => {
    mocks.calls.push({ path, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    return mocks.reply ?? { ok: true, data: { runId: '20261028-090000-ab12', runner: { state: 'ready', hostname: 'alienware', lastSeenAt: null } } }
  },
}))

import { FreshEyesPanel } from './FreshEyesPanel'
import { formatSeconds, isStartUrl, runHeadline, runnerMessage, stepNotes, ttfvTrend, type FreshEyesStep } from '../../lib/freshEyes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

const READY = { state: 'ready', hostname: 'alienware', lastSeenAt: '2026-10-28T08:59:00Z' }
const GLOT = { runs: [], trend: [], defaults: { url: 'https://glot.it/', urlSource: 'site_watch', goal: 'sign up and start using the app', sessions: 3 }, canUseTestAccount: false, runner: READY }

const data = (d: unknown) => ({ data: d, loading: false, error: null, reload: vi.fn() })

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.usePageData.mockReset()
  mocks.calls = []
  mocks.reply = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(list: unknown, detail: Record<string, unknown> = {}) {
  mocks.usePageData.mockImplementation((path: string | null) => (path === LIST ? data(list) : path && detail[path] ? data(detail[path]) : data(null)))
  act(() => root.render(createElement(MemoryRouter, null, createElement(FreshEyesPanel, { projectId: P }))))
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const field = (label: string) => [...host.querySelectorAll('label')].find((l) => l.textContent?.includes(label))?.querySelector('input') as HTMLInputElement

describe('Run now', () => {
  it("starts from the app's own address and a plain goal: never Mushi's landing, goal or --mint-account", () => {
    render(GLOT)
    expect(field('Start page').value).toBe('https://glot.it/')
    expect(field('What a new visitor came to do').value).toBe('sign up and start using the app')
    const text = host.textContent ?? ''
    expect(text).not.toContain('kensaur.us/mushi-mushi')
    expect(text).not.toContain('--mint-account')
    expect(text).not.toContain('get my first bug explained')
    expect(text).not.toMatch(/not built yet/i)
    expect(button('Sign up with test accounts')).toBeUndefined()
    // One place says how to start; the empty list says what will show.
    expect(text).toContain('No tests yet')
    expect(text.match(/Run now/g)).toHaveLength(1)
  })

  it('posts one request and shows that it started', async () => {
    render(GLOT)
    await act(async () => button('Run now')!.click())
    expect(mocks.calls).toEqual([
      { path: LIST, method: 'POST', body: { url: 'https://glot.it/', goal: 'sign up and start using the app', sessions: 3, successText: null, dryRun: true, withAccount: false } },
    ])
    expect(host.textContent).toContain('Started.')
  })

  it('files what stops them when asked, with the words that mean done', async () => {
    render(GLOT)
    act(() => button('File what stops them')!.click())
    const done = field('Done when the page shows')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(done, 'Your lessons')
      done.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('Run now')!.click())
    expect(mocks.calls[0]!.body).toMatchObject({ dryRun: false, withAccount: false, successText: 'Your lessons' })
  })

  it('offers test accounts only when the server says they work', async () => {
    render({ ...GLOT, canUseTestAccount: true, defaults: { url: 'https://kensaur.us/mushi-mushi/', urlSource: 'mushi', goal: 'get my first bug explained', sessions: 3 } })
    act(() => button('Sign up with test accounts')!.click())
    await act(async () => button('Run now')!.click())
    expect(mocks.calls[0]!.body).toMatchObject({ url: 'https://kensaur.us/mushi-mushi/', withAccount: true, dryRun: false })
  })

  it('with no computer of yours, says so with one setup action, and Run now is off', () => {
    render({ ...GLOT, runner: { state: 'none', hostname: null, lastSeenAt: null } })
    expect(host.querySelector('[data-testid="fresh-eyes-runner"]')!.textContent).toContain('Set up Mushi on your computer once')
    expect(host.textContent).toContain('mushi worker install')
    expect(host.querySelector('a[href="/pipeline?tab=workers"]')).not.toBeNull()
    expect(button('Run now')!.disabled).toBe(true)
  })

  it('names an old or offline computer and what to do', () => {
    render({ ...GLOT, runner: { state: 'outdated', hostname: 'alienware', lastSeenAt: null } })
    expect(host.textContent).toContain('The Mushi on alienware is too old')
    expect(button('Run now')!.disabled).toBe(true)
  })

  it("shows the server's refusal in plain words", async () => {
    mocks.reply = { ok: false, error: { code: 'NO_WORKER', message: 'Your computer alienware is not online, so nothing can run the test.' } }
    render(GLOT)
    await act(async () => button('Run now')!.click())
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('alienware is not online')
  })
})

describe('tests in the list', () => {
  const QUEUED = { ...RUN, local_run_id: '20261028-090000-ab12', status: 'queued', ttfv_seconds: null, steps: null, reached: null, stalled_at: null, findings: null, counts: { sessions: 3 }, dry_run: true, finished_at: null }

  it('a waiting test says so and can be cancelled', async () => {
    render({ ...GLOT, runs: [QUEUED] }, { [`${LIST}/${QUEUED.local_run_id}`]: { run: { ...QUEUED, timeline: null }, shots: {}, reports: [] } })
    expect(host.textContent).toContain('Waiting for your computer')
    expect(host.querySelector('[data-testid="fresh-eyes-run-state"]')!.textContent).toContain('Waiting for alienware to start it')
    await act(async () => button('Cancel')!.click())
    expect(mocks.calls).toEqual([{ path: `${LIST}/${QUEUED.local_run_id}/cancel`, method: 'POST', body: null }])
  })

  it('a look-around test shows in the list but never drives the numbers', () => {
    const look = { ...RUN, local_run_id: '20261028-100000-cd34', dry_run: true, reached: 0, ttfv_seconds: null, steps: 30 }
    render({ ...GLOT, runs: [look] }, { [`${LIST}/${look.local_run_id}`]: { run: { ...look, timeline: [] }, shots: {}, reports: [] } })
    expect(host.textContent).not.toContain('Time to first value')
    expect(host.textContent).toContain('Look around')
    render({ ...GLOT, runs: [look, RUN] }, { [`${LIST}/${look.local_run_id}`]: { run: { ...look, timeline: [] }, shots: {}, reports: [] } })
    expect(host.textContent).toContain('6 min 12 s')
  })

  it('a failed test says why', () => {
    const failed = { ...QUEUED, status: 'failed', counts: null, detail: 'mushi-ux could not start on this computer: spawn npx ENOENT' }
    render({ ...GLOT, runs: [failed] }, { [`${LIST}/${failed.local_run_id}`]: { run: { ...failed, timeline: null }, shots: {}, reports: [] } })
    expect(host.querySelector('[data-testid="fresh-eyes-run-state"]')!.textContent).toBe('It failed: mushi-ux could not start on this computer: spawn npx ENOENT')
  })

  it('a finished test leads with time to first value, then each step with its screenshot, the stall and the filed reports', () => {
    render(
      { ...GLOT, runs: [RUN], trend: [{ metric_name: 'fresh_eyes.ttfv_seconds', dimension: 'a', value: 500, ts: '2026-10-20T00:00:00Z' }, { metric_name: 'fresh_eyes.ttfv_seconds', dimension: 'b', value: 372, ts: '2026-10-27T00:00:00Z' }] },
      { [`${LIST}/${RUN.local_run_id}`]: DETAIL },
    )
    expect(host.textContent).toContain('Time to first value')
    expect(host.textContent).toContain('6 min 12 s')
    expect(host.querySelector('[data-testid="fresh-eyes-trend"] svg')).not.toBeNull()
    const timeline = host.querySelector('[data-testid="fresh-eyes-timeline"]')!
    expect(timeline.querySelectorAll('img')).toHaveLength(2)
    expect(timeline.textContent).toContain('Reached the goal in 1 steps')
    expect(timeline.textContent).toContain('Went back · Needs a terminal')
    expect(timeline.textContent).toContain('is not counted')
    expect(host.querySelector('a[href="/reports/rep-1"]')).not.toBeNull()
    act(() => button('Visitor 2')!.click())
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

  it('summarize a test in one line, waiting and stopped ones too', () => {
    expect(runHeadline(RUN as never)).toBe('2 of 3 reached the goal · 6 min 12 s · 11 steps')
    expect(runHeadline({ ...RUN, reached: 0, stalled_at: { screen: '/x', reason: 'signup_wall', sessions: 3 } } as never)).toBe('Stalled at /x: needs an account to go on')
    expect(runHeadline({ ...RUN, status: 'queued' } as never)).toBe('Waiting for your computer')
    expect(runHeadline({ ...RUN, status: 'stopped', detail: 'Cancelled before a computer started it.' } as never)).toBe('Cancelled before a computer started it.')
  })

  it('say what a computer can do in plain words', () => {
    const now = Date.parse('2026-10-28T12:00:00Z')
    expect(runnerMessage({ state: 'offline', hostname: 'alienware', lastSeenAt: '2026-10-28T09:00:00Z' }, now)).toMatchObject({ canRun: false, setup: 'workers', text: expect.stringContaining('alienware is offline (last seen 3 h ago)') })
    expect(runnerMessage({ state: 'busy', hostname: 'alienware', lastSeenAt: null }, now)).toMatchObject({ canRun: true })
    expect(runnerMessage(null, now)).toMatchObject({ canRun: true, setup: null })
    expect(runnerMessage({ state: 'paused', hostname: 'alienware', lastSeenAt: null }, now).setup).toBe('workers')
  })

  it('take only http(s) start pages and keep the trend to time', () => {
    expect(isStartUrl('https://glot.it')).toBe(true)
    expect(isStartUrl('javascript:alert(1)')).toBe(false)
    expect(isStartUrl('https://u:p@glot.it')).toBe(false)
    expect(ttfvTrend([{ metric_name: 'fresh_eyes.steps', dimension: 'a', value: 3, ts: '' }, { metric_name: 'fresh_eyes.ttfv_seconds', dimension: 'a', value: 9, ts: '' }])).toEqual([9])
    expect(stepNotes({ ...step(1), outcome: 'refused', note: 'refused: "Upgrade" reads as destructive' })).toEqual(['refused: "Upgrade" reads as destructive'])
  })
})
