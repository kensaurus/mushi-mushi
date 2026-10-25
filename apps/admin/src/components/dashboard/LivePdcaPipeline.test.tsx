/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/dashboard/LivePdcaPipeline.test.tsx
 * PURPOSE: The "How Mushi works" explainer must not own the top of Home
 *          forever (report 04f7bd36): its only gate used to be `isBeginner`,
 *          which lib/mode.ts now hardcodes to true, so the four cards pushed
 *          "Top 3 to triage" below the fold at 1440x900 on a mature project.
 *
 * OVERVIEW: Covers the default per maturity, an unknown count, the first
 *           frame of a project switch, the per-project preference, the
 *           dismiss control at every maturity, and that one toggle writes the
 *           preference once (the write is not inside a setState updater).
 */

import { act, createElement, StrictMode, useLayoutEffect, type ReactNode } from 'react'
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
  vi.restoreAllMocks()
})

function render(mergedFixCount: number | null | undefined, projectId = 'p1', strict = false) {
  const tree = createElement(
    MemoryRouter,
    null,
    createElement(LivePdcaPipeline, { projectId, mergedFixCount }),
  )
  act(() => {
    root.render(strict ? createElement(StrictMode, null, tree) : tree)
  })
}

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text))
}

const KEY = 'mushi:dashboard:how-mushi-works-open'

describe('LivePdcaPipeline', () => {
  it('renders the four stage cards while the project has no merged fix', () => {
    render(0)
    expect(container.querySelectorAll('ol li').length).toBe(4)
  })

  it('offers the dismiss control even with no merged fix', () => {
    render(0)
    expect(button('Hide')).toBeDefined()

    act(() => { button('Hide')?.click() })
    expect(container.querySelectorAll('ol li').length).toBe(0)
    expect(window.localStorage.getItem(`${KEY}:p1`)).toBe('0')
  })

  it('stays collapsed while the merged-fix count is still unknown', () => {
    render(undefined)
    expect(container.querySelectorAll('ol li').length).toBe(0)
    expect(button('How Mushi works')?.getAttribute('aria-expanded')).toBe('false')

    render(null)
    expect(container.querySelectorAll('ol li').length).toBe(0)

    // Once the count resolves to zero, the four cards still appear.
    render(0)
    expect(container.querySelectorAll('ol li').length).toBe(4)
  })

  it('keeps an explicit open choice while the count is unknown', () => {
    window.localStorage.setItem(`${KEY}:p1`, '1')
    render(undefined)
    expect(container.querySelectorAll('ol li').length).toBe(4)
  })

  it('uses the next project preference on the first frame of a switch', () => {
    window.localStorage.setItem(`${KEY}:p1`, '0')
    window.localStorage.setItem(`${KEY}:p2`, '0')
    const frames: number[] = []
    function Probe({ children }: { children: ReactNode }) {
      useLayoutEffect(() => {
        frames.push(container.querySelectorAll('ol li').length)
      })
      return createElement('div', null, children)
    }
    const tree = (projectId: string) =>
      createElement(
        Probe,
        null,
        createElement(MemoryRouter, null, createElement(LivePdcaPipeline, { projectId, mergedFixCount: 3 })),
      )

    act(() => { root.render(tree('p1')) })
    // Open p1 so its in-memory choice is the opposite of p2's stored one.
    act(() => { button('How Mushi works')?.click() })
    expect(container.querySelectorAll('ol li').length).toBe(4)

    frames.length = 0
    act(() => { root.render(tree('p2')) })
    // The first commit of the switch, before passive effects, must already
    // be p2. A preference applied in an effect paints one frame of p1.
    expect(frames[0]).toBe(0)
    expect(container.querySelectorAll('ol li').length).toBe(0)
  })

  it('collapses to a one-line link once a fix has been merged', () => {
    render(3)
    expect(container.querySelectorAll('ol li').length).toBe(0)
    const link = button('How Mushi works')
    expect(link).toBeDefined()
    expect(link?.getAttribute('aria-expanded')).toBe('false')
  })

  it('expands on demand and persists the choice per project', () => {
    render(3)
    act(() => { button('How Mushi works')?.click() })
    expect(container.querySelectorAll('ol li').length).toBe(4)
    expect(window.localStorage.getItem(`${KEY}:p1`)).toBe('1')

    act(() => { button('Hide')?.click() })
    expect(container.querySelectorAll('ol li').length).toBe(0)
    expect(window.localStorage.getItem(`${KEY}:p1`)).toBe('0')
  })

  it('does not apply one project\u2019s expanded explainer to another project', () => {
    window.localStorage.setItem(`${KEY}:p1`, '1')
    render(3, 'p2')
    expect(container.querySelectorAll('ol li').length).toBe(0)

    // Re-reads the preference when the active project changes.
    render(3, 'p1')
    expect(container.querySelectorAll('ol li').length).toBe(4)
  })

  it('writes the preference once per toggle under StrictMode', () => {
    // jsdom's Storage is a Proxy — the spy has to go on the prototype.
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(3, 'p1', true)
    act(() => { button('How Mushi works')?.click() })

    expect(container.querySelectorAll('ol li').length).toBe(4)
    expect(setItem.mock.calls.filter((c) => c[0] === `${KEY}:p1`)).toHaveLength(1)
  })
})
