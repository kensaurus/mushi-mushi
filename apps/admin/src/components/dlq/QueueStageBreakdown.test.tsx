/**
 * @vitest-environment jsdom
 */

/**
 * 2026-11-18: "Backlog by stage · Fast filter" drew a full-width grey track for a
 * backlog of 0, which read as a full bar. A stage with no backlog has no bar.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueueStageBreakdown } from './QueueStageBreakdown'
import type { QueueSummary } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe('QueueStageBreakdown', () => {
  it('draws no bar for a stage with no backlog and a bar for one with backlog', async () => {
    const summary = {
      stages: ['fast_filter', 'classify'],
      byStage: { fast_filter: { completed: 2 }, classify: { pending: 1, failed: 1 } },
    } as unknown as QueueSummary
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(QueueStageBreakdown, { summary, selectedStage: '', onSelect: () => {} })))
    })
    const rows = [...container.querySelectorAll('button[type="button"]')].filter((b) => b.querySelector('[data-testid^="stage-bar"]'))
    expect(rows).toHaveLength(2)
    expect(rows[0]!.querySelector('[data-testid="stage-bar"]')).toBeNull()
    expect(rows[0]!.querySelector('[data-testid="stage-bar-empty"]')).not.toBeNull()
    expect(rows[1]!.querySelector('[data-testid="stage-bar"]')).not.toBeNull()
  })
})
