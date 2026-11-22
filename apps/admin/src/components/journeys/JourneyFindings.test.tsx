/**
 * @vitest-environment jsdom
 *
 * The flow map's labels are too small to read at normal width (owner,
 * 2026-11-18), so the top paths read as a ranked list: most visits first,
 * a bar on the busiest path's scale, and a sentence for screen readers.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FlowsSection } from './JourneyFindings'

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

describe('FlowsSection (top paths)', () => {
  it('ranks the paths with bars and says each one in words', () => {
    act(() =>
      root.render(
        createElement(FlowsSection, {
          flows: [
            { pages: ['/', '/pricing'], sessions: 4 },
            { pages: ['/', '/signup', '/app'], sessions: 8 },
          ],
          totalSessions: 16,
        }),
      ),
    )
    const items = host.querySelectorAll('[data-testid="journey-top-paths"] > li')
    expect(items).toHaveLength(2)
    expect(items[0].querySelector('.sr-only')?.textContent).toBe('/ then /signup then /app: 8 visits, 50% of all visits')
    const fills = host.querySelectorAll<HTMLElement>('[data-testid="bar-cell-fill"]')
    expect(fills[0].style.width).toBe('100%')
    expect(fills[1].style.width).toBe('50%')
  })

  it('explains an empty list', () => {
    act(() => root.render(createElement(FlowsSection, { flows: [], totalSessions: 0 })))
    expect(host.textContent).toContain('Paths appear once at least two visits take the same route.')
  })
})
