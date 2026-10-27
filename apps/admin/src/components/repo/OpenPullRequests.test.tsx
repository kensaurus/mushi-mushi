/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/repo/OpenPullRequests.test.tsx
 * PURPOSE: The Pull requests page's open-PR list: Merge only when every
 *          required check passed, the reason when it cannot, and a merge only
 *          after the in-page confirmation.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P = '1000000f-0000-4000-8000-000000000000'
const mocks = vi.hoisted(() => ({ usePageData: vi.fn(), apiFetchMutate: vi.fn() }))
vi.mock('../../lib/usePageData', () => ({ usePageData: mocks.usePageData }))
vi.mock('../../lib/supabase', () => ({ apiFetchMutate: mocks.apiFetchMutate }))

import { OpenPullRequests, openPrMergeBlocker } from './OpenPullRequests'

const check = (name: string, conclusion: string | null) => ({
  name,
  status: conclusion ? 'completed' : 'in_progress',
  conclusion,
  url: null,
  required: true,
})
const pr = (number: number, items: ReturnType<typeof check>[]) => ({
  repo: 'o/web',
  number,
  title: `Release ${number}`,
  url: `https://github.com/o/web/pull/${number}`,
  draft: false,
  author: 'kenji',
  headRef: `release/${number}`,
  baseRef: 'main',
  updatedAt: '2026-10-08T01:00:00Z',
  checks: { required: items.map((i) => i.name), items, passing: true, pending: 0, failing: 0 },
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.apiFetchMutate.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(pullRequests: unknown[]) {
  const reload = vi.fn()
  mocks.usePageData.mockReturnValue({ data: { pullRequests, repos: ['o/web'] }, loading: false, error: null, reload })
  act(() => root.render(createElement(OpenPullRequests, { projectId: P })))
  return { reload }
}

const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)

describe('openPrMergeBlocker', () => {
  it('names the failing or pending required check', () => {
    expect(openPrMergeBlocker(pr(1, [check('gate', 'failure')]))).toBe('Required check failing: gate.')
    expect(openPrMergeBlocker(pr(1, [check('gate', null)]))).toBe('Waiting for gate.')
    expect(openPrMergeBlocker(pr(1, [check('gate', 'success')]))).toBeNull()
  })
})

describe('OpenPullRequests', () => {
  it('merges only after the confirmation, with the chosen method', async () => {
    const { reload } = render([pr(7, [check('gate', 'success')])])
    expect(host.textContent).toContain('all 1 required checks passed')
    act(() => button('Merge')?.click())
    expect(mocks.apiFetchMutate).not.toHaveBeenCalled()
    mocks.apiFetchMutate.mockResolvedValueOnce({ ok: true, data: { merged: true, alreadyMerged: false } })
    await act(async () => {
      button('Confirm merge')?.click()
      await Promise.resolve()
    })
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/projects/${P}/pull-requests/o/web/7/merge`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ method: 'squash' }) }),
    )
    expect(reload).toHaveBeenCalled()
    expect(host.textContent).toContain('Merged')
  })

  it('keeps Merge off while a required check fails', () => {
    render([pr(8, [check('gate', 'failure')])])
    expect(button('Merge')?.disabled).toBe(true)
    expect(host.textContent).toContain('Required check failing: gate.')
  })

  it('confirms a merge while the fix PR\'s first review is still running', async () => {
    render([{ ...pr(11, [check('gate', 'success')]), review: { state: 'queued', label: 'Review in progress', fixId: null, verdict: null } }])
    act(() => button('Merge')?.click())
    expect(host.textContent).toContain('Its Opus review is still running; merging now skips it.')
    mocks.apiFetchMutate.mockResolvedValueOnce({ ok: true, data: { merged: true, alreadyMerged: false } })
    await act(async () => {
      button('Confirm merge')?.click()
      await Promise.resolve()
    })
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/projects/${P}/pull-requests/o/web/11/merge`,
      expect.objectContaining({ body: JSON.stringify({ method: 'squash', confirmPendingReview: true }) }),
    )
  })

  it('confirms when ANY linked review is pending, even if the one shown has a verdict', async () => {
    render([{ ...pr(12, [check('gate', 'success')]), review: { state: 'merge', label: 'Opus review: merge', fixId: null, verdict: 'merge', pending: true } }])
    act(() => button('Merge')?.click())
    expect(host.textContent).toContain('Its Opus review is still running; merging now skips it.')
    mocks.apiFetchMutate.mockResolvedValueOnce({ ok: true, data: { merged: true, alreadyMerged: false } })
    await act(async () => {
      button('Confirm merge')?.click()
      await Promise.resolve()
    })
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/projects/${P}/pull-requests/o/web/12/merge`,
      expect.objectContaining({ body: JSON.stringify({ method: 'squash', confirmPendingReview: true }) }),
    )
  })

  // ADR 0030: a Mushi fix PR shows its Opus review; a hold blocks Merge here.
  it('shows the review of a fix PR and keeps Merge off for a hold', () => {
    const held = { ...pr(9, [check('gate', 'success')]), review: { state: 'hold', label: 'Opus review: hold', fixId: null, verdict: 'hold' } }
    expect(openPrMergeBlocker(held as never)).toBe('The Opus review says hold: open the fix to read the findings.')
    render([held, { ...pr(10, [check('gate', 'success')]), review: { state: 'merge', label: 'Opus review: merge', fixId: null, verdict: 'merge' } }])
    expect(host.textContent).toContain('Opus review: hold')
    expect(host.textContent).toContain('Opus review: merge')
    const mergeIn = (group: string) => [...host.querySelectorAll(`[data-testid="open-prs-${group}"] button`)].find((b) => b.textContent?.trim() === 'Merge') as HTMLButtonElement
    expect(mergeIn('hold').disabled).toBe(true)
    expect(mergeIn('mergeable').disabled).toBe(false)
  })

  it('groups PRs by what can be done: mergeable first, then needs a fix, hold, waiting', () => {
    const review = (state: string, verdict: string | null) => ({ state, label: `Opus review: ${state}`, fixId: null, verdict })
    render([
      { ...pr(1, [check('gate', 'success')]), review: review('hold', 'hold') },
      { ...pr(2, [check('gate', 'failure')]) },
      { ...pr(3, [check('gate', null)]) },
      { ...pr(4, [check('gate', 'success')]), review: review('merge', 'merge') },
      { ...pr(5, [check('gate', 'success')]), review: review('fix_first', 'fix_first') },
      { ...pr(6, [check('gate', 'success')]), review: review('stale', 'merge') },
      { ...pr(13, [check('gate', 'success')]) },
    ])
    const groups = [...host.querySelectorAll('[data-testid^="open-prs-"]')].map((g) => g.getAttribute('data-testid'))
    expect(groups).toEqual(['open-prs-mergeable', 'open-prs-needs_fix', 'open-prs-hold', 'open-prs-waiting'])
    const numbers = (group: string) => [...host.querySelectorAll(`[data-testid="open-prs-${group}"] a[href*="/pull/"]`)].map((a) => a.getAttribute('href')!.split('/').pop())
    expect(numbers('mergeable')).toEqual(['4', '13'])
    expect(numbers('needs_fix')).toEqual(['2', '5'])
    expect(numbers('hold')).toEqual(['1'])
    // A review of an older commit is not a "merge" yet; CI still running waits too.
    expect(numbers('waiting')).toEqual(['3', '6'])
  })
})
