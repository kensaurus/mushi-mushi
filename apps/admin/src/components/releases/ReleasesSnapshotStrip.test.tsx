/**
 * @vitest-environment jsdom
 */

/**
 * Releases showed "116 fixed bugs ready to ship" in a banner with its own
 * "Generate draft" button, over a status line that counted the same 116, next
 * to "+ Draft" and a "New draft" tab (2026-10-28). The status line now says
 * it, and the banner steps aside.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReleasesSnapshotStrip } from './ReleasesSnapshotStrip'
import { EMPTY_RELEASES_STATS, type ReleasesStats } from './ReleasesStatsTypes'

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

async function render(stats: ReleasesStats) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(ReleasesSnapshotStrip, { stats, statsFetchedAt: null })))
  })
}

const shipped: ReleasesStats = { ...EMPTY_RELEASES_STATS, totalReleases: 3, publishedCount: 3 }

describe('ReleasesSnapshotStrip', () => {
  it('says how many fixed bugs are not in release notes yet', async () => {
    await render({ ...shipped, fixedReportsCount: 116, topPriority: 'ready_to_draft' })
    expect(container.textContent).toContain('3 releases published; 116 fixed bugs since then are not in release notes yet.')
  })

  it('keeps the plain sentence when nothing waits', async () => {
    await render({ ...shipped, topPriority: 'healthy' })
    expect(container.textContent).toContain('3 releases published.')
  })
})
