/**
 * @vitest-environment jsdom
 *
 * The "Merge when ready" panel keeps a frame while its first read runs and
 * says when nothing is queued, instead of rendering nothing and then pushing
 * the fix list down (layout shift on /fixes, measured 2026-10-24).
 *
 * A 10rem inner scroll showed about four rows while the heading counted
 * every pull request ("15 to merge", "13 approved"). The list is on the
 * page; past eight rows, "Show N more of M" reveals the rest.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MergeQueueLib from '../../lib/mergeQueue'

const mocks = vi.hoisted(() => ({
  resolve: null as ((value: unknown) => void) | null,
  saved: [] as unknown[],
}))

vi.mock('../../lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../../lib/mergeQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof MergeQueueLib>()
  return {
    ...actual,
    loadMergeQueue: () => new Promise((resolve) => { mocks.resolve = resolve }),
    saveReleaseSettings: async (_projectId: string, patch: unknown) => {
      mocks.saved.push(patch)
      return { ok: true, data: {} }
    },
  }
})

import { MergeQueuePanel } from './MergeQueuePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  window.localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(projectId: string | null = 'p1') {
  await act(async () => {
    root.render(createElement(MergeQueuePanel, { projectId, refreshKey: 0 }))
  })
}

async function answer(rows: unknown[], release: unknown[] = []) {
  await act(async () => {
    mocks.resolve?.({ ok: true, data: { rows, trains: [], release } })
  })
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'q1', repo: 'o/r', pr_number: 7, state: 'queued', detail: 'Approved; waits for the next release train.', updated_at: '2026-10-24T00:00:00Z', merged_at: null, ...over,
})

describe('MergeQueuePanel', () => {
  it('keeps its frame while the first read runs', async () => {
    await render()
    const frame = host.querySelector('section[aria-label="Merge queue"]')
    expect(frame?.getAttribute('aria-busy')).toBe('true')
    // Named for what it holds; Fixes' own "Ready to merge" list sits above it.
    expect(host.textContent).toContain('Merge queue')
  })

  it('starts the frame at the size the queue had last time', async () => {
    window.localStorage.setItem('mushi:merge-queue-nonempty:p1', '1')
    await render()
    expect(host.querySelector('.h-72')).not.toBeNull()
  })

  it('says nothing is waiting instead of disappearing when the queue is empty', async () => {
    await render()
    await answer([])
    expect(host.querySelector('section[aria-label="Merge queue"]')?.getAttribute('aria-busy')).toBeNull()
    expect(host.textContent).toContain('Nothing in the merge queue.')
    expect(window.localStorage.getItem('mushi:merge-queue-nonempty:p1')).toBe('0')
  })

  it('lists queued rows on the page, not inside a short scroll box', async () => {
    await render()
    await answer([row()])
    const list = host.querySelector('[data-testid="merge-queue-rows"]')
    expect(list?.className).not.toContain('max-h-40')
    expect(list?.className).not.toContain('overflow-y-auto')
    expect(list?.textContent).toContain('o/r#7')
    expect(host.querySelector('[data-testid="merge-queue-more"]')).toBeNull()
    expect(window.localStorage.getItem('mushi:merge-queue-nonempty:p1')).toBe('1')
  })

  it('shows eight of "15 to merge", then the rest, instead of a four-row window', async () => {
    await render()
    const numbers = [291, 310, 304, 285, 286, 287, 288, 289, 299, 293, 294, 295, 296, 297, 298]
    await answer(numbers.map((pr_number, i) => row({
      id: `q${i}`,
      pr_number,
      state: i < 2 ? 'resolving' : 'queued',
    })))
    const list = host.querySelector('[data-testid="merge-queue-rows"]')!
    expect(list.className).not.toContain('max-h-40')
    expect(list.className).not.toContain('overflow-y-auto')
    expect(host.textContent).toContain('15 to merge')
    expect(host.textContent).toContain('13 approved')
    expect(list.querySelectorAll('li').length).toBe(8)
    expect(list.textContent).toContain('Agent resolving')
    expect(list.textContent).toContain('o/r#291')
    expect(list.textContent).toContain('o/r#310')
    expect(list.textContent).toContain('o/r#304')
    expect(list.textContent).toContain('o/r#285')
    expect(list.textContent).not.toContain('o/r#299')
    const more = host.querySelector('[data-testid="merge-queue-more"]') as HTMLButtonElement
    expect(more.textContent).toBe('Show 7 more of 15')
    await act(async () => { more.click() })
    expect(list.querySelectorAll('li').length).toBe(15)
    expect(list.textContent).toContain('o/r#299')
    expect(host.querySelector('[data-testid="merge-queue-more"]')).toBeNull()
  })

  it('lets a long ref break and gives the reason its own line on a phone', async () => {
    await render()
    await answer([row({ repo: 'kensaurus/solo-boss-cloud-documentation', pr_number: 789 })])
    const link = host.querySelector('[data-testid="merge-queue-rows"] a')!
    expect(link.className).toContain('wrap-anywhere')
    expect(link.textContent).toBe('kensaurus/solo-boss-cloud-documentation#789')
    const reason = [...host.querySelectorAll('[data-testid="merge-queue-rows"] span')].find((s) => s.textContent?.includes('Approved'))!
    expect(reason.className).toContain('flex-auto')
    expect(reason.className).not.toContain('flex-1')
  })

  it('"Decide for me" is one switch, and says what it does once on (ADR 0055)', async () => {
    mocks.saved = []
    await render()
    await answer([], [{ projectId: 'p1', mode: 'train', intervalMinutes: 360, maxMembers: 15, autoDecide: false }])
    const sw = host.querySelector('button[role="switch"][aria-label="Let Mushi Mushi merge approved fixes and close held ones"]') as HTMLButtonElement
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(host.querySelector('[data-testid="auto-decide-note"]')).toBeNull()
    await act(async () => sw.click())
    expect(mocks.saved).toEqual([{ autoDecide: true }])
    expect(host.querySelector('[data-testid="auto-decide-note"]')?.textContent).toContain('up to 3 tries per bug')
  })

  it('renders nothing without an active app', async () => {
    await render(null)
    expect(host.innerHTML).toBe('')
  })
})
