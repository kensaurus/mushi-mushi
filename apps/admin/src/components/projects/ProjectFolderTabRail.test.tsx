/**
 * @vitest-environment jsdom
 *
 * The phone app rail on Manage apps > Your apps scrolls inside its own box. Its chips hold
 * favicons with sr-only labels (position: absolute); without `relative` on the scroller the
 * last label escaped it and the whole 390 page scrolled sideways (round 3, 2026-11-19).
 * jsdom cannot measure layout, so the class that decides it is the regression check.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectFolderTabRail, stuckSummary } from './ProjectFolderTabRail'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

const project = (i: number) => ({
  id: `p${i}`,
  name: `App ${i}`,
  slug: `app-${i}`,
  report_count: i,
  active_key_count: 1,
  api_keys: [],
})

describe('ProjectFolderTabRail', () => {
  it('keeps the phone rail a positioned scroller, so sr-only labels stay inside it', () => {
    act(() =>
      root.render(
        createElement(MemoryRouter, null, createElement(ProjectFolderTabRail, { projects: Array.from({ length: 10 }, (_, i) => project(i)), activeId: 'p0', onSelect: () => {} })),
      ),
    )
    const rail = host.querySelector('[data-testid="projects-app-rail"]')!
    const cls = rail.className.split(/\s+/)
    expect(cls).toContain('relative')
    expect(cls).toContain('overflow-x-auto')
    expect(cls).toContain('min-w-0')
    expect(rail.querySelectorAll('button')).toHaveLength(10)
  })
})

// Round 3: "Auto-fix stopped on N reports" sat on 8 of 10 rows; the rail says it once per kind.
describe('stuckSummary', () => {
  const stuck = (n: number) => ({ pdca_bottleneck: 'do' as const, pdca_bottleneck_label: `${n} reports still unfixed after an auto-fix attempt`, pdca_bottleneck_count: n })
  it('groups the stuck apps into one line per kind', () => {
    expect(stuckSummary([stuck(10), stuck(39), stuck(3), { pdca_bottleneck: null, pdca_bottleneck_label: null, pdca_bottleneck_count: null }])).toEqual(['Auto-fix stopped on 3 apps'])
    expect(stuckSummary([])).toEqual([])
  })

  it('marks each stuck row with a dot, not the sentence', () => {
    act(() =>
      root.render(
        createElement(MemoryRouter, null, createElement(ProjectFolderTabRail, { projects: [{ ...project(1), ...stuck(10) }, project(2)], activeId: 'p1', onSelect: () => {} })),
      ),
    )
    const rail = host.querySelector('[data-testid="projects-app-rail"]')!
    expect(rail.querySelectorAll('[data-testid="project-rail-stuck"]')).toHaveLength(1)
    const visible = rail.cloneNode(true) as HTMLElement
    visible.querySelectorAll('.sr-only').forEach((n) => n.remove())
    expect(visible.textContent).not.toContain('Auto-fix stopped')
    expect(host.querySelector('[data-testid="projects-rail-stuck-summary"]')?.textContent).toBe('Auto-fix stopped on 1 app')
  })
})
