/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/UxRunsPage.pullRequest.test.tsx
 * PURPOSE: The draft PR card on a UX run: hidden until the studio opened a
 *          PR, Merge only when every required check passed, the reason when
 *          it cannot, and a merge only after the in-page confirmation.
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

const RUN_ID = '20261006-011207-qafu'
const RUN = {
  id: 'r1',
  local_run_id: RUN_ID,
  mode: 'local',
  status: 'done',
  agent: 'claude-code',
  model: null,
  judge_model: null,
  branch: `mushi-ux/${RUN_ID}`,
  counts: { accepted: 1 },
  started_at: '2026-10-06T01:12:07Z',
  finished_at: '2026-10-06T01:13:19Z',
  updated_at: '2026-10-06T01:13:19Z',
}
const WITH_PR = { ...RUN, pr_url: 'https://github.com/o/web/pull/42', pr_number: 42, pr_state: null, pr_merged_at: null }

const check = (name: string, conclusion: string | null) => ({
  name,
  status: conclusion ? 'completed' : 'in_progress',
  conclusion,
  url: `https://github.com/o/web/runs/${name}`,
  required: true,
})
const pullRequest = (items: ReturnType<typeof check>[]) => ({
  url: 'https://github.com/o/web/pull/42',
  number: 42,
  title: 'UX run: tidy the home screen',
  state: 'open',
  mergeable: true,
  mergeableState: 'clean',
  baseRef: 'main',
  headRef: `mushi-ux/${RUN_ID}`,
  checks: { required: items.map((i) => i.name), items, passing: true, pending: 0, failing: 0 },
  mergedAt: null,
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

function render(run: typeof RUN | typeof WITH_PR, pr: unknown = null) {
  const reload = vi.fn()
  mocks.usePageData.mockImplementation((path: string | null) => {
    const res = (data: unknown) => ({ data, loading: false, error: null, reload })
    if (path === null) return res(null)
    if (path.endsWith('/ux-runs')) return res({ runs: [run] })
    if (path.endsWith('/pull-request')) return res(pr)
    if (path.endsWith(`/ux-runs/${RUN_ID}`)) return res({ run, surfaces: [], iterations: [] })
    return res(null)
  })
  act(() => root.render(createElement(MemoryRouter, null, createElement(UxRunsPage))))
  return { reload }
}

const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined

describe('UxRunsPage, the run’s pull request', () => {
  it('shows no PR card until the studio opened one, and says how to open one', () => {
    render(RUN)
    expect(button('Merge to')).toBeUndefined()
    expect(mocks.usePageData).not.toHaveBeenCalledWith(expect.stringContaining('/pull-request'))
    expect(host.textContent).toContain(`mushi-ux/${RUN_ID}`)
    expect(host.textContent).toContain('Open draft PR button in the studio')
  })

  it('enables Merge on an open PR whose required checks passed', () => {
    render(WITH_PR, pullRequest([check('build', 'success'), check('test', 'success')]))
    const link = host.querySelector('a[href="https://github.com/o/web/pull/42"]')
    expect(link?.textContent).toContain('PR #42 UX run: tidy the home screen')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(host.textContent).toContain('Open')
    expect(host.querySelector('a[href="https://github.com/o/web/runs/build"]')?.textContent).toBe('build')
    expect(button('Merge to main')?.disabled).toBe(false)
    expect(host.textContent).not.toContain('Kept changes are on')
  })

  it('disables Merge with the reason when a required check is failing', () => {
    render(WITH_PR, pullRequest([check('build', 'success'), check('test', 'failure')]))
    expect(button('Merge to main')?.disabled).toBe(true)
    expect(host.textContent).toContain('Required check failing: test.')
  })

  it('merges with a squash merge only after the in-page confirmation', async () => {
    const { reload } = render(WITH_PR, pullRequest([check('build', 'success')]))
    act(() => button('Merge to main')?.click())
    expect(mocks.apiFetchMutate).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Merge PR #42 into main with a squash merge?')
    expect(host.textContent).toContain('for a mobile app this can start a store release')

    mocks.apiFetchMutate.mockResolvedValueOnce({ ok: true, data: { merged: true, alreadyMerged: false, sha: 'abc123' } })
    await act(async () => {
      button('Confirm merge')?.click()
      await Promise.resolve()
    })
    expect(mocks.apiFetchMutate).toHaveBeenCalledTimes(1)
    expect(mocks.apiFetchMutate).toHaveBeenCalledWith(
      `/v1/admin/projects/${P}/ux-runs/${RUN_ID}/merge`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ method: 'squash' }) }),
    )
    expect(host.textContent).toContain('Merged into main')
    expect(button('Merge to main')).toBeUndefined()
    expect(reload).toHaveBeenCalled()
  })

  it('shows a PR merged earlier with its title and no Merge button', () => {
    const merged = { ...WITH_PR, pr_state: 'merged' as const, pr_merged_at: '2026-10-06T02:00:00Z' }
    render(merged, { ...pullRequest([check('build', 'success')]), state: 'merged', mergedAt: '2026-10-06T02:00:00Z' })
    expect(host.textContent).toContain('PR #42 UX run: tidy the home screen')
    expect(host.textContent).toContain('Merged into main')
    expect(button('Merge to')).toBeUndefined()
    expect(host.textContent).not.toContain('Required checks')
  })

  it('shows the server’s message when GitHub rejects the merge', async () => {
    render(WITH_PR, pullRequest([check('build', 'success')]))
    act(() => button('Merge to main')?.click())
    mocks.apiFetchMutate.mockResolvedValueOnce({ ok: false, error: { code: 'MERGE_REJECTED', message: 'Required status check "test" is failing.' } })
    await act(async () => {
      button('Confirm merge')?.click()
      await Promise.resolve()
    })
    expect(host.textContent).toContain('Required status check "test" is failing.')
  })
})
