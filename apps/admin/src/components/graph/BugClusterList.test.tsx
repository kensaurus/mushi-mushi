/**
 * @vitest-environment jsdom
 *
 * Bug clusters lead with a named list (report 4659acc8: the map named its
 * groups by UUID): biggest first, single reports left out, each with its
 * title, severity, fix state and a link to its main report.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ groups: [] as unknown[] }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { groups: state.groups }, loading: false, error: null, reload: () => {} }),
}))

import { BugClusterList, clusterFixState } from './BugClusterList'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const report = (id: string, status: string, severity: string | null = 'medium', summary: string | null = null) => ({ id, status, severity, summary, category: 'bug' })

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

function render() {
  act(() => root.render(createElement(MemoryRouter, null, createElement(BugClusterList))))
}

describe('BugClusterList', () => {
  it('lists clusters by size with a readable title, never the group id', () => {
    state.groups = [
      { id: '6f6a3044-f1b6-4000-8000-000000000001', title: null, canonical_report_id: 'r2', report_count: 2, reports: [report('r1', 'classified'), report('r2', 'classified', 'high', 'Lesson rail crashes on open')] },
      { id: 'g-big', title: 'Checkout total shows NaN', canonical_report_id: 'r3', report_count: 5, reports: [report('r3', 'fixing', 'critical')] },
      { id: 'g-single', title: 'One-off', canonical_report_id: 'r9', report_count: 1, reports: [report('r9', 'new')] },
    ]
    render()
    const rows = [...host.querySelectorAll('[data-testid^="graph-cluster-"]')]
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['graph-cluster-g-big', 'graph-cluster-6f6a3044-f1b6-4000-8000-000000000001'])
    expect(rows[1].textContent).toContain('Lesson rail crashes on open')
    expect(rows[1].textContent).not.toContain('6f6a3044')
    expect(rows[0].textContent).toContain('Fix on the way')
    expect(rows[0].querySelector('a')!.getAttribute('href')).toBe('/reports/r3')
  })

  it('says so when no two bugs share a cause', () => {
    state.groups = [{ id: 'g', title: 'x', canonical_report_id: 'r', report_count: 1, reports: [] }]
    render()
    expect(host.querySelector('[data-testid="graph-clusters-empty"]')).not.toBeNull()
  })

  it('reads the fix state from the reports', () => {
    expect(clusterFixState({ reports: [report('a', 'fixed'), report('b', 'verified')] })).toEqual({ label: 'All fixed', tone: 'ok' })
    expect(clusterFixState({ reports: [report('a', 'fixed'), report('b', 'new')] })).toEqual({ label: '1 of 2 fixed', tone: 'ok' })
    expect(clusterFixState({ reports: [report('a', 'new')] })).toBeNull()
  })
})
