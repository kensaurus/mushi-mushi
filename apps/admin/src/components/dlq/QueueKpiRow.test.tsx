/**
 * @vitest-environment jsdom
 */

/**
 * Processing jobs showed "PENDING 0 ↑774%": the Pending tile carried the
 * week-on-week change of daily intake, which reads as the backlog growing
 * when nothing is waiting (console sweep, 2026-10-28).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueueKpiRow } from './QueueKpiRow'
import { EMPTY_QUEUE_STATS } from './QueueStatsTypes'
import type { ThroughputDay } from './types'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

// Quiet first week, busy second week: intake and completions both up a lot.
const throughput: ThroughputDay[] = Array.from({ length: 14 }, (_, i) => ({
  day: `2026-10-${String(15 + i).padStart(2, '0')}`,
  created: i < 7 ? 1 : 10,
  completed: i < 7 ? 1 : 10,
  failed: 0,
}))

function tileText(label: string): string {
  const tiles = [...container.querySelectorAll('[aria-label="Queue processing metrics"] > *')]
  return tiles.map((t) => t.textContent ?? '').find((t) => t.toLowerCase().includes(label)) ?? ''
}

describe('QueueKpiRow', () => {
  it('shows no growth arrow on an empty Pending tile', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(QueueKpiRow, { stats: { ...EMPTY_QUEUE_STATS, completed: 188 }, throughput })))
    })
    expect(tileText('pending')).toContain('0')
    expect(tileText('pending')).not.toContain('%')
    expect(tileText('completed')).toContain('%')
  })
})
