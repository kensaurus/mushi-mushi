/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/lib/useVisiblePolling.test.tsx
 * PURPOSE: The Health page polls cron health with this hook (cron_runs left
 *          the Realtime publication, 2026-11-11). A reload callback that
 *          changes on every render must not restart the timer, or the poll
 *          never fires; a hidden tab must not poll.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisiblePolling } from './useVisiblePolling'

let root: Root | null = null
let host: HTMLDivElement | null = null
let visibility: DocumentVisibilityState = 'visible'

function Probe({ onTick, ms }: { onTick: () => void; ms: number }) {
  // A fresh closure every render, like HealthPage's reloadAll.
  useVisiblePolling(() => onTick(), ms)
  return null
}

function render(onTick: () => void, ms = 1000) {
  act(() => root!.render(createElement(Probe, { onTick, ms })))
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.useRealTimers()
})

describe('useVisiblePolling', () => {
  it('keeps its interval when the callback changes on every render', () => {
    const onTick = vi.fn()
    render(onTick)
    for (let i = 0; i < 5; i++) {
      act(() => vi.advanceTimersByTime(300))
      render(onTick) // re-render with a new closure before the interval is due
    }
    expect(onTick).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1000))
    expect(onTick).toHaveBeenCalledTimes(2)
  })

  it('stops while the tab is hidden and reloads once on coming back', () => {
    const onTick = vi.fn()
    render(onTick)
    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    act(() => vi.advanceTimersByTime(5000))
    expect(onTick).not.toHaveBeenCalled()
    visibility = 'visible'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(onTick).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1000))
    expect(onTick).toHaveBeenCalledTimes(2)
  })
})
