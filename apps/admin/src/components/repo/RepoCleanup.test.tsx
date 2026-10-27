/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/repo/RepoCleanup.test.tsx
 * PURPOSE: Repo → Clean up (ADR 0051): the list says why and at which commit,
 *          the race is stated, asking sends only the chosen keys, an owner or
 *          admin approves with the hash shown and runs only after the
 *          confirmation, others cannot decide, each item's result shows.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P = '1000000f-0000-4000-8000-000000000000'
const mocks = vi.hoisted(() => ({ usePageData: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/usePageData', () => ({ usePageData: mocks.usePageData }))
vi.mock('../../lib/supabase', () => ({ apiFetchMutate: mocks.apiFetchMutate }))

import { RepoCleanup } from './RepoCleanup'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

function view(over: Record<string, unknown> = {}) {
  return {
    projectId: P,
    staleDays: 14,
    repos: [
      {
        repo: 'o/web',
        error: null,
        defaultBranch: 'main',
        deleteBranchOnMerge: false,
        canChangeSetting: true,
        settingPending: false,
        branches: [
          { key: 'branch:mushi/fix-1', branch: 'mushi/fix-1', headSha: A, prNumber: 1, prState: 'merged', closedAt: null, reason: 'Pull request #1 was merged on 2026-10-20; the branch still points at its last commit.' },
          { key: 'branch:mushi/fix-2', branch: 'mushi/fix-2', headSha: B, prNumber: 2, prState: 'closed', closedAt: null, reason: 'Pull request #2 was closed without merging.' },
        ],
        prs: [{ key: 'pr:5', prNumber: 5, headSha: A, branch: 'mushi/fix-5', fixAttemptId: 'f5', reportId: 'r5', why: ['superseded'], reason: 'Close #5: a newer fix for the same report is open as #6.', draft: false }],
        kept: [{ key: 'branch:mushi/fix-9', reason: 'It is the head of open pull request #9.' }],
        keptCount: 1,
        gone: 0,
        truncated: false,
      },
    ],
    actions: [],
    restorable: [],
    migrationPending: false,
    canDecide: true,
    canRequest: true,
    limits: { maxItems: 50, perHour: 5, approvalMinutes: 60 },
    raceNote: 'Mushi asks GitHub to delete a branch only if it still points at the commit shown. A push in that second could be lost.',
    ...over,
  }
}

const pending = (status: string, extra: Record<string, unknown> = {}) => ({
  id: '4000000a-0000-4000-8000-000000000000',
  action: 'delete_branches',
  repo: 'o/web',
  itemCount: 1,
  payload: { items: [{ key: 'branch:mushi/fix-1', branch: 'mushi/fix-1', headSha: A }] },
  payloadSha256: 'f'.repeat(64),
  reason: null,
  status,
  requestedBy: 'user:u1',
  requestedAt: '2026-10-27T11:00:00Z',
  expiresAt: status === 'approved' ? '2026-10-27T12:30:00Z' : null,
  executedAt: null,
  result: null,
  error: null,
  ...extra,
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.apiFetchMutate.mockReset()
  mocks.apiFetchMutate.mockResolvedValue({ ok: true, data: {} })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(data: unknown) {
  const reload = vi.fn()
  mocks.usePageData.mockReturnValue({ data, loading: false, error: null, reload })
  act(() => root.render(createElement(RepoCleanup, { projectId: P })))
  return { reload }
}

const button = (text: RegExp) => [...host.querySelectorAll('button')].find((b) => text.test(b.textContent ?? '')) as HTMLButtonElement | undefined

describe('RepoCleanup', () => {
  it('shows each item with its reason and commit, the race note and what was kept', () => {
    render(view())
    const text = host.textContent ?? ''
    expect(text).toContain('mushi/fix-1 at aaaaaaa')
    expect(text).toContain('Pull request #1 was merged on 2026-10-20')
    expect(text).toContain('A push in that second could be lost')
    expect(text).toContain('Replaced by a newer fix')
    expect(text).toContain('Kept, and why')
    expect(text).toContain('Ask to turn it on')
  })

  it('asks for exactly the chosen branches; nothing runs from that click', async () => {
    render(view())
    const box = [...host.querySelectorAll('input[type="checkbox"]')][1] as HTMLInputElement
    await act(async () => box.click())
    await act(async () => button(/Ask to delete 1 branch/)!.click())
    expect(mocks.apiFetchMutate).toHaveBeenCalledTimes(1)
    const [url, init] = mocks.apiFetchMutate.mock.calls[0]
    expect(url).toBe(`/v1/admin/projects/${P}/repo-cleanup/requests`)
    expect(JSON.parse(init.body)).toEqual({ action: 'delete_branches', repo: 'o/web', keys: ['branch:mushi/fix-1'] })
  })

  it('an owner approves with the hash shown, and runs only after the confirmation', async () => {
    render(view({ actions: [pending('pending_approval')] }))
    await act(async () => button(/Approve this list/)!.click())
    expect(mocks.apiFetchMutate.mock.calls[0][0]).toBe(`/v1/admin/projects/${P}/repo-cleanup/requests/4000000a-0000-4000-8000-000000000000/approve`)
    expect(JSON.parse(mocks.apiFetchMutate.mock.calls[0][1].body)).toEqual({ payloadSha256: 'f'.repeat(64) })

    mocks.apiFetchMutate.mockClear()
    render(view({ actions: [pending('approved')] }))
    await act(async () => button(/^Run now$/)!.click())
    expect(mocks.apiFetchMutate).not.toHaveBeenCalled()
    expect(host.ownerDocument.body.textContent).toContain('checks each item again first')
    const confirm = [...host.ownerDocument.querySelectorAll('button')].filter((b) => b.textContent === 'Run now').pop()!
    await act(async () => confirm.click())
    expect(mocks.apiFetchMutate.mock.calls[0][0]).toMatch(/\/requests\/4000000a-0000-4000-8000-000000000000\/execute$/)
  })

  it('people who are not owners or admins see who decides, not the buttons', () => {
    render(view({ canDecide: false, actions: [pending('pending_approval')] }))
    expect(button(/Approve this list/)).toBeUndefined()
    expect(host.textContent).toContain('An owner or admin of the team decides.')
  })

  it('shows each item’s result after a run', async () => {
    render(view({ actions: [pending('executed', { result: { items: [{ key: 'branch:mushi/fix-1', branch: 'mushi/fix-1', outcome: 'refused', detail: 'It moved to eeeeeee after the list was approved.' }] } })] }))
    await act(async () => button(/Recent clean-ups/)!.click())
    expect(host.textContent).toContain('Refused')
    expect(host.textContent).toContain('It moved to eeeeeee after the list was approved.')
  })

  it('with more candidates than one clean-up takes, ticks the first 50 and says so', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ key: `branch:b${i}`, branch: `b${i}`, headSha: A, prNumber: i + 1, prState: 'merged', closedAt: null, reason: 'merged' }))
    const v = view()
    v.repos[0].branches = many as never
    render(v)
    const ask = button(/Ask to delete 50 branches/)
    expect(ask?.disabled).toBe(false)
    expect(host.textContent).toContain('At most 50 go in one clean-up; the first 50 are ticked.')
    await act(async () => ask!.click())
    expect(JSON.parse(mocks.apiFetchMutate.mock.calls[0][1].body).keys).toHaveLength(50)
  })

  it('reads again while a clean-up is running', () => {
    vi.useFakeTimers()
    try {
      const { reload } = render(view({ actions: [pending('executing')] }))
      act(() => { vi.advanceTimersByTime(5000) })
      expect(reload).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a missing database update is said plainly', () => {
    render(view({ migrationPending: true }))
    expect(host.textContent).toContain('20261027183000_repo_housekeeping_items')
  })
})
