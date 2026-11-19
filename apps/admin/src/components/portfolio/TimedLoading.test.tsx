/**
 * @vitest-environment jsdom
 *
 * Never an endless spinner on /portfolio (round 2, 2026-11-18: "Adding up what each app
 * costs…", "Reading the register…" and "Reading CI…" spun on): after 10 s a read that has not
 * answered shows the hatched "not checked" row with one Retry, which reloads and restarts.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimedLoading } from './TimedLoading'
import { CI_READ_TIMEOUT_MS } from '../../lib/ciReadTimeout'

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
  it('waits 10 s, not 20 s', () => {
    expect(CI_READ_TIMEOUT_MS).toBe(10_000)
  })

  it('shows the loading line, then "not checked" with Retry after the timeout, and Retry starts again', () => {
    const onRetry = vi.fn()
    draw(true, onRetry)
    expect(host.textContent).toContain('Reading CI…')
    expect(host.querySelector('[data-testid="nc"]')).toBeNull()
    act(() => vi.advanceTimersByTime(CI_READ_TIMEOUT_MS - 1))
    expect(host.querySelector('[data-testid="nc"]')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    const row = host.querySelector('[data-testid="nc"]')!
    expect(row.textContent).toContain('CI runners: not checked')
    expect(host.textContent).not.toContain('Reading CI…')
    act(() => row.querySelector('button')!.click())
    expect(onRetry).toHaveBeenCalledTimes(1)
    // The clock starts again: the spinner is back until the timeout passes again.
    expect(host.textContent).toContain('Reading CI…')
    act(() => vi.advanceTimersByTime(CI_READ_TIMEOUT_MS))
    expect(host.querySelector('[data-testid="nc"]')).not.toBeNull()
  })

  it('draws nothing once the read has answered, even after it timed out', () => {
    draw(true, () => {})
    act(() => vi.advanceTimersByTime(CI_READ_TIMEOUT_MS))
    draw(false, () => {})
    expect(host.textContent).toBe('')
  })
})
