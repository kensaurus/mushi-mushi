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
})
