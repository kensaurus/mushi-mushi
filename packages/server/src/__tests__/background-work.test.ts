/**
 * FILE: packages/server/src/__tests__/background-work.test.ts
 * PURPOSE: Fire-and-forget writes must be registered with
 *          EdgeRuntime.waitUntil, or the isolate can shut down under them.
 *
 * Why (2026-09-21): nine `void emitProductEvent(...)` call sites and three
 * un-awaited IIFEs in api/helpers.ts relied on the isolate outliving the
 * response. Low-traffic functions (stripe-webhooks, mcp) are the ones most
 * likely to be torn down right after responding, and the company funnel's
 * fix_pulled / project_created counts are exactly those emits.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn, error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})

type Settle = (value: { error: null }) => void

function deferredDb() {
  let settle: Settle = () => {}
  const pending = new Promise<{ error: null }>((r) => {
    settle = r
  })
  const db = {
    from: vi.fn(() => ({ insert: vi.fn(() => pending) })),
    rpc: vi.fn(() => pending),
  }
  return { db, settle: (v: { error: null }) => settle(v) }
}

let keepAlive: typeof import('../../supabase/functions/_shared/background.ts').keepAlive
let runInBackground: typeof import('../../supabase/functions/_shared/background.ts').runInBackground
let emitProductEvent: typeof import('../../supabase/functions/_shared/product-events.ts').emitProductEvent
let emitFunnelEvent: typeof import('../../supabase/functions/_shared/setup-funnel.ts').emitFunnelEvent

beforeAll(async () => {
  // product-events.ts reads MUSHI_SELF_PROJECT_ID at module load.
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => (key === 'MUSHI_SELF_PROJECT_ID' ? '00000000-0000-4000-8000-000000000001' : undefined) },
  })
  ;({ keepAlive, runInBackground } = await import('../../supabase/functions/_shared/background.ts'))
  ;({ emitProductEvent } = await import('../../supabase/functions/_shared/product-events.ts'))
  ;({ emitFunnelEvent } = await import('../../supabase/functions/_shared/setup-funnel.ts'))
})

afterEach(() => {
  delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime
  warn.mockClear()
})

function stubEdgeRuntime() {
  const waitUntil = vi.fn()
  ;(globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { waitUntil }
  return waitUntil
}

describe('keepAlive / runInBackground', () => {
  it('registers the work with EdgeRuntime.waitUntil and hands the promise back', async () => {
    const waitUntil = stubEdgeRuntime()
    const work = Promise.resolve(42)
    expect(keepAlive(work)).toBe(work)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await expect(work).resolves.toBe(42)
  })

  it('is a plain pass-through outside the Edge runtime', async () => {
    await expect(keepAlive(Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('logs a failed background task instead of leaking an unhandled rejection', async () => {
    const waitUntil = stubEdgeRuntime()
    runInBackground(Promise.reject(new Error('db down')), 'unit-test')
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await (waitUntil.mock.calls[0][0] as Promise<unknown>)
    expect(warn).toHaveBeenCalledWith('background task failed', { task: 'unit-test', err: 'db down' })
  })
})

describe('funnel emitters keep their write alive when the caller drops the promise', () => {
  it('emitProductEvent', async () => {
    const waitUntil = stubEdgeRuntime()
    const { db, settle } = deferredDb()
    // Call sites do `void emitProductEvent(...)`: the registration must happen
    // before the insert settles, inside the call itself.
    const pending = emitProductEvent(db as never, {
      eventName: 'project_created',
      surface: 'server',
      properties: { project_id: 'p1' },
    })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    settle({ error: null })
    await expect(pending).resolves.toBe(true)
  })

  it('emitFunnelEvent', async () => {
    const waitUntil = stubEdgeRuntime()
    const { db, settle } = deferredDb()
    const pending = emitFunnelEvent(db as never, {
      userId: 'u1',
      projectId: 'p1',
      eventName: 'wizard_env_written',
      dedupKey: 'k1',
    })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    settle({ error: null })
    await expect(pending).resolves.toBeUndefined()
  })
})

describe('api/helpers.ts background work', () => {
  it('has no bare `void (async () => …)()` left — every IIFE goes through runInBackground', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/helpers.ts'), 'utf8')
    expect(src).not.toMatch(/void \(async \(\) =>/)
    // first_report_received, end_user linkage, usage meter, circuit-breaker alert
    expect(src.match(/runInBackground\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })
})
