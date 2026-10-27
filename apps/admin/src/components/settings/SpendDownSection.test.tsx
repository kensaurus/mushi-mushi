/**
 * @vitest-environment jsdom
 *
 * Spend down expiring credits (ADR 0028): the status line, the form, and who
 * may change a shared key (ADR 0023).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpendDownKeyStatus } from './spendDown'

const KEY: SpendDownKeyStatus = {
  id: 'key-1',
  label: 'ayako',
  keyHint: '…a1b2',
  scope: 'organization',
  status: 'active',
  enabled: false,
  creditsExpireAt: null,
  model: null,
  dailyLimit: 10,
  windowDays: 14,
  state: 'off',
  startsAt: null,
  dispatchedToday: 0,
  remainingToday: 0,
  projects: [],
  lastRunAt: null,
  lastSummary: null,
}

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  keys: [] as unknown[],
  followups: null as unknown,
}))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { projectId: 'p', keys: mocks.keys, reviewFollowups: mocks.followups }, loading: false, error: null, reload: mocks.reload }),
}))

import { SpendDownSection } from './SpendDownSection'

const button = (text: string) => {
  const b = Array.from(document.body.querySelectorAll('button')).find((x) => x.textContent?.trim() === text)
  if (!b) throw new Error(`no button "${text}"`)
  return b as HTMLButtonElement
}
function setInput(label: string, value: string) {
  const lab = Array.from(document.body.querySelectorAll('label')).find((l) => l.textContent?.includes(label))
  const input = (lab?.htmlFor ? document.getElementById(lab.htmlFor) : lab?.querySelector('input')) as HTMLInputElement | null
  if (!input) throw new Error(`no input "${label}"`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SpendDownSection', () => {
  let container: HTMLDivElement
  let root: Root
  async function render(canManageShared: boolean) {
    await act(async () =>
      root.render(
        createElement(MemoryRouter, null, createElement(SpendDownSection, { canManageShared, keysToken: 'key-1' })),
      ),
    )
  }
  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('an admin turns it on with a date, a model and a daily limit', async () => {
    mocks.keys = [KEY]
    await render(true)
    expect(document.body.textContent).toContain('Spend-down is off.')
    await act(async () => button('Set up spend-down').click())
    await act(async () => {
      setInput('Credits expire on', '2026-10-31')
      setInput('Model', 'grok-4.7?reasoning_effort=xhigh&context=500k')
      setInput('Fixes per day', '20')
    })
    const box = document.body.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => box.click())
    await act(async () => button('Save').click())
    const call = mocks.apiFetch.mock.calls.find(([url]) => url === '/v1/admin/byok/keys/key-1/spend-down')!
    expect((call[1] as RequestInit).method).toBe('PATCH')
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      enabled: true,
      creditsExpireAt: '2026-10-31',
      model: 'grok-4.7?reasoning_effort=xhigh&context=500k',
      dailyLimit: 20,
      windowDays: 14,
    })
    expect(mocks.reload).toHaveBeenCalled()
    expect(document.body.textContent).toContain('Spend-down saved and on.')
  })

  it('shows what it is doing, and a member cannot change a shared key', async () => {
    mocks.keys = [
      {
        ...KEY,
        enabled: true,
        state: 'active',
        creditsExpireAt: '2026-10-31T23:59:59Z',
        dispatchedToday: 4,
        projects: [{ id: 'p1', name: 'tsumagoi' }],
        lastSummary: { projects: [{ projectId: 'p1', dispatched: 0, stopped: 'No open report to fix' }] },
      },
    ]
    await render(false)
    expect(document.body.textContent).toContain('Spending down: 4 of 10 fixes today')
    expect(document.body.textContent).toContain('tsumagoi: No open report to fix')
    expect(document.body.textContent).toContain('An owner or admin can change it')
    expect(Array.from(document.body.querySelectorAll('button')).some((b) => b.textContent?.includes('spend-down'))).toBe(false)
  })

  it('shows the 7-day scoreboard and each paused app with its reason', async () => {
    mocks.keys = [
      {
        ...KEY,
        enabled: true,
        state: 'active',
        creditsExpireAt: '2026-10-31T23:59:59Z',
        projects: [
          {
            id: 'p1',
            name: 'tsumagoi',
            canResume: true,
            stopLoss: {
              paused: true,
              reason: 'Paused: 3 of the last 20 reviewed fixes were mergeable (15%)',
              reviewed: 20,
              mergeRate: 0.15,
              holdRate: 0.2,
              finishedRuns: 20,
              noPrShare: 0.1,
            },
          },
        ],
        scoreboard: {
          days: 7,
          totals: {
            runs: 258,
            inFlight: 0,
            prsOpened: 154,
            noPrVerdicts: 64,
            otherFailures: 40,
            reviewed: 66,
            verdicts: { merge: 19, fix_first: 33, hold: 14 },
            merged: 0,
            latestReviewCostUsd: 8.04,
            mergeYield: 0,
            mergeableYield: 0.07,
          },
        },
      },
    ]
    await render(true)
    expect(document.body.textContent).toContain(
      'Last 7 days: 258 runs → 154 PRs → 19 mergeable, 0 merged · Opus review $8.04 (latest review per PR)',
    )
    expect(document.body.textContent).toContain('tsumagoi: Paused: 3 of the last 20 reviewed fixes were mergeable (15%)')
    expect(document.body.textContent).toContain('probing 1/day')
    await act(async () => button('Resume').click())
    const call = mocks.apiFetch.mock.calls.find(([url]) => url === '/v1/admin/byok/spend-down/projects/p1/resume')!
    expect((call[1] as RequestInit).method).toBe('POST')
    expect(mocks.reload).toHaveBeenCalled()
    expect(document.body.textContent).toContain('Resumed.')
  })

  it('shows Resume only to the app owner or admin', async () => {
    const stopLoss = { paused: true, reason: 'Paused: x', reviewed: 20, mergeRate: 0, holdRate: 0, finishedRuns: 20, noPrShare: 0 }
    mocks.keys = [{ ...KEY, enabled: true, state: 'active', projects: [{ id: 'p1', name: 'tsumagoi', canResume: false, stopLoss }] }]
    await render(true)
    expect(document.body.textContent).toContain('tsumagoi: Paused: x')
    expect(document.body.textContent).toContain('probing 1/day')
    expect(Array.from(document.body.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Resume')).toBe(false)
  })

  it('says when the scoreboard or the app list could not be read', async () => {
    mocks.keys = [{ ...KEY, projectsNote: 'The apps this key pays for could not be read just now.', scoreboard: null, scoreboardNote: 'The last 7 days could not be read just now.' }]
    await render(true)
    expect(document.body.textContent).toContain('The apps this key pays for could not be read just now.')
  })

  it('says when the scoreboard could not be read', async () => {
    mocks.keys = [{ ...KEY, scoreboard: null, scoreboardNote: 'The last 7 days could not be read just now.' }]
    await render(true)
    expect(document.body.textContent).toContain('The last 7 days could not be read just now.')
  })

  it('shows what review follow-ups made of fix-first PRs (ADR 0032)', async () => {
    mocks.keys = [KEY]
    mocks.followups = {
      days: 7,
      dispatched: 12,
      inFlight: 1,
      finished: 11,
      completed: 10,
      failed: 1,
      pushed: 9,
      noChange: 2,
      verdictsAfter: { merge: 4, fix_first: 3, hold: 1 },
      awaitingReview: 1,
      conversionRate: 0.5,
      skipped: 3,
    }
    await render(true)
    expect(document.body.textContent).toContain(
      'Review follow-ups, last 7 days: 12 sent → 9 pushed, 2 no change, 1 running → Opus after: 4 merge, 3 fix first, 1 hold (50% fix first → merge), 1 awaiting review',
    )
    mocks.followups = null
  })

  it('says when every app is out of work, and links to where new work comes from', async () => {
    mocks.keys = [
      {
        ...KEY,
        enabled: true,
        state: 'active',
        dispatchedToday: 0,
        projects: [{ id: 'p1', name: 'glot.it' }],
        lastSummary: { dispatched: 0, projects: [{ projectId: 'p1', dispatched: 0, stopped: 'No open report to fix' }] },
      },
    ]
    await render(true)
    expect(document.body.textContent).toContain('Nothing left to send')
    const hrefs = Array.from(document.body.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/credits', '/reports', '/inventory?tab=discovery', '/qa-coverage'])
  })

  it('renders nothing when the app has no Cursor key', async () => {
    mocks.keys = []
    await render(true)
    expect(container.textContent).toBe('')
  })
})
