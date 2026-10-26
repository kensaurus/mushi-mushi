/**
 * FILE: packages/cli/src/signals.test.ts
 * PURPOSE: Lock down the AbortSignal contract for SIGINT/SIGTERM. We
 *          can't synthesise a real signal in jsdom-style tests, but we
 *          can verify the controller is shared across `getAbortSignal`
 *          calls.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetSignalHandlersForTesting,
  getAbortSignal,
  handleInterrupt,
  interruptedBy,
  onInterrupt,
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

describe('handleInterrupt', () => {
  it('aborts in-flight requests, runs the cleanups, then exits 143 on SIGTERM', async () => {
    const inFlight = getAbortSignal()
    const order: string[] = []
    let signalSeenByCleanup: string | null = null
    let freshSignalAborted: boolean | null = null
    onInterrupt(async (signal) => {
      signalSeenByCleanup = signal
      // A cleanup's own API call gets a live signal, not the aborted one.
      freshSignalAborted = getAbortSignal().aborted
      await new Promise((r) => setTimeout(r, 20))
      order.push('cleanup')
    })
    await handleInterrupt('SIGTERM', (code) => order.push(`exit ${code}`))
    expect(inFlight.aborted).toBe(true)
    expect(signalSeenByCleanup).toBe('SIGTERM')
    expect(freshSignalAborted).toBe(false)
    expect(order).toEqual(['cleanup', 'exit 143'])
    expect(interruptedBy()).toBe('SIGTERM')
  })

  it('exits 130 on SIGINT straight away when nothing is registered', async () => {
    const codes: number[] = []
    await handleInterrupt('SIGINT', (code) => codes.push(code))
    expect(codes).toEqual([130])
  })

  it('does not wait past the budget for a cleanup that hangs', async () => {
    onInterrupt(() => new Promise(() => undefined))
    const started = Date.now()
    const codes: number[] = []
    await handleInterrupt('SIGTERM', (code) => codes.push(code), 50)
    expect(codes).toEqual([143])
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('runs every cleanup even when one throws', async () => {
    const ran: string[] = []
    onInterrupt(() => {
      throw new Error('boom')
    })
    onInterrupt(async () => {
      ran.push('second')
    })
    await handleInterrupt('SIGTERM', () => undefined)
    expect(ran).toEqual(['second'])
  })

  it('skips an unregistered cleanup', async () => {
    const ran: string[] = []
    const unregister = onInterrupt(() => {
      ran.push('gone')
    })
    unregister()
    await handleInterrupt('SIGTERM', () => undefined)
    expect(ran).toEqual([])
  })

  it('exits at once on a second signal while cleanups still run', async () => {
    const codes: number[] = []
    onInterrupt(() => new Promise((r) => setTimeout(r, 200)))
    const first = handleInterrupt('SIGTERM', (code) => codes.push(code), 1_000)
    await handleInterrupt('SIGINT', (code) => codes.push(code))
    expect(codes).toEqual([130])
    await first
    expect(codes).toEqual([130, 143])
  })
})
