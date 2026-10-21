/**
 * @vitest-environment jsdom
 *
 * Review follow-ups (ADR 0032): the status and scoreboard lines, the latest
 * follow-ups, the settings form (key, model from that key's list, daily
 * limit, on/off) for an organization owner or admin, read-only for others.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewFollowupsResponse } from './reviewFollowups'
import { followupKeyLabel, followupRecentLine, followupScoreLine } from './reviewFollowups'

const HIROSE = '2000000b-0000-4000-8000-000000000000'
const SHARED = '2000000a-0000-4000-8000-000000000000'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  data: null as unknown,
  paths: [] as string[],
}))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string) => {
    mocks.paths.push(path)
    if (path.startsWith('/v1/admin/byok/cursor/models')) {
      return {
        data: {
          models: [
            {
              id: 'grok-4.7',
              displayName: 'Grok 4.7',
              parameters: [{ id: 'reasoning_effort', displayName: 'Reasoning effort', values: [{ value: 'high' }, { value: 'xhigh' }] }],
            },
            { id: 'composer-2.5' },
          ],
        },
        loading: false,
        error: null,
        reload: vi.fn(),
      }
    }
    return { data: mocks.data, loading: false, error: null, reload: mocks.reload }
  },
}))

import { ReviewFollowupsSection } from './ReviewFollowupsSection'

const BASE: ReviewFollowupsResponse = {
  available: true,
  organizationId: 'org',
  canManage: true,
  settings: { enabled: true, keyId: null, model: null, dailyLimit: 30 },
  keys: [
    { id: SHARED, label: 'ayako', keyHint: '…a1', scope: 'organization', appName: null, status: 'active' },
    { id: HIROSE, label: 'hirose', keyHint: '…h1', scope: 'project', appName: 'glot.it', status: 'active' },
  ],
  scoreboard: {
    days: 7,
    dispatched: 5,
    inFlight: 0,
    finished: 5,
    completed: 5,
    failed: 0,
    pushed: 4,
    noChange: 1,
    verdictsAfter: { merge: 3, fix_first: 1, hold: 0 },
    awaitingReview: 0,
    conversionRate: 0.75,
    skipped: 0,
  },
  recent: [
    {
      id: 'f1',
      appName: 'glot.it',
      pr_url: 'https://github.com/a/b/pull/1',
      status: 'completed',
      reason: null,
      model: 'grok-4.7',
      findings_count: 2,
      head_sha_before: 'aaaaaaa1',
      head_sha_after: 'bbbbbbb2',
      verdict_after: 'merge',
      created_at: '2026-10-21T00:00:00Z',
    },
    {
      id: 'f2',
      appName: 'yen-yen',
      pr_url: null,
      status: 'queued',
      reason: "The app's auto-fix limit is reached.",
      model: null,
      findings_count: null,
      head_sha_before: 'c',
      head_sha_after: null,
      verdict_after: null,
      created_at: '2026-10-21T00:00:00Z',
    },
  ],
}

const button = (text: string) => {
  const b = Array.from(document.body.querySelectorAll('button')).find((x) => x.textContent?.trim() === text)
  if (!b) throw new Error(`no button "${text}"`)
  return b as HTMLButtonElement
}
function selectByLabel(label: string): HTMLSelectElement {
  const lab = Array.from(document.body.querySelectorAll('label')).find((l) => l.textContent?.includes(label))
  const sel = lab?.querySelector('select') as HTMLSelectElement | null
  if (!sel) throw new Error(`no select "${label}"`)
  return sel
}
function change(el: HTMLSelectElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

describe('ReviewFollowupsSection', () => {
  let container: HTMLDivElement
  let root: Root
  const render = async () => act(async () => root.render(createElement(ReviewFollowupsSection)))
  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    mocks.paths = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('shows the state, the scoreboard and the latest follow-ups', async () => {
    mocks.data = BASE
    await render()
    const text = document.body.textContent ?? ''
    expect(text).toContain("On: up to 30 a day, on the key each app's fixes use.")
    expect(text).toContain('Review follow-ups, last 7 days: 5 sent → 4 pushed, 1 no change → Opus after: 3 merge, 1 fix first, 0 hold (75% fix first → merge)')
    expect(text).toContain('glot.it: pushed bbbbbbb, Opus: merge')
    expect(text).toContain("yen-yen: queued, waiting: The app's auto-fix limit is reached.")
  })

  it('an admin picks the hirose key, a model from its list and a limit', async () => {
    mocks.data = BASE
    await render()
    await act(async () => button('Change review follow-ups').click())
    await act(async () => change(selectByLabel('Cursor key'), HIROSE))
    // The model list is read for the chosen key.
    expect(mocks.paths).toContain(`/v1/admin/byok/cursor/models?keyId=${HIROSE}`)
    await act(async () => change(selectByLabel('Model'), 'grok-4.7'))
    await act(async () => change(selectByLabel('Reasoning effort'), 'xhigh'))
    const limit = Array.from(document.body.querySelectorAll('label'))
      .find((l) => l.textContent?.includes('Follow-ups per day'))
    const input = (limit?.htmlFor ? document.getElementById(limit.htmlFor) : limit?.querySelector('input')) as HTMLInputElement
    await act(async () => change(input, '40'))
    await act(async () => button('Save').click())
    const call = mocks.apiFetch.mock.calls.find(([url]) => url === '/v1/admin/byok/review-followups')!
    expect((call[1] as RequestInit).method).toBe('PATCH')
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      enabled: true,
      keyId: HIROSE,
      model: 'grok-4.7?reasoning_effort=xhigh',
      dailyLimit: 40,
    })
    expect(mocks.reload).toHaveBeenCalled()
    expect(document.body.textContent).toContain('Review follow-ups saved and on.')
  })

  it('says why Mushi turned it off, and shows a refused Cursor request', async () => {
    mocks.data = {
      ...BASE,
      settings: { ...BASE.settings!, enabled: false, offReason: 'The Cursor key chosen for review follow-ups was deleted. Pick a key and turn them on again.' },
      recent: [{ ...BASE.recent![1], status: 'skipped', reason: 'Cursor refused to start the agent.', error: 'Cursor API 422 validation_error: Repository not accessible' }],
    }
    await render()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Off.')
    expect(text).toContain('The Cursor key chosen for review follow-ups was deleted.')
    expect(text).toContain('yen-yen: skipped: Cursor refused to start the agent. (Cursor API 422 validation_error: Repository not accessible)')
  })

  it('a member sees it read-only', async () => {
    mocks.data = { ...BASE, canManage: false }
    await render()
    expect(document.body.textContent).toContain('An organization owner or admin can change review follow-ups.')
    expect(Array.from(document.body.querySelectorAll('button')).length).toBe(0)
  })

  it('renders nothing before the migration or without data', async () => {
    mocks.data = { available: false }
    await render()
    expect(container.textContent).toBe('')
    mocks.data = null
    await render()
    expect(container.textContent).toBe('')
  })
})

describe('reviewFollowups words', () => {
  it('no scoreboard line before anything was sent', () => {
    expect(followupScoreLine(null)).toBeNull()
    expect(followupScoreLine({ ...BASE.scoreboard!, dispatched: 0 })).toBeNull()
  })
  it('labels keys and recent rows', () => {
    expect(followupKeyLabel(BASE.keys![0])).toBe('ayako (shared)')
    expect(followupKeyLabel(BASE.keys![1])).toBe("hirose (glot.it's key)")
    expect(followupKeyLabel({ id: 'u', label: 'kenji', keyHint: null, scope: 'universal', mine: true, appName: null, status: 'active' })).toBe(
      'kenji (your universal key)',
    )
    expect(followupKeyLabel({ id: 'u2', label: 'ayako', keyHint: null, scope: 'universal', appName: null, status: 'active' })).toBe(
      "ayako (an owner's universal key)",
    )
    expect(followupRecentLine({ ...BASE.recent![0], status: 'completed', head_sha_after: 'aaaaaaa1' })).toBe('glot.it: agent finished, no change pushed')
    expect(followupRecentLine({ ...BASE.recent![0], status: 'running', findings_count: 3 })).toBe('glot.it: agent working on 3 findings')
    expect(followupRecentLine({ ...BASE.recent![1], status: 'skipped', reason: 'The pull request is closed or merged.' })).toBe(
      'yen-yen: skipped: The pull request is closed or merged.',
    )
  })
})
