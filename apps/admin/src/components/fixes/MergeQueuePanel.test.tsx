/**
 * @vitest-environment jsdom
 *
 * The "Merge when ready" panel keeps a frame while its first read runs and
 * says when nothing is queued, instead of rendering nothing and then pushing
 * the fix list down (layout shift on /fixes, measured 2026-10-24).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MergeQueueLib from '../../lib/mergeQueue'

const mocks = vi.hoisted(() => ({
  resolve: null as ((value: unknown) => void) | null,
}))

vi.mock('../../lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../../lib/mergeQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof MergeQueueLib>()
  return {
    ...actual,
    loadMergeQueue: () => new Promise((resolve) => { mocks.resolve = resolve }),
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

async function render(projectId: string | null = 'p1', heading?: 'h2' | 'h3') {
  await act(async () => {
    root.render(createElement(MergeQueuePanel, { projectId, refreshKey: 0, ...(heading ? { heading } : {}) }))
  })
}

async function answer(rows: unknown[]) {
  await act(async () => {
    mocks.resolve?.({ ok: true, data: { rows, trains: [], release: [] } })
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
    expect(host.textContent).toContain('Merge when ready')
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
    expect(host.textContent).toContain('Nothing waiting to merge.')
    expect(window.localStorage.getItem('mushi:merge-queue-nonempty:p1')).toBe('0')
  })

  it('lists queued rows in a box that scrolls inside the panel', async () => {
    await render()
    await answer([row()])
    const list = host.querySelector('ul.max-h-40')
    expect(list?.textContent).toContain('o/r#7')
    expect(window.localStorage.getItem('mushi:merge-queue-nonempty:p1')).toBe('1')
  })

  it('lets a long ref break and gives the reason its own line on a phone', async () => {
    await render()
    await answer([row({ repo: 'kensaurus/solo-boss-cloud-documentation', pr_number: 789 })])
    const link = host.querySelector('ul.max-h-40 a')!
    expect(link.className).toContain('wrap-anywhere')
    expect(link.textContent).toBe('kensaurus/solo-boss-cloud-documentation#789')
    const reason = [...host.querySelectorAll('ul.max-h-40 span')].find((s) => s.textContent?.includes('Approved'))!
    expect(reason.className).toContain('flex-auto')
    expect(reason.className).not.toContain('flex-1')
  })

  it('renders nothing without an active app', async () => {
    await render(null)
    expect(host.innerHTML).toBe('')
  })

  it('stays an h3 unless the page asks for an h2', async () => {
    await render()
    expect(host.querySelector('h3')?.textContent).toBe('Merge when ready')
    expect(host.querySelector('h2')).toBeNull()
    await answer([])
    expect(host.querySelector('h3')?.textContent).toBe('Merge when ready')
    expect(host.querySelector('h2')).toBeNull()

    await render('p1', 'h2')
    expect(host.querySelector('h2')?.textContent).toBe('Merge when ready')
    expect(host.querySelector('h3')).toBeNull()
  })
})
