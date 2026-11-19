/**
 * @vitest-environment jsdom
 *
 * 2026-11-18: the readout was titled "Iterate" on a page named "Improvement runs", and a project
 * that never ran showed "Last failure: None" as a calm green row.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IterateReadout } from './IterateReadout'
import { EMPTY_ITERATE_STATS, type IterateStats } from './IterateStatsTypes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function render(stats: IterateStats) {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(IterateReadout, { stats, fetchedAt: null })))
  })
  // The readout is collapsed under "Developer details": open it.
  const toggle = [...host.querySelectorAll('button, summary')].find((b) => b.textContent?.includes('Developer details')) as HTMLElement | undefined
  act(() => toggle?.click())
}

describe('IterateReadout', () => {
  it('uses the page name and says "No runs yet" instead of a green "None"', () => {
    render({ ...EMPTY_ITERATE_STATS, projectId: 'p1' })
    expect(host.textContent).toContain('Improvement runs endpoints')
    expect(host.textContent).not.toMatch(/Iterate/)
    expect(host.textContent).toContain('No runs yet')
  })

  it('says "None" once a run has happened without a failure', () => {
    render({ ...EMPTY_ITERATE_STATS, projectId: 'p1', lastRunAt: '2026-11-17T00:00:00Z', succeeded: 1, total: 1 })
    expect(host.textContent).not.toContain('No runs yet')
  })
})
