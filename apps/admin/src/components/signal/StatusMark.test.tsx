/**
 * @vitest-environment jsdom
 *
 * The status design system (2026-11-18): each state has its own glyph (never colour alone),
 * a standalone mark is named, running carries its ring, and the run bar shows the usual time
 * and colours the overrun.
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { RunBar, STATUS_CHAR, StatusMark, StatusPill, type RunStatus } from './StatusMark'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ALL: RunStatus[] = ['running', 'passed', 'failed', 'waiting', 'slow', 'idle', 'cancelled']
let cleanup: Array<() => void> = []
afterEach(() => {
  cleanup.forEach((f) => f())
  cleanup = []
})

function mount(el: ReactElement): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  cleanup.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return host
}

describe('StatusMark', () => {
  it('draws a different glyph for every state', () => {
    const drawings = ALL.map((s) => mount(createElement(StatusMark, { status: s })).querySelector('svg')!.innerHTML)
    expect(new Set(drawings).size).toBe(ALL.length)
    expect(new Set(Object.values(STATUS_CHAR)).size).toBe(ALL.length)
  })

  it('is named when it stands alone and hidden when a word sits beside it', () => {
    for (const s of ALL) {
      const named = mount(createElement(StatusMark, { status: s, label: `${s} now` })).querySelector('[data-testid="status-mark"]')!
      expect(named.getAttribute('role')).toBe('img')
      expect(named.getAttribute('aria-label')).toBe(`${s} now`)
      expect(named.getAttribute('data-status')).toBe(s)
    }
    const plain = mount(createElement(StatusMark, { status: 'passed' })).querySelector('[data-testid="status-mark"]')!
    expect(plain.getAttribute('aria-hidden')).toBe('true')
  })

  it('gives running a breathing ring and nothing else one', () => {
    for (const s of ALL) {
      const ring = mount(createElement(StatusMark, { status: s })).querySelector('.st-ring')
      expect(ring != null).toBe(s === 'running')
    }
  })
})

describe('StatusPill', () => {
  it('pairs the mark with words and strikes a cancelled label', () => {
    const host = mount(createElement('div', null, createElement(StatusPill, { status: 'failed', label: '2 failed' }), createElement(StatusPill, { status: 'cancelled' })))
    const [failed, cancelled] = [...host.querySelectorAll('[data-testid="status-pill"]')]
    expect(failed!.textContent).toBe('2 failed')
    expect(failed!.className).toContain('text-st-failed-ink')
    expect(cancelled!.querySelector('.line-through')!.textContent).toBe('Cancelled')
  })
})

describe('RunBar', () => {
  it('runs blue with stripes and a usual-time tick while on time', () => {
    const bar = mount(createElement(RunBar, { elapsedS: 600, usualS: 960, label: '10 / 16 min' })).querySelector('[data-testid="run-bar"]')!
    expect(bar.getAttribute('data-status')).toBe('running')
    expect(bar.querySelector('.ci-stripes')).not.toBeNull()
    expect(bar.querySelector('[data-testid="run-bar-usual"]')).not.toBeNull()
    expect(bar.querySelector('[data-testid="run-bar-over"]')).toBeNull()
    expect(bar.textContent).toContain('10 / 16 min')
  })

  it('turns the overrun orange, then red', () => {
    const slow = mount(createElement(RunBar, { elapsedS: 1080, usualS: 960, label: '18 / 16 min' })).querySelector('[data-testid="run-bar"]')!
    expect(slow.getAttribute('data-status')).toBe('slow')
    expect(slow.querySelector('[data-testid="run-bar-over"]')!.className).toContain('bg-st-slow')
    const late = mount(createElement(RunBar, { elapsedS: 2400, usualS: 960, label: '40 / 16 min' })).querySelector('[data-testid="run-bar"]')!
    expect(late.getAttribute('data-status')).toBe('failed')
    expect(late.querySelector('[data-testid="run-bar-over"]')!.className).toContain('bg-st-failed')
  })

  it('stays open-ended without a usual time', () => {
    const bar = mount(createElement(RunBar, { elapsedS: 120, usualS: null, label: '2 min' })).querySelector('[data-testid="run-bar"]')!
    expect(bar.querySelector('[data-testid="run-bar-usual"]')).toBeNull()
    expect(bar.querySelector('.ci-stripes')).not.toBeNull()
  })
})
