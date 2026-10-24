/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/fixes/MergeQueuePanel.test.tsx
 * PURPOSE: A page snapshot that started before this card's own load must
 *          not replace the rows that load already showed. A newer snapshot
 *          still replaces them. The card keeps the queue box the skeleton uses.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXES_QUEUE_RESERVE } from './fixesReserve'
import { nextMergeQueueFetchSeq, toMergeQueueSnapshot, type MergeQueueRow, type MergeQueueSnapshot } from '../../lib/mergeQueue'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
}))

vi.mock('../../lib/mergeQueue', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../lib/mergeQueue')
  return { ...actual, loadMergeQueue: (...args: unknown[]) => mocks.load(...args) }
})
vi.mock('../../lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

import { MergeQueuePanel } from './MergeQueuePanel'

function row(detail: string): MergeQueueRow {
  return {
    id: 'q1',
    fix_attempt_id: 'f1',
    project_id: 'p1',
    repo: 'acme/app',
    pr_number: 12,
    state: 'queued',
    detail,
    head_sha: null,
    queued_at: '2026-10-24T00:00:00Z',
    updated_at: '2026-10-24T00:00:00Z',
    merged_at: null,
    conflict_agents: 0,
  }
}

function snap(detail: string, seq: number): MergeQueueSnapshot {
  return toMergeQueueSnapshot({
    rows: [row(detail)],
    trains: [],
    release: [{ projectId: 'p1', mode: 'train', intervalMinutes: 360, maxMembers: 15 }],
  }, 'p1', seq)
}

function loaded(detail: string) {
  return {
    ok: true,
    data: {
      rows: [row(detail)],
      trains: [],
      release: [{ projectId: 'p1', mode: 'train', intervalMinutes: 360, maxMembers: 15 }],
    },
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.load.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
}

function paint(initial: MergeQueueSnapshot, refreshKey: number) {
  act(() => {
    root.render(createElement(MergeQueuePanel, { projectId: 'p1', refreshKey, initial }))
  })
}

describe('MergeQueuePanel', () => {
  it('keeps its own load when an older page snapshot arrives, and applies a newer one', async () => {
    const initial = snap('Waiting for CI', 0)
    paint(initial, 0)
    const card = document.querySelector('[aria-label="Merge queue"]')?.firstElementChild
    expect(card).not.toBeNull()
    for (const cls of FIXES_QUEUE_RESERVE.split(' ')) expect(card!.classList.contains(cls)).toBe(true)
    expect(document.body.textContent).toContain('Waiting for CI')

    mocks.load.mockResolvedValue(loaded('Branch updated'))
    paint(initial, 1)
    await flush()
    expect(document.body.textContent).toContain('Branch updated')
    expect(document.body.textContent).not.toContain('Waiting for CI')

    paint(snap('Waiting for CI', 0), 1)
    expect(document.body.textContent).toContain('Branch updated')
    expect(document.body.textContent).not.toContain('Waiting for CI')

    paint(snap('Held for review', nextMergeQueueFetchSeq()), 1)
    expect(document.body.textContent).toContain('Held for review')
    expect(document.body.textContent).not.toContain('Branch updated')
  })
})
