/**
 * @vitest-environment jsdom
 */

/**
 * Weekly insights said "Weekly summaries are up to date" in green and, right
 * under it, "The last summary run failed." in red: the strip counted any
 * failed job among the last 20, even one a newer summary had replaced
 * (console sweep, 2026-10-28). Only the latest run's failure is news.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IntelligenceSnapshotStrip } from './IntelligenceSnapshotStrip'
import { EMPTY_INTELLIGENCE_STATS, type IntelligenceStats } from './IntelligenceStatsTypes'

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

const upToDate: IntelligenceStats = {
  ...EMPTY_INTELLIGENCE_STATS,
  hasAnyProject: true,
  featureUnlocked: true,
  reportCount: 24,
  latestWeekStart: '2026-10-19',
  totalReportsInLatest: 140,
  failedJobCount: 1,
  lastJobStatus: 'completed',
  topPriority: 'healthy',
}

async function render(stats: IntelligenceStats) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(IntelligenceSnapshotStrip, { stats, statsFetchedAt: null })))
  })
}

describe('IntelligenceSnapshotStrip', () => {
  it('does not report an old failure once a newer summary landed', async () => {
    await render(upToDate)
    expect(container.textContent).toContain('140 bugs reported')
    expect(container.textContent).not.toMatch(/failed/i)
  })

  it('reports the failure while the latest run is the failed one', async () => {
    await render({ ...upToDate, lastJobStatus: 'failed', topPriority: 'job_failed' })
    expect(container.textContent).toContain('The last summary run failed.')
  })
})
