/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/charts/MetricTimeline.test.tsx
 * PURPOSE: Unusual spikes and Schema changes draw the metric itself, with a
 *          line per release and a dot per spike (console journeys
 *          2026-10-27: the views were tiles and detector names, no chart).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))

import { MetricTimeline, timelineScale } from './MetricTimeline'
import { buildMetricViews } from '../anomalies/SpikesOverview'
import { changesPerDay } from '../drift/SchemaChangesTimeline'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const points = [
  { ts: '2026-10-01T00:00:00Z', value: 1 },
  { ts: '2026-10-02T00:00:00Z', value: 2 },
  { ts: '2026-10-03T00:00:00Z', value: 9 },
]

describe('MetricTimeline', () => {
  it('draws the series with release lines and spike dots inside the time window', () => {
    act(() =>
      root.render(
        createElement(MetricTimeline, {
          title: 'error_rate',
          points,
          markers: [
            { ts: '2026-10-02T12:00:00Z', label: 'v1.4.0' },
            { ts: '2026-09-01T00:00:00Z', label: 'too old' },
          ],
          dots: [
            { ts: '2026-10-03T00:00:00Z', value: 9, label: 'Sudden jump', state: 'open' },
            { ts: '2026-10-01T00:00:00Z', value: 1, label: 'Old jump', state: 'closed' },
          ],
        }),
      ),
    )
    expect(host.querySelectorAll('[data-testid="metric-timeline-release"]')).toHaveLength(1)
    const spikes = [...host.querySelectorAll<HTMLElement>('[data-testid="metric-timeline-spike"]')]
    expect(spikes.map((s) => s.dataset.state)).toEqual(['open', 'closed'])
    expect(spikes[0]!.className).toContain('bg-danger')
    // Marks are positioned against the plot itself: a wrapper in between (a
    // tooltip span) pinned every mark to the left edge in the first build.
    const plot = host.querySelector('[role="img"]')!
    expect(spikes.every((s) => s.parentElement === plot)).toBe(true)
    expect(spikes[0]!.style.left).toBe('100%')
    const release = host.querySelector<HTMLElement>('[data-testid="metric-timeline-release"]')!
    expect(release.parentElement).toBe(plot)
    expect(release.style.left).toBe('75%')
    expect(host.querySelector('figcaption')?.textContent).toContain('Release')
    expect(host.querySelector('figcaption')?.textContent).toContain('Spike to check')
    // Screen readers get the same data as a table.
    expect(host.querySelectorAll('table.sr-only tbody tr')).toHaveLength(6)
  })

  it('renders nothing without points', () => {
    act(() => root.render(createElement(MetricTimeline, { title: 'x', points: [] })))
    expect(host.innerHTML).toBe('')
  })

  it('places the first and last point at the edges and the top value at the top', () => {
    const s = timelineScale(points)
    expect(s.x('2026-10-01T00:00:00Z')).toBe(0)
    expect(s.x('2026-10-03T00:00:00Z')).toBe(100)
    expect(s.y(9)).toBe(0)
    expect(s.y(0)).toBe(100)
  })
})

describe('buildMetricViews', () => {
  it('puts metrics with an open spike first and drops metrics without points', () => {
    const views = buildMetricViews(
      [
        { ts: '2026-10-01T00:00:00Z', value: 1, metric_name: 'latency' },
        { ts: '2026-10-02T00:00:00Z', value: 1, metric_name: 'latency' },
        { ts: '2026-10-01T00:00:00Z', value: 1, metric_name: 'error_rate' },
      ],
      [
        { id: 'a', metric_name: 'error_rate', detected_at: '2026-10-01T00:00:00Z', value: 1, status: 'open', method: 'z-score' },
        { id: 'b', metric_name: 'gone', detected_at: '2026-10-01T00:00:00Z', value: 1, status: 'open', method: 'z-score' },
      ],
    )
    expect(views.map((v) => v.name)).toEqual(['error_rate', 'latency'])
    expect(views[0]!.open.map((s) => s.id)).toEqual(['a'])
  })
})

describe('changesPerDay', () => {
  it('counts changes per day and marks days with a serious change still open', () => {
    const days = changesPerDay([
      { id: '1', severity: 'warn', status: 'open', created_at: '2026-10-02T09:00:00Z' },
      { id: '2', severity: 'critical', status: 'open', created_at: '2026-10-02T10:00:00Z' },
      { id: '3', severity: 'critical', status: 'dismissed', created_at: '2026-10-01T10:00:00Z' },
    ])
    expect(days).toEqual([
      { ts: '2026-10-01T12:00:00Z', value: 1, serious: 1, seriousOpen: 0 },
      { ts: '2026-10-02T12:00:00Z', value: 2, serious: 1, seriousOpen: 1 },
    ])
  })
})
