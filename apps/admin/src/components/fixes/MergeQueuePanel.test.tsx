/**
 * @vitest-environment jsdom
 *
 * Merge when ready rows (ADR 0041): a long owner/repo ref must wrap, and the
 * reason must keep a content-sized flex basis. flex-1 (basis 0%) stays on the
 * ref's line and collapses the reason on a 390px row.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MergeQueueRow, ReleaseTrain } from '../../lib/mergeQueue'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))

import { MergeQueuePanel } from './MergeQueuePanel'

const REPO = 'kensaurus/solo-boss-cloud-documentation'
const PR = 789
const TRAIN_PR = 790
const MERGED_PR = 791
const REASON = 'Branch is behind its base after the previous merge.'

function row(partial: Pick<MergeQueueRow, 'id' | 'state' | 'pr_number'> & Partial<MergeQueueRow>): MergeQueueRow {
  return {
    fix_attempt_id: partial.id,
    project_id: 'proj-1',
    repo: REPO,
    detail: REASON,
    head_sha: null,
    queued_at: '2026-10-24T00:00:00Z',
    updated_at: '2026-10-24T01:00:00Z',
    merged_at: partial.state === 'merged' ? '2026-10-24T02:00:00Z' : null,
    conflict_agents: 0,
    ...partial,
  }
}

const TRAIN: ReleaseTrain = {
  id: 'train-1',
  project_id: 'proj-1',
  repo: REPO,
  pr_number: TRAIN_PR,
  state: 'testing',
  members: [PR],
  attempt: 1,
  detail: 'CI running',
  created_at: '2026-10-24T00:00:00Z',
  updated_at: '2026-10-24T01:00:00Z',
  merged_at: null,
}

function refHref(pr: number) {
  return `https://github.com/${REPO}/pull/${pr}`
}

describe('MergeQueuePanel narrow rows', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      data: {
        rows: [
          row({ id: 'held', state: 'blocked', pr_number: PR }),
          row({ id: 'done', state: 'merged', pr_number: MERGED_PR, detail: null }),
        ],
        trains: [TRAIN],
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('wraps a long repo ref and does not give the reason a zero flex basis', async () => {
    await act(async () => {
      root.render(createElement(MergeQueuePanel, { projectId: 'proj-1', refreshKey: 0 }))
    })

    const link = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(PR)}"]`)
    expect(link?.textContent).toBe(`${REPO}#${PR}`)
    expect(link?.className).toContain('wrap-anywhere')
    expect(link?.className).toContain('min-w-0')
    expect(link?.className).toContain('max-w-full')

    const queueRow = link?.closest('li')
    expect(queueRow?.className).toContain('flex-wrap')
    const reason = queueRow?.querySelector('span.flex-auto')
    expect(reason?.textContent).toContain(REASON)
    expect(reason?.className).toContain('wrap-break-word')
    expect(reason?.className.split(/\s+/)).not.toContain('flex-1')

    const train = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(TRAIN_PR)}"]`)
    expect(train?.textContent).toBe(`${REPO}#${TRAIN_PR}`)
    expect(train?.className).toContain('wrap-anywhere')
    expect(train?.className).toContain('min-w-0')

    const showMerged = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('merged today'))
    expect(showMerged).toBeTruthy()
    await act(async () => showMerged!.click())
    const merged = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(MERGED_PR)}"]`)
    expect(merged?.textContent).toBe(`${REPO}#${MERGED_PR}`)
    expect(merged?.className).toContain('wrap-anywhere')
  })
})
