/**
 * @vitest-environment jsdom
 *
 * Releases across apps (2026-11-18): one table row per app, the stage as a status pill,
 * apps with work waiting first, a zero count faint, and "not checked" never read as live.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: state.data, loading: false, error: null, isValidating: false, reload: () => {} }),
}))

import { groupReleaseRows, ReleasesCard, sortReleaseRows } from './ReleasesCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (name: string, stage: string, otaPending = 0, mergedNotBuilt = 0, live: { version: string; rolloutPct: number | null } | null = null) => ({
  projectId: name,
  name,
  mergedNotBuilt,
  builtNotSubmitted: null,
  inReview: null,
  live,
  otaPending,
  stage,
})

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('sortReleaseRows', () => {
  it('puts work that needs you first and "not checked" last', () => {
    const sorted = sortReleaseRows([
      row('idle-app', 'idle'),
      row('unknown-app', 'unknown'),
      row('ota-small', 'ota_ready', 3),
      row('review-app', 'in_review'),
      row('ota-big', 'ota_ready', 40),
      row('build-app', 'waiting_for_build', 0, 2),
    ])
    expect(sorted.map((r) => r.name)).toEqual(['build-app', 'ota-big', 'ota-small', 'review-app', 'idle-app', 'unknown-app'])
  })
})

describe('ReleasesCard', () => {
  it('draws each app as a row with a status pill, a rollout bar and faint zeros', async () => {
    state.data = {
      rows: [row('glot.it', 'ota_ready', 109, 0, { version: '1.105.0', rolloutPct: 100 }), row('kensaur.us', 'unknown')],
      batchSuggestion: { note: 'Only JS-only fixes are waiting: ship them as OTA now.' },
    }
    await act(async () => root.render(createElement(ReleasesCard, { orgId: 'org-1' })))
    const rows = host.querySelectorAll('[data-testid="releases-table"] tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-stage')).toBe('ota_ready')
    expect(rows[0].querySelector('[data-testid="status-pill"]')?.textContent).toBe('OTA ready')
    expect(rows[0].querySelector('[data-testid="bar-cell-fill"]')).not.toBeNull()
    expect(rows[0].textContent).toContain('100%')
    expect(rows[1].querySelector('[data-testid="status-pill"]')?.getAttribute('data-status')).toBe('idle')
    expect(rows[1].textContent).toContain('not checked')
    expect(host.textContent).not.toContain('Native changes:')
    expect(host.querySelector('[data-testid="releases-batch"]')?.textContent).toContain('ship them as OTA now')
    // Not checked is not zero: its counts are hatched "—", and the columns say what they count.
    const cells = rows[1].querySelectorAll('td')
    expect([cells[3].textContent, cells[4].textContent]).toEqual(['—', '—'])
    expect(cells[3].className).toContain('ci-nodata')
    expect(host.querySelector('thead')?.textContent).toContain('Native changes')
    expect(host.querySelector('thead')?.textContent).toContain('OTA changes')
  })

  it('groups apps in one stage under one row ("In review · 3 apps") instead of repeating the pill', async () => {
    const rows = [row('a', 'in_review'), row('b', 'in_review'), row('c', 'in_review'), row('d', 'ota_ready', 5), row('e', 'idle')]
    expect(groupReleaseRows(rows).map((g) => [g.stage, g.rows.length])).toEqual([['ota_ready', 1], ['in_review', 3], ['idle', 1]])
    state.data = { rows, batchSuggestion: null }
    await act(async () => root.render(createElement(ReleasesCard, { orgId: 'org-1' })))
    expect(host.querySelector('[data-testid="releases-stage-in_review"]')!.textContent).toBe('In review3 apps')
    expect(host.querySelectorAll('[data-testid^="releases-stage-"]')).toHaveLength(1)
    const reviewRows = host.querySelectorAll('tr[data-stage="in_review"]')
    expect(reviewRows).toHaveLength(3)
    expect([...reviewRows].every((r) => r.querySelector('[data-testid="status-pill"]') === null)).toBe(true)
    expect(host.querySelector('tr[data-stage="ota_ready"] [data-testid="status-pill"]')?.textContent).toBe('OTA ready')
  })
})
