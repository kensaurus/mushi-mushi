/**
 * FILE: packages/react-native/src/__tests__/session-tracker.test.ts
 * PURPOSE: Unit tests for the React Native session tracker — lifecycle from
 *          AppState, screen page views, session rotation and the consent gate
 *          it shares with the product-events tracker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MushiApiClient, MushiSessionEventPayload } from '@mushi-mushi/core'
import { createRNSessionTracker, RESUME_WINDOW_MS } from '../analytics/session-tracker'
import { createRNEventTracker } from '../analytics/event-tracker'
import type { AsyncStorageLike } from '../storage/secure-storage'

function makeClient() {
  const sent: MushiSessionEventPayload[] = []
  const postSessionEvent = vi.fn(async (payload: MushiSessionEventPayload) => {
    sent.push(payload)
    return { ok: true, data: { accepted: true } }
  })
  const postProductEvents = vi.fn(async () => ({ ok: true, data: { accepted: 0, dropped: 0 } }))
  const client = { postSessionEvent, postProductEvents } as unknown as MushiApiClient
  return { client, sent, postSessionEvent }
}

function makeStorage(seed: Record<string, string> = {}): AsyncStorageLike {
  const map = new Map(Object.entries(seed))
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v)
    },
    removeItem: async (k) => {
      map.delete(k)
    },
  }
}

function setup(opts: { consent?: 'required'; enabled?: boolean; storage?: AsyncStorageLike } = {}) {
  const { client, sent, postSessionEvent } = makeClient()
  let clock = Date.parse('2026-09-21T10:00:00Z')
  let screen = 'Home'
  const events = createRNEventTracker({
    projectId: 'p1',
    client,
    getAnonId: () => 'mushi_anon',
    config: { consent: opts.consent, enabled: opts.enabled },
    storage: async () => opts.storage ?? null,
  })
  const sessions = createRNSessionTracker({
    client,
    getReporterToken: async () => 'mushi_anon',
    getRoute: () => screen,
    consent: events,
    sessionId: 'sess_launch',
    sdkVersion: '0.21.0',
    userAgent: '@mushi-mushi/react-native/0.21.0 (ios 17.5)',
    now: () => clock,
  })
  return {
    events,
    sessions,
    sent,
    postSessionEvent,
    kinds: () => sent.map((p) => p.kind),
    advanceClock: (ms: number) => {
      clock += ms
    },
    setScreen: (name: string) => {
      screen = name
      sessions.pageView(name)
    },
  }
}

describe('createRNSessionTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts a session on mount with the launch id, token, route and user agent', async () => {
    const t = setup()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.kinds()).toEqual(['session_start'])
    const start = t.sent[0]!
    expect(start.session_id).toBe('sess_launch')
    expect(start.reporter_token_hash).toBe('mushi_anon')
    expect(start.route).toBe('Home')
    expect(start.page_view_count).toBe(1)
    expect(start.user_agent).toBe('@mushi-mushi/react-native/0.21.0 (ios 17.5)')
    t.sessions.destroy()
    await t.events.destroy()
  })

  it('heartbeats every minute, counts screens, and ends on background', async () => {
    const t = setup()
    await vi.advanceTimersByTimeAsync(60_000)
    t.setScreen('Checkout')
    await vi.advanceTimersByTimeAsync(0)
    t.sessions.onAppStateChange('inactive')
    t.sessions.onAppStateChange('background')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(t.kinds()).toEqual(['session_start', 'session_heartbeat', 'page_view', 'session_end'])
    expect(t.sent[2]!.route).toBe('Checkout')
    expect(t.sent[2]!.page_view_count).toBe(2)
    t.sessions.destroy()
    await t.events.destroy()
  })

  it('continues the session after a short background and rotates it after a long one', async () => {
    const t = setup()
    await vi.advanceTimersByTimeAsync(0)
    t.sessions.onAppStateChange('background')
    t.advanceClock(5 * 60_000)
    t.sessions.onAppStateChange('active')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.kinds()).toEqual(['session_start', 'session_end', 'session_heartbeat'])
    expect(new Set(t.sent.map((p) => p.session_id))).toEqual(new Set(['sess_launch']))

    t.sessions.onAppStateChange('background')
    t.advanceClock(RESUME_WINDOW_MS)
    t.sessions.onAppStateChange('active')
    await vi.advanceTimersByTimeAsync(0)
    const last = t.sent[t.sent.length - 1]!
    expect(last.kind).toBe('session_start')
    expect(last.session_id).not.toBe('sess_launch')
    t.sessions.destroy()
    await t.events.destroy()
  })

  it("sends nothing under consent 'required' until granted, then stops again on denial", async () => {
    const t = setup({ consent: 'required', storage: makeStorage() })
    await vi.advanceTimersByTimeAsync(120_000)
    t.setScreen('Settings')
    expect(t.postSessionEvent).not.toHaveBeenCalled()

    t.events.setConsent('granted')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.kinds()).toEqual(['session_start'])

    t.events.setConsent('denied')
    t.setScreen('Profile')
    t.sessions.onAppStateChange('background')
    await vi.advanceTimersByTimeAsync(180_000)
    expect(t.kinds()).toEqual(['session_start'])
    t.sessions.destroy()
    await t.events.destroy()
  })

  it('honours a persisted denial and analytics.enabled:false', async () => {
    const denied = setup({ storage: makeStorage({ '@mushi:analytics_consent_p1': 'denied' }) })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(denied.postSessionEvent).not.toHaveBeenCalled()
    denied.sessions.destroy()
    await denied.events.destroy()

    const disabled = setup({ enabled: false })
    await vi.advanceTimersByTimeAsync(120_000)
    // A grant cannot switch on what the host disabled.
    disabled.events.setConsent('granted')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(disabled.postSessionEvent).not.toHaveBeenCalled()
    disabled.sessions.destroy()
    await disabled.events.destroy()
  })

  it('sends nothing after destroy', async () => {
    const t = setup()
    await vi.advanceTimersByTimeAsync(0)
    t.sessions.destroy()
    t.setScreen('Late')
    t.sessions.onAppStateChange('background')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(t.kinds()).toEqual(['session_start'])
    await t.events.destroy()
  })
})

describe('createRNEventTracker consent surface', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not let an early identify out before a persisted denial has been read', async () => {
    const { client } = makeClient()
    const storage = makeStorage({ '@mushi:analytics_consent_p1': 'denied' })
    const tracker = createRNEventTracker({ projectId: 'p1', client, getAnonId: () => 'a', storage: async () => storage })
    tracker.setIdentity('user-1', { email: 'person@example.com' })
    await tracker.ready
    await tracker.flush()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(client.postProductEvents).not.toHaveBeenCalled()
    expect(tracker.consentState()).toBe('denied')
    await tracker.destroy()
  })

  it("holds identify under 'required' and drops it on denial", async () => {
    const { client } = makeClient()
    const tracker = createRNEventTracker({
      projectId: 'p1',
      client,
      getAnonId: () => 'a',
      config: { consent: 'required' },
      storage: async () => null,
    })
    await tracker.ready
    tracker.setIdentity('user-1', { name: 'Person' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(client.postProductEvents).not.toHaveBeenCalled()
    tracker.setConsent('denied')
    tracker.setConsent('granted')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(client.postProductEvents).not.toHaveBeenCalled()
    await tracker.destroy()
  })

  it('reports disabled analytics as denied', async () => {
    const { client } = makeClient()
    const tracker = createRNEventTracker({
      projectId: 'p1',
      client,
      getAnonId: () => 'a',
      config: { enabled: false },
      storage: async () => null,
    })
    await tracker.ready
    expect(tracker.consentState()).toBe('denied')
    await tracker.destroy()
  })
})
