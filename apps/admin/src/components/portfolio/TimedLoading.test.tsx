/**
 * @vitest-environment jsdom
 *
 * Never an endless spinner on /portfolio (round 2, 2026-11-18: "Adding up what each app
 * costs…", "Reading the register…" and "Reading CI…" spun on): after 20 s a read that has not
 * answered shows the hatched "not checked" row with one Retry, which reloads and restarts.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimedLoading } from './TimedLoading'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const draw = (waiting: boolean, onRetry: () => void) =>
  act(() => root.render(createElement(TimedLoading, { waiting, text: 'Reading CI…', what: 'CI runners', onRetry, testId: 'nc' })))

describe('TimedLoading', () => {
  it('shows the loading line, then "not checked" with Retry after 20 s, and Retry starts again', () => {
    const onRetry = vi.fn()
    draw(true, onRetry)
    expect(host.textContent).toContain('Reading CI…')
    expect(host.querySelector('[data-testid="nc"]')).toBeNull()
    act(() => vi.advanceTimersByTime(20_000))
    const row = host.querySelector('[data-testid="nc"]')!
    expect(row.textContent).toContain('CI runners: not checked')
    expect(host.textContent).not.toContain('Reading CI…')
    act(() => row.querySelector('button')!.click())
    expect(onRetry).toHaveBeenCalledTimes(1)
    // The clock starts again: the spinner is back until the next 20 s pass.
    expect(host.textContent).toContain('Reading CI…')
    act(() => vi.advanceTimersByTime(20_000))
    expect(host.querySelector('[data-testid="nc"]')).not.toBeNull()
  })

  it('draws nothing once the read has answered, even after it timed out', () => {
    draw(true, () => {})
    act(() => vi.advanceTimersByTime(20_000))
    draw(false, () => {})
    expect(host.textContent).toBe('')
  })
})
