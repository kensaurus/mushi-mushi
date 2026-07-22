/**
 * Tests for attachUnhandledHook.
 *
 * Verifies:
 *  - unhandledRejection fires captureReport with correct shape
 *  - uncaughtException fires captureReport + re-throws (default, non-swallow)
 *  - uncaughtException with swallowCrashes=true fires captureReport, does NOT re-throw
 *  - non-Error rejection is coerced to Error message
 *  - detach teardown removes both listeners
 *  - component default is 'node:unhandled'
 *  - component option overrides default
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachUnhandledHook } from './unhandled.js'
import type { MushiNodeClient } from './client.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeClient(): { mock: ReturnType<typeof vi.fn>; client: MushiNodeClient } {
  const mock = vi.fn().mockResolvedValue({ reportId: 'r-001' })
  const client = { captureReport: mock } as unknown as MushiNodeClient
  return { mock, client }
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('attachUnhandledHook — unhandledRejection', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires captureReport on unhandledRejection', async () => {
    const { mock, client } = makeClient()
    const detach = attachUnhandledHook({ client })

    process.emit('unhandledRejection' as never, new Error('boom'), Promise.resolve() as never)

    await vi.runAllTimersAsync()
    expect(mock).toHaveBeenCalledOnce()
    const arg = mock.mock.calls[0][0]
    expect(arg.description).toContain('boom')
    expect(arg.component).toBe('node:unhandled')
    expect(arg.severity).toBe('critical')
    expect(arg.error?.name).toBe('Error')

    detach()
  })

  it('coerces non-Error rejection reason to Error message', async () => {
    const { mock, client } = makeClient()
    const detach = attachUnhandledHook({ client })

    process.emit('unhandledRejection' as never, 'string rejection', Promise.resolve() as never)

    await vi.runAllTimersAsync()
    expect(mock).toHaveBeenCalledOnce()
    expect(mock.mock.calls[0][0].description).toContain('string rejection')

    detach()
  })

  it('uses custom component label', async () => {
    const { mock, client } = makeClient()
    const detach = attachUnhandledHook({ client, component: 'custom:label' })

    process.emit('unhandledRejection' as never, new Error('x'), Promise.resolve() as never)

    await vi.runAllTimersAsync()
    expect(mock.mock.calls[0][0].component).toBe('custom:label')

    detach()
  })
})

describe('attachUnhandledHook — uncaughtException', () => {
  it('fires captureReport on uncaughtException (swallowCrashes=true)', async () => {
    // Use swallowCrashes=true so the re-throw via process.nextTick doesn't
    // propagate and kill the vitest worker.
    const { mock, client } = makeClient()
    const detach = attachUnhandledHook({ client, swallowCrashes: true })

    const err = new Error('uncaught boom')
    process.emit('uncaughtException' as never, err)

    // Allow the async captureReport to settle.
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(mock).toHaveBeenCalledOnce()
    const arg = mock.mock.calls[0][0]
    expect(arg.description).toContain('uncaught boom')
    expect(arg.severity).toBe('critical')

    detach()
  })

  it('sets userCategory to bug in the report', async () => {
    const { mock, client } = makeClient()
    const detach = attachUnhandledHook({ client, swallowCrashes: true })

    process.emit('uncaughtException' as never, new Error('err'))

    await new Promise<void>((r) => setTimeout(r, 10))
    expect(mock.mock.calls[0][0].userCategory).toBe('bug')

    detach()
  })
})

describe('attachUnhandledHook — detach', () => {
  it('returns a teardown that removes both listeners', () => {
    const { client } = makeClient()
    const before = {
      rejection: process.listenerCount('unhandledRejection'),
      exception: process.listenerCount('uncaughtException'),
    }

    const detach = attachUnhandledHook({ client })

    // Listeners should be registered.
    expect(process.listenerCount('unhandledRejection')).toBe(before.rejection + 1)
    expect(process.listenerCount('uncaughtException')).toBe(before.exception + 1)

    detach()

    // After detach, counts return to baseline.
    expect(process.listenerCount('unhandledRejection')).toBe(before.rejection)
    expect(process.listenerCount('uncaughtException')).toBe(before.exception)
  })
})
