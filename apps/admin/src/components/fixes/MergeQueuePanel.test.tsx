/**
 * @vitest-environment jsdom
 *
 * Merge when ready rows (ADR 0041): the visible ref is #N (or the repo name
 * without the owner when a train has no PR). The full owner/repo#N is the
 * title. jsdom cannot measure 390px overflow; that check is the Playwright
 * spec examples/e2e-dogfood/tests/merge-queue-panel-overflow.spec.ts.
 * The reason keeps a content-sized flex basis. flex-1 (basis 0%) stays on
 * the ref's line and collapses the reason.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MergeQueueRow, ReleaseTrain } from '../../lib/mergeQueue'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))

import { MergeQueuePanel } from './MergeQueuePanel'

const REPO = 'kensaurus/solo-boss-cloud-documentation'
const BARE_REPO = 'acme/widget-docs'
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

/** A moving train with no PR number yet: the row shows the repo, not #N. */
const BARE_TRAIN: ReleaseTrain = {
  ...TRAIN,
  id: 'train-bare',
  repo: BARE_REPO,
  pr_number: null,
  members: [1],
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
        trains: [TRAIN, BARE_TRAIN],
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
    expect(link?.textContent).toBe(`#${PR}`)
    expect(link?.getAttribute('title')).toBe(`${REPO}#${PR}`)
    expect(link?.textContent).not.toContain(REPO)
    expect(link?.className).toContain('wrap-anywhere')
    expect(link?.className).toContain('min-w-0')
    expect(link?.className).toContain('max-w-full')

    const queueRow = link?.closest('li')
    expect(queueRow?.className).toContain('flex-wrap')
    // Badge and Remove forward className (shrink-0 is not on those primitives).
    expect(queueRow?.firstElementChild?.className).toContain('shrink-0')
    expect(queueRow?.querySelector('button')?.className).toContain('shrink-0')
    const reason = queueRow?.querySelector('span.flex-auto')
    expect(reason?.textContent).toContain(REASON)
    expect(reason?.className).toContain('wrap-break-word')
    expect(reason?.className.split(/\s+/)).not.toContain('flex-1')

    const train = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(TRAIN_PR)}"]`)
    expect(train?.textContent).toBe(`#${TRAIN_PR}`)
    expect(train?.getAttribute('title')).toBe(`${REPO}#${TRAIN_PR}`)
    expect(train?.className).toContain('wrap-anywhere')
    expect(train?.className).toContain('min-w-0')

    const bare = Array.from(document.querySelectorAll('span')).find((el) => el.textContent === 'widget-docs')
    expect(bare?.getAttribute('title')).toBe(BARE_REPO)

    const showMerged = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('merged today'))
    expect(showMerged).toBeTruthy()
    await act(async () => showMerged!.click())
    const merged = document.querySelector<HTMLAnchorElement>(`a[href="${refHref(MERGED_PR)}"]`)
    expect(merged?.textContent).toBe(`#${MERGED_PR}`)
    expect(merged?.getAttribute('title')).toBe(`${REPO}#${MERGED_PR}`)
    expect(merged?.className).toContain('wrap-anywhere')
  })
})
