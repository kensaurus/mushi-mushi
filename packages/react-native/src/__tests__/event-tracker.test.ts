/**
 * FILE: packages/react-native/src/__tests__/event-tracker.test.ts
 * PURPOSE: Unit tests for the React Native product-events batcher behind
 *          `useMushi().track()` — batching, surface, spill, consent, validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MushiApiClient, MushiProductEventPayload } from '@mushi-mushi/core'
import { createRNEventTracker } from '../analytics/event-tracker'
import type { AsyncStorageLike } from '../storage/secure-storage'

function makeClient(ok = true) {
  const payloads: MushiProductEventPayload[] = []
  const postProductEvents = vi.fn(async (payload: MushiProductEventPayload) => {
    payloads.push(payload)
    return ok
      ? { ok: true, data: { accepted: payload.events.length, dropped: 0 } }
      : { ok: false, error: { code: 'DOWN', message: 'nope' } }
  })
  const client = { postProductEvents } as unknown as MushiApiClient
  return { client, payloads, postProductEvents }
}

function makeStorage(seed: Record<string, string> = {}): AsyncStorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v)
    },
    removeItem: async (k) => {
      map.delete(k)
    },
  }
}

describe('createRNEventTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches, then posts on the interval with surface mobile, anon id and $route', async () => {
    const { client, payloads, postProductEvents } = makeClient()
    const tracker = createRNEventTracker({
      projectId: 'p1',
      client,
      getAnonId: async () => 'mushi_anon',
      getRoute: () => 'Checkout',
      sdkVersion: '0.21.0',
      storage: async () => null,
    })
    await tracker.ready
    expect(tracker.track('checkout_started', { plan: 'pro', email: 'x@y.z' })).toBe(true)
    expect(postProductEvents).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(postProductEvents).toHaveBeenCalledTimes(1)
    const p = payloads[0]!
    expect(p.surface).toBe('mobile')
    expect(p.anon_id).toBe('mushi_anon')
    expect(p.sdk_version).toBe('0.21.0')
    expect(p.events).toHaveLength(1)
    expect(p.events[0]!.name).toBe('checkout_started')
    expect(p.events[0]!.properties).toMatchObject({ plan: 'pro', $surface: 'mobile', $route: 'Checkout' })
    expect(p.events[0]!.properties?.email).toBeUndefined()
    await tracker.destroy()
  })

  it('drops invalid names and reserved keys from host properties', async () => {
    const { client } = makeClient()
    const tracker = createRNEventTracker({ projectId: 'p1', client, getAnonId: () => 'a', storage: async () => null })
    await tracker.ready
    expect(tracker.track('Bad Name')).toBe(false)
    expect(tracker.track('ok_event', { $surface: 'web', keep: 1 })).toBe(true)
    await tracker.flush()
    const call = (client.postProductEvents as ReturnType<typeof vi.fn>).mock.calls[0]![0] as MushiProductEventPayload
    expect(call.events[0]!.properties).toMatchObject({ keep: 1, $surface: 'mobile' })
    await tracker.destroy()
  })

  it('flushes immediately at the client batch cap', async () => {
    const { client, postProductEvents } = makeClient()
    const tracker = createRNEventTracker({ projectId: 'p1', client, getAnonId: () => 'a', storage: async () => null })
    await tracker.ready
    for (let i = 0; i < 20; i += 1) tracker.track('tap')
    await vi.advanceTimersByTimeAsync(0)
    expect(postProductEvents).toHaveBeenCalledTimes(1)
    await tracker.destroy()
  })

  it('spills unsent batches to storage and replays them on the next launch', async () => {
    const storage = makeStorage()
    const down = makeClient(false)
    const t1 = createRNEventTracker({ projectId: 'p1', client: down.client, getAnonId: () => 'a', storage: async () => storage })
    await t1.ready
    t1.track('purchase_completed', { amount: 3 })
    await t1.flush()
    expect(storage.map.get('@mushi:events_spill_p1')).toContain('purchase_completed')
    await t1.destroy()

    const up = makeClient(true)
    const t2 = createRNEventTracker({ projectId: 'p1', client: up.client, getAnonId: () => 'a', storage: async () => storage })
    await t2.ready
    await t2.flush()
    expect(up.postProductEvents).toHaveBeenCalledTimes(1)
    expect(up.payloads[0]!.events.map((e) => e.name)).toEqual(['purchase_completed'])
    expect(storage.map.has('@mushi:events_spill_p1')).toBe(false)
    await t2.destroy()
  })

  it("consent 'required' buffers until granted, persists the answer, and 'denied' drops everything", async () => {
    const storage = makeStorage()
    const { client, postProductEvents, payloads } = makeClient()
    const tracker = createRNEventTracker({
      projectId: 'p1',
      client,
      getAnonId: () => 'a',
      config: { consent: 'required' },
      storage: async () => storage,
    })
    await tracker.ready
    expect(tracker.track('signup_completed', { signup_source: 'hn' })).toBe(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(postProductEvents).not.toHaveBeenCalled()

    tracker.setConsent('granted')
    await vi.advanceTimersByTimeAsync(0)
    expect(postProductEvents).toHaveBeenCalledTimes(1)
    expect(payloads[0]!.events[0]!.name).toBe('signup_completed')
    await vi.advanceTimersByTimeAsync(0)
    expect(storage.map.get('@mushi:analytics_consent_p1')).toBe('granted')

    tracker.setConsent('denied')
    tracker.track('after_denial')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(postProductEvents).toHaveBeenCalledTimes(1)
    await tracker.destroy()
  })

  it('honours a persisted denial even in implied mode', async () => {
    const storage = makeStorage({ '@mushi:analytics_consent_p1': 'denied' })
    const { client, postProductEvents } = makeClient()
    const tracker = createRNEventTracker({ projectId: 'p1', client, getAnonId: () => 'a', storage: async () => storage })
    tracker.track('early')
    await tracker.ready
    tracker.track('late')
    await tracker.flush()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(postProductEvents).not.toHaveBeenCalled()
    await tracker.destroy()
  })

  it('is a no-op when analytics is disabled', async () => {
    const { client, postProductEvents } = makeClient()
    const tracker = createRNEventTracker({
      projectId: 'p1',
      client,
      getAnonId: () => 'a',
      config: { enabled: false },
      storage: async () => null,
    })
    expect(tracker.track('anything')).toBe(false)
    await tracker.flush()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(postProductEvents).not.toHaveBeenCalled()
    await tracker.destroy()
  })

  it('setIdentity sends an identify marker with user_id and traits', async () => {
    const { client, payloads } = makeClient()
    const tracker = createRNEventTracker({ projectId: 'p1', client, getAnonId: () => 'a', storage: async () => null })
    await tracker.ready
    tracker.setIdentity('user-7', { plan: 'pro' })
    await vi.advanceTimersByTimeAsync(0)
    expect(payloads[0]!.user_id).toBe('user-7')
    expect(payloads[0]!.user_traits).toEqual({ plan: 'pro' })
    expect(payloads[0]!.events[0]!.name).toBe('identify')
    await tracker.destroy()
  })
})
