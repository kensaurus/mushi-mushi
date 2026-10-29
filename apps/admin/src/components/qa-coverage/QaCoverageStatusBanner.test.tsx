/**
 * @vitest-environment jsdom
 */

/**
 * Scheduled tests said "QA coverage healthy … 0/3 stories passing · avg 100%
 * pass rate" in green when every run of the day had been skipped (Local
 * tests do not run on the schedule). No result is not a pass (2026-10-28).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QaCoverageStatusBanner } from './QaCoverageStatusBanner'
import { EMPTY_QA_COVERAGE_STATS, type QaCoverageStats } from './QaCoverageStatsTypes'

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

const base: QaCoverageStats = {
  ...EMPTY_QA_COVERAGE_STATS,
  hasAnyProject: true,
  projectId: 'p1',
  projectName: 'mushi-mushi',
  totalStories: 3,
  enabledStories: 3,
  totalRuns24h: 72,
  topPriority: 'healthy',
  topPriorityLabel: '0/3 stories passing · 72 runs in 24h · avg 100% pass rate.',
}

async function render(stats: QaCoverageStats) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(QaCoverageStatusBanner, { stats, plainBanner: true })))
  })
}

describe('QaCoverageStatusBanner', () => {
  it('says there is no result yet when every run was skipped', async () => {
    await render({ ...base, noDataStories: 3 })
    const text = container.textContent ?? ''
    expect(text).toContain('No test results yet')
    expect(text).toContain('3 tests ran 72 times')
    expect(text).not.toMatch(/healthy|100% pass rate/i)
  })

  it('stays healthy when tests passed', async () => {
    await render({ ...base, passingStories: 3, avgPassRatePct: 100, topPriorityLabel: '3/3 stories passing · 72 runs in 24h · avg 100% pass rate.' })
    expect(container.textContent).toContain('Automated QA is healthy')
  })
})
