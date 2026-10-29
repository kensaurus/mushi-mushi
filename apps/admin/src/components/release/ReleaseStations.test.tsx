/**
 * @vitest-environment jsdom
 */

/**
 * Each station showed its count over "N stuck": "39" over "39 stuck" said the
 * number twice on Home, Fixes and Pipeline (console sweep, 2026-10-28).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReleaseStations } from './ReleaseStations'
import type { ReleaseStation } from '../../lib/releaseStations'

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

const stations: ReleaseStation[] = [
  { id: 'fix', label: 'Drafted', count: 39, stuck: 39 },
  { id: 'ci', label: 'Reviewed', count: 6, stuck: 2 },
  { id: 'merged', label: 'Merged', count: 4, stuck: 0 },
]

describe('ReleaseStations', () => {
  it('says "all stuck" when every one is, and the share when only some are', () => {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(ReleaseStations, { stations, href: '/fixes' })))
    })
    const items = Array.from(container.querySelectorAll('li')).map((li) => li.textContent)
    expect(items[0]).toBe('39Draftedall stuck')
    expect(items[1]).toBe('6Reviewed2 stuck')
    expect(items[2]).toBe('4Merged')
    expect(container.querySelector('a')?.getAttribute('aria-label')).toBe('Drafted: 39, all stuck')
  })
})
