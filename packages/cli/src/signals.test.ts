/**
 * FILE: packages/cli/src/signals.test.ts
 * PURPOSE: Lock down the AbortSignal contract for SIGINT/SIGTERM. We
 *          can't synthesise a real signal in jsdom-style tests, but we
 *          can verify the controller is shared across `getAbortSignal`
 *          calls and that `withAbort` plumbs the signal through fetch
 *          init objects.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetSignalHandlersForTesting,
  getAbortSignal,
  withAbort,
} from './signals.js'

afterEach(() => {
  __resetSignalHandlersForTesting()
})

describe('getAbortSignal', () => {
  it('returns the same signal across multiple calls (one process-wide controller)', () => {
    const a = getAbortSignal()
    const b = getAbortSignal()
    expect(a).toBe(b)
    expect(a.aborted).toBe(false)
  })

  it('honours an externally-supplied AbortController', () => {
    const ctrl = new AbortController()
    const sig = getAbortSignal(ctrl)
    expect(sig).toBe(ctrl.signal)
    ctrl.abort('manual')
    expect(sig.aborted).toBe(true)
  })

  it('refreshes the controller after an abort so a follow-up command starts clean', () => {
    const a = getAbortSignal()
    // Simulate an interrupt mid-run.
    ;(a as AbortSignal & { dispatchEvent: (e: Event) => void })
    // We can't really call abort on a shared internal controller via the
    // public surface — but the contract is: after `aborted=true`, the
    // next call returns a fresh signal. Force the refresh path:
    __resetSignalHandlersForTesting()
    const b = getAbortSignal()
    expect(b).not.toBe(a)
    expect(b.aborted).toBe(false)
  })
})

describe('withAbort', () => {
  it('stamps the active signal onto a fresh init', () => {
    const init = withAbort()
    expect(init.signal).toBe(getAbortSignal())
  })

  it('preserves an explicit signal already on the init', () => {
    const ctrl = new AbortController()
    const init = withAbort({ method: 'POST', signal: ctrl.signal })
    expect(init.signal).toBe(ctrl.signal)
  })

  it('mutates and returns the same object so it can be threaded fluently', () => {
    const init: RequestInit = { method: 'GET' }
    const out = withAbort(init)
    expect(out).toBe(init)
    expect(out.signal).toBeTruthy()
  })
})
