/**
 * FILE: packages/react-native/src/analytics/event-tracker.ts
 * PURPOSE: Product-analytics batcher behind `useMushi().track()` on React Native.
 *
 * OVERVIEW:
 * - The core tracker (`@mushi-mushi/core` event-tracker.ts) returns early
 *   without `window`, so RN gets this minimal port: in-memory batch, interval
 *   flush, explicit `flush()` for app-background, AsyncStorage spill for
 *   unsent batches (cap 200 / 24 h) and persisted consent.
 * - Validation and PII rules are the shared ones from core
 *   (`isValidEventName`, `sanitizeEventProperties`, `propertiesWithinByteLimit`).
 * - Transport is `MushiApiClient.postProductEvents()` — the same
 *   POST /v1/sdk/events the web SDK uses; `surface` is `'mobile'`.
 *
 * DEPENDENCIES:
 * - @mushi-mushi/core — validation helpers + wire types.
 * - @react-native-async-storage/async-storage — optional peer; without it the
 *   batch is memory-only and consent is per-launch.
 *
 * USAGE:
 * - Created by MushiProvider; hosts call `useMushi().track(name, props)`.
 * - No React import here so the module is unit-testable with fake timers.
 *
 * NOTES:
 * - No DNT signal exists on native; `analytics.enabled:false` or
 *   `analytics.consent:'required'` + `setConsent('denied')` are the off switches.
 *   App Tracking Transparency prompts remain the host's responsibility.
 */

import {
  EVENT_PROPERTY_LIMITS,
  isValidEventName,
  propertiesWithinByteLimit,
  sanitizeEventProperties,
  type MushiAnalyticsConfig,
  type MushiApiClient,
  type MushiEventProperties,
  type MushiProductEventPayload,
} from '@mushi-mushi/core'
import type { AsyncStorageLike } from '../storage/secure-storage'

/** The subset of the web `analytics` block that applies on native. */
export type RNAnalyticsConfig = Pick<
  MushiAnalyticsConfig,
  'enabled' | 'consent' | 'flushIntervalMs' | 'propertyAllowlist'
>

export interface RNEventTrackerOptions {
  projectId: string
  /** Resolved lazily so the provider can hand over the client after mount. */
  client: MushiApiClient | null | (() => MushiApiClient | null)
  /** Per-install reporter token; may resolve asynchronously (SecureStore load). */
  getAnonId: () => string | null | Promise<string | null>
  getUserId?: () => string | null
  getUserTraits?: () => Record<string, unknown> | null
  /** Current screen, attached as the reserved `$route` property. */
  getRoute?: () => string | null
  sdkVersion?: string
  config?: RNAnalyticsConfig
  /** PII scrubber for string values (the provider passes core's scrubPii). */
  scrub?: (s: string) => string
  /** AsyncStorage loader; defaults to the optional peer dependency. */
  storage?: () => Promise<AsyncStorageLike | null>
}

export interface RNEventTracker {
  /** Queue an event. Returns true when accepted (valid name, tracking on, consent not denied). */
  track(
    name: string,
    properties?: Record<string, unknown>,
    opts?: { dedupKey?: string; reserved?: MushiEventProperties },
  ): boolean
  /** Grant or deny consent; persisted in AsyncStorage when available. */
  setConsent(state: 'granted' | 'denied'): void
  /** Stitch anonymous history to a person (called from identify / setUser). */
  setIdentity(userId: string | null, traits?: Record<string, unknown> | null): void
  /** Send whatever is queued now (app background, tests). Never rejects. */
  flush(): Promise<void>
  /** Stop the interval, flush once, forget state. */
  destroy(): Promise<void>
  /** Resolves once persisted consent and the previous spill have been read. */
  ready: Promise<void>
  /**
   * Current consent: 'granted' | 'denied' | 'pending'. Read it after `ready`
   * so a persisted choice has been applied. Always 'denied' when analytics is
   * disabled, which keeps the session tracker behind the same switch.
   */
  consentState(): 'granted' | 'denied' | 'pending'
  /** Follow setConsent() decisions (the session tracker uses this). Returns unsubscribe. */
  onConsentChange(listener: (state: 'granted' | 'denied') => void): () => void
}

type BufferedEvent = MushiProductEventPayload['events'][number]

const CONSENT_BUFFER_MAX = 50
const SPILL_MAX = 200
const SPILL_TTL_MS = 24 * 60 * 60 * 1000
const SURFACE = 'mobile' as const

async function defaultStorage(): Promise<AsyncStorageLike | null> {
  try {
    const mod = await import('@react-native-async-storage/async-storage')
    return mod.default
  } catch {
    return null
  }
}

export function createRNEventTracker(opts: RNEventTrackerOptions): RNEventTracker {
  const cfg = opts.config ?? {}
  const enabled = cfg.enabled !== false
  const consentMode = cfg.consent ?? 'implied'
  const allowlist = cfg.propertyAllowlist ?? []
  const spillKey = `@mushi:events_spill_${opts.projectId}`
  const consentKey = `@mushi:analytics_consent_${opts.projectId}`

  let buffer: BufferedEvent[] = []
  let consentBuffer: BufferedEvent[] = []
  let consent: 'granted' | 'denied' | 'pending' = consentMode === 'required' ? 'pending' : 'granted'
  let userId: string | null = null
  let userTraits: Record<string, unknown> | null = null
  let pendingIdentify = false
  let flushing = false
  let destroyed = false
  let timer: ReturnType<typeof setInterval> | null = null
  let storage: AsyncStorageLike | null = null
  const consentListeners = new Set<(state: 'granted' | 'denied') => void>()

  const loadStorage = opts.storage ?? defaultStorage
  const resolveClient = (): MushiApiClient | null =>
    typeof opts.client === 'function' ? opts.client() : opts.client

  async function readSpill(): Promise<BufferedEvent[]> {
    if (!storage) return []
    try {
      const raw = await storage.getItem(spillKey)
      if (!raw) return []
      const parsed = JSON.parse(raw) as { at: number; events: BufferedEvent[] }
      if (!parsed || Date.now() - parsed.at > SPILL_TTL_MS) {
        await storage.removeItem(spillKey)
        return []
      }
      return Array.isArray(parsed.events) ? parsed.events.slice(0, SPILL_MAX) : []
    } catch {
      return []
    }
  }

  async function writeSpill(events: BufferedEvent[]): Promise<void> {
    if (!storage) return
    try {
      if (events.length === 0) await storage.removeItem(spillKey)
      else await storage.setItem(spillKey, JSON.stringify({ at: Date.now(), events: events.slice(-SPILL_MAX) }))
    } catch {
      /* storage unavailable or full */
    }
  }

  async function flushNow(): Promise<void> {
    if (destroyed && buffer.length === 0) return
    // A persisted denial is read asynchronously; until it has been, 'implied'
    // mode looks granted. Wait so an early identify() cannot slip out first.
    await ready
    if (flushing || consent !== 'granted') return
    if (buffer.length === 0 && !pendingIdentify) return
    const client = resolveClient()
    if (!client) return
    flushing = true
    const batch = buffer.splice(0, EVENT_PROPERTY_LIMITS.maxServerBatch)
    if (pendingIdentify) {
      batch.unshift({ name: 'identify', ts: new Date().toISOString(), properties: {} })
      pendingIdentify = false
    }
    try {
      const anonId = await Promise.resolve(opts.getAnonId())
      const payload: MushiProductEventPayload = {
        anon_id: anonId,
        user_id: userId ?? opts.getUserId?.() ?? null,
        user_traits: userTraits ?? opts.getUserTraits?.() ?? null,
        session_id: null,
        sdk_version: opts.sdkVersion ?? null,
        surface: SURFACE,
        events: batch,
      }
      const res = await client.postProductEvents(payload)
      if (!res.ok) await writeSpill([...(await readSpill()), ...batch.filter((e) => e.name !== 'identify')])
      else await writeSpill([])
    } catch {
      await writeSpill([...(await readSpill()), ...batch.filter((e) => e.name !== 'identify')])
    } finally {
      flushing = false
    }
    if (buffer.length >= EVENT_PROPERTY_LIMITS.maxClientBatch) void flushNow()
  }

  function enqueue(ev: BufferedEvent): void {
    if (consent === 'denied') return
    if (consent === 'pending') {
      if (consentBuffer.length < CONSENT_BUFFER_MAX) consentBuffer.push(ev)
      return
    }
    buffer.push(ev)
    if (buffer.length >= EVENT_PROPERTY_LIMITS.maxClientBatch) void flushNow()
  }

  const ready: Promise<void> = enabled
    ? (async () => {
        storage = await loadStorage()
        if (destroyed) return
        // Persisted consent beats the mode default; a stored 'denied' also
        // silences 'implied' mode.
        let stored: string | null = null
        try {
          stored = storage ? await storage.getItem(consentKey) : null
        } catch {
          stored = null
        }
        if (stored === 'denied') {
          consent = 'denied'
          buffer = []
          consentBuffer = []
          pendingIdentify = false
          await writeSpill([])
          return
        }
        if (stored === 'granted' && consent === 'pending') {
          consent = 'granted'
          buffer.push(...consentBuffer)
          consentBuffer = []
        }
        // Take the spill: clearing the stored copy means a failed retry
        // re-spills each event once instead of duplicating the replayed batch.
        const spill = await readSpill()
        if (spill.length > 0) {
          buffer.unshift(...spill)
          await writeSpill([])
        }
      })().catch(() => undefined)
    : Promise.resolve()

  if (enabled) {
    const interval = Math.max(1_000, cfg.flushIntervalMs ?? 5_000)
    timer = setInterval(() => {
      void flushNow()
    }, interval)
  }

  return {
    ready,
    track(name, properties, trackOpts) {
      if (!enabled || destroyed) return false
      if (!isValidEventName(name)) return false
      const { properties: props } = sanitizeEventProperties(properties, { allowlist: allowlist, scrub: opts.scrub })
      let merged: MushiEventProperties = props
      if (trackOpts?.reserved) {
        const { properties: res } = sanitizeEventProperties(trackOpts.reserved, { allowReserved: true, scrub: opts.scrub })
        merged = { ...props, ...res }
      }
      merged.$surface = SURFACE
      const route = opts.getRoute?.()
      if (route && merged.$route === undefined) merged.$route = route
      if (!propertiesWithinByteLimit(merged)) return false
      enqueue({
        name,
        ts: new Date().toISOString(),
        properties: merged,
        ...(trackOpts?.dedupKey ? { dedup_key: trackOpts.dedupKey } : {}),
      })
      return true
    },
    setConsent(state) {
      void ready.then(() => storage?.setItem(consentKey, state)).catch(() => undefined)
      if (state === 'denied') {
        consent = 'denied'
        buffer = []
        consentBuffer = []
        pendingIdentify = false
        void writeSpill([])
      } else {
        const wasPending = consent === 'pending'
        consent = 'granted'
        if (wasPending && consentBuffer.length > 0) {
          buffer.push(...consentBuffer)
          consentBuffer = []
        }
        if (buffer.length > 0 || pendingIdentify) void flushNow()
      }
      for (const listener of [...consentListeners]) {
        try {
          listener(state)
        } catch {
          /* a listener must not break consent handling */
        }
      }
    },
    setIdentity(id, traits) {
      userId = id
      userTraits = traits ?? null
      // Held until consent is granted (flushNow checks), never queued under a denial.
      if (id && enabled && consent !== 'denied') {
        pendingIdentify = true
        void flushNow()
      }
    },
    consentState() {
      return enabled ? consent : 'denied'
    },
    onConsentChange(listener) {
      consentListeners.add(listener)
      return () => {
        consentListeners.delete(listener)
      }
    },
    async flush() {
      await ready
      await flushNow()
    },
    async destroy() {
      if (timer != null) {
        clearInterval(timer)
        timer = null
      }
      await flushNow().catch(() => undefined)
      destroyed = true
      buffer = []
      consentBuffer = []
      pendingIdentify = false
    },
  }
}
