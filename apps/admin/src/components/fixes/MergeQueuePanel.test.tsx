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

async function answer(rows: unknown[], release: unknown[] = [], trains: unknown[] = []) {
  await act(async () => {
    mocks.resolve?.({ ok: true, data: { rows, trains, release } })
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

describe('MergeQueuePanel as a picture (2026-11-18)', () => {
  const stage = (id: string) => host.querySelector(`[data-testid="train-stage-${id}"]`)!

  it('draws the queue as a stage train with counts, colouring only held and merged', async () => {
    await render()
    await answer(
      [
        row({ id: 'a', state: 'queued' }),
        row({ id: 'b', state: 'queued', pr_number: 8 }),
        row({ id: 'c', state: 'resolving', pr_number: 9 }),
        row({ id: 'd', state: 'blocked', pr_number: 10, detail: 'The follow-up Cursor key cannot be used here (key_used_up).' }),
        row({ id: 'e', state: 'merged', pr_number: 11, merged_at: '2026-10-24T01:00:00Z' }),
      ],
      [{ projectId: 'p1', mode: 'train', intervalMinutes: 360, maxMembers: 15 }],
      [{ id: 't1', project_id: 'p1', repo: 'o/r', pr_number: 99, state: 'testing', members: [1, 2, 3], attempt: 1, detail: null, created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z', merged_at: null }],
    )
    const train = host.querySelector('[data-testid="merge-queue-train"]')!
    expect(train.querySelector('figcaption')!.textContent).toBe('Merge queue: Queued 2, Waiting 0, Agent resolving 1, Held 1, Train running 3, Merged today 1')
    expect(stage('held').getAttribute('data-tone')).toBe('warn')
    expect(stage('held').textContent).toContain('1 key used up')
    expect(stage('queued').getAttribute('data-tone')).toBe('neutral')
    expect(stage('train').getAttribute('data-tone')).toBe('neutral')
    expect(stage('merged').getAttribute('data-tone')).toBe('ok')
    // The paragraph is now one short line.
    expect(train.textContent).toContain('one release train every 6 hours')
    expect(host.textContent).not.toContain('one branch, one CI run, one merge, so they ship as one release')
  })

  it('shows a held reason as a plain-word chip, never the raw code', async () => {
    await render()
    await answer([row({ id: 'd', state: 'blocked', detail: 'The follow-up Cursor key cannot be used here (key_used_up).' })])
    const chip = host.querySelector('[data-testid="merge-queue-row-d-why"]')!
    expect(chip.textContent).toBe('key used up')
    expect(chip.getAttribute('title')).toContain('(key_used_up)')
    expect(host.querySelector('[data-testid="merge-queue-row-d"]')!.textContent).not.toContain('key_used_up')
  })

  it('a queued row has no reason chip', async () => {
    await render()
    await answer([row({ id: 'a' })])
    expect(host.querySelector('[data-testid="merge-queue-row-a-why"]')).toBeNull()
  })
})
