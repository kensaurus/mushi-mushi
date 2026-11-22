/**
 * @vitest-environment jsdom
 *
 * Round-2 sweep 2026-11-18: the History empty state pointed at a search box
 * "above" that lives on another tab. It now offers to open that tab.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchSessionTable } from './ResearchSessionTable'

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

const base = { sessions: [], projectName: 'App', modeFilter: 'all' as const, ageFilter: 'all' as const, onModeFilterChange: () => {}, onAgeFilterChange: () => {}, onOpenSession: () => {} }

describe('ResearchSessionTable with no sessions', () => {
  it('points at the Search tab, not "above"', () => {
    const onSearch = vi.fn()
    act(() => root.render(createElement(ResearchSessionTable, { ...base, onSearch })))
    expect(host.textContent).not.toContain('above')
    const open = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Open Search')!
    act(() => open.click())
    expect(onSearch).toHaveBeenCalledOnce()
  })

  it('stays quiet when the page first-step card already says it', () => {
    act(() => root.render(createElement(ResearchSessionTable, { ...base, firstStepShown: true })))
    expect(host.textContent).toBe('')
  })
})
