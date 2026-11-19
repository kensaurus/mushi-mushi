/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/qa-coverage/RunStrip.test.tsx
 * PURPOSE: Each scheduled-test card shows its last 7 days: red when a run
 *          failed that day, green when every finished run passed, grey with
 *          none, each day named in words for screen readers.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunStrip, dayTone } from './RunStrip'

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

describe('dayTone', () => {
  it('is red on any failure, green on passes only, grey with no runs', () => {
    expect(dayTone({ day: '2026-10-27', passed: 5, failed: 1 })).toBe('fail')
    expect(dayTone({ day: '2026-10-27', passed: 5, failed: 0 })).toBe('pass')
    expect(dayTone({ day: '2026-10-27', passed: 0, failed: 0 })).toBe('none')
  })

  it('marks a day with only skipped runs as skipped, never as failed or passed', () => {
    expect(dayTone({ day: '2026-10-27', passed: 0, failed: 0, skipped: 24 })).toBe('skip')
    expect(dayTone({ day: '2026-10-27', passed: 2, failed: 0, skipped: 24 })).toBe('pass')
    expect(dayTone({ day: '2026-10-27', passed: 0, failed: 1, skipped: 3 })).toBe('fail')
  })
})

describe('RunStrip', () => {
  it('draws one square per day with its result in words', () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-2${i + 1}`, passed: i, failed: i === 3 ? 2 : 0 }))
    act(() => root.render(createElement(RunStrip, { days })))
    const squares = [...host.querySelectorAll<HTMLElement>('li')]
    expect(squares).toHaveLength(7)
    expect(squares.map((s) => s.dataset.tone)).toEqual(['none', 'pass', 'pass', 'fail', 'pass', 'pass', 'pass'])
    expect(squares[3]!.textContent).toContain('3 passed, 2 failed')
    expect(squares[0]!.textContent).toContain('no runs')
    // Each result carries a glyph, so colour is never the only signal; an empty day has none.
    expect(squares[3]!.querySelector('[data-status="failed"]')).not.toBeNull()
    expect(squares[1]!.querySelector('[data-status="passed"]')).not.toBeNull()
    expect(squares[0]!.querySelector('[data-testid="status-mark"]')).toBeNull()
  })

  it('says a skipped day was skipped, with its own glyph', () => {
    act(() => root.render(createElement(RunStrip, { days: [{ day: '2026-10-21', passed: 0, failed: 0, skipped: 24 }] })))
    const square = host.querySelector<HTMLElement>('li')!
    expect(square.dataset.tone).toBe('skip')
    expect(square.textContent).toContain('24 skipped, nothing checked')
    expect(square.querySelector('[data-status="cancelled"]')).not.toBeNull()
  })
})
