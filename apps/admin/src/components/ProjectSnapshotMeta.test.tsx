/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/ProjectSnapshotMeta.test.tsx
 * PURPOSE: Report 8af6c8f5. The switcher's snapshot chips rendered glyph-only
 *          text ("D", "Crit 12", "↑ 86", "↑ v1.33.1") with no accessible name,
 *          and the same "↑" meant both "more reports" and "SDK update". Every
 *          chip must now carry its own words plus an aria-label / title.
 *
 * USAGE: pnpm --filter @mushi-mushi/admin test -- ProjectSnapshotMeta
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ProjectSnapshotMeta } from './ProjectSnapshotMeta'
import type { ProjectSnapshot } from '../lib/projectSnapshotTypes'

const snapshot: ProjectSnapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'yen-yen',
  slug: 'yen-yen',
  last_report_at: null,
  pdca_bottleneck: 'do',
  pdca_bottleneck_label: '3 reports still unfixed after an auto-fix attempt',
  sdk_package: '@mushi-mushi/web',
  sdk_version: '1.27.0',
  sdk_latest_version: '1.33.1',
  sdk_status: 'outdated',
  severity_breakdown_30d: { critical: 12, major: 0, minor: 0, trivial: 0, other: 0, total: 12 },
  trend_7d: { last7d: 100, prev7d: 14, delta: 86, direction: 'up' },
}

let root: Root | null = null
let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

function render(props: Parameters<typeof ProjectSnapshotMeta>[0]) {
  act(() => {
    root = createRoot(container)
    root.render(createElement(MemoryRouter, null, createElement(ProjectSnapshotMeta, props)))
  })
}

describe('ProjectSnapshotMeta chips', () => {
  it('spells out the bottleneck stage instead of a bare letter', () => {
    render({ snapshot, compact: true, linkless: true })
    const chip = container.querySelector('[title^="PDCA bottleneck"]')
    expect(chip).not.toBeNull()
    expect(chip?.textContent).toBe('Stuck: Do')
    expect(chip?.getAttribute('aria-label')).toBe(
      'PDCA bottleneck: Do — 3 reports still unfixed after an auto-fix attempt',
    )
  })

  it('names the critical and trend chips, and keeps the trend distinct from the SDK chip', () => {
    render({ snapshot, compact: true, linkless: true })
    const critical = container.querySelector('[aria-label="12 critical reports in the last 30 days"]')
    expect(critical?.textContent).toBe('12 critical')

    const trend = container.querySelector('[aria-label="Reports up 86 versus the previous 7 days"]')
    expect(trend?.textContent).toBe('↑ 86 reports')

    // The SDK freshness chip no longer reuses the trend chip's arrow.
    const sdk = container.querySelector('[aria-label="SDK upgrade available to v1.33.1"]')
    expect(sdk?.textContent).toBe('SDK update v1.33.1')
  })

  it('keeps the accessible name when the bottleneck chip is a link', () => {
    render({ snapshot, compact: true })
    const link = container.querySelector('a[aria-label^="PDCA bottleneck"]')
    expect(link).not.toBeNull()
    expect(link?.textContent).toBe('Stuck: Do')
  })
})
