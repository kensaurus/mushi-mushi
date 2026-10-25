/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/dashboard/LivePdcaPipeline.test.tsx
 * PURPOSE: The "How Mushi works" explainer must not own the top of Home
 *          forever (report 04f7bd36): its only gate used to be `isBeginner`,
 *          which lib/mode.ts now hardcodes to true, so the four cards pushed
 *          "Top 3 to triage" below the fold at 1440x900 on a mature project.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/useSendTestReport', () => ({ useSendTestReport: () => vi.fn() }))

import { LivePdcaPipeline } from './LivePdcaPipeline'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(mergedFixCount: number) {
  act(() => {
    root.render(
      createElement(MemoryRouter, null, createElement(LivePdcaPipeline, { projectId: 'p1', mergedFixCount })),
    )
  })
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text))
}

describe('LivePdcaPipeline', () => {
  it('renders the four stage cards while the project has no merged fix', () => {
    render(0)
    expect(container.querySelectorAll('ol li').length).toBe(4)
    expect(button('Hide')).toBeUndefined()
  })

  it('collapses to a one-line link once a fix has been merged', () => {
    render(3)
    expect(container.querySelectorAll('ol li').length).toBe(0)
    const link = button('How Mushi works')
    expect(link).toBeDefined()
    expect(link?.getAttribute('aria-expanded')).toBe('false')
  })

  it('expands on demand and persists the choice', () => {
    render(3)
    act(() => { button('How Mushi works')?.click() })
    expect(container.querySelectorAll('ol li').length).toBe(4)
    expect(window.localStorage.getItem('mushi:dashboard:how-mushi-works-open')).toBe('1')

    act(() => { button('Hide')?.click() })
    expect(container.querySelectorAll('ol li').length).toBe(0)
    expect(window.localStorage.getItem('mushi:dashboard:how-mushi-works-open')).toBeNull()
  })
})
