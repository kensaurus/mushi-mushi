/**
 * KENSAURUS spine — cross-app funnel events client.
 *
 * SOURCE: kensaurus/yen-yen kensaurus-spine/events.ts. Vendored copies are
 * written by scripts/spine-sync.mjs and verified by check-spine.mjs — do not
 * edit a copy; change the source and re-sync.
 *
 * One client for browsers (Next SSR-safe, Vite) and React Native. Nothing in
 * this module reads `window`, `document`, `fetch` or `__DEV__` at import time:
 * every platform concern is injected through `createKensaurusEvents()` —
 * storage (localStorage / AsyncStorage / Preferences), the production gate
 * (hostname on the web, `!__DEV__` natively), consent, identity. The browser
 * helpers at the bottom wrap the common web case in one call.
 *
 * Wire contract (kensaurus-events-ingest, kenji project; unauthenticated by
 * design, validated server-side): POST { app, anon_id?, user_id?, utm,
 * events: [{ event, props, ts }] } — at most 20 events and 32 KB per
 * request, 4 KB per props object. This client batches to those limits.
 *
 * Preserved from the four per-app clients it replaces: first-touch UTM +
 * referrer attribution stored once under `kensaurus_attribution`, a stable
 * `kensaurus_anon_id`, `referrer` echoed into every event's props,
 * `keepalive` sends, and the rule that analytics never throws.
 */

import { canonicalAppId } from './account'

export const KENSAURUS_EVENTS_INGEST_URL =
  'https://jghcferpoaqntpfqvayf.supabase.co/functions/v1/kensaurus-events-ingest'

/** Storage keys shared by every consumer so an upgrade never loses attribution. */
export const KENSAURUS_ANON_ID_STORAGE_KEY = 'kensaurus_anon_id'
export const KENSAURUS_ATTRIBUTION_STORAGE_KEY = 'kensaurus_attribution'
export const KENSAURUS_VISIT_DAY_STORAGE_KEY = 'kensaurus_visit_day'
export const KENSAURUS_ONCE_STORAGE_PREFIX = 'kensaurus_once:'

/** Ingest limits, mirrored so a batch is never rejected for size. */
export const KENSAURUS_EVENTS_MAX_BATCH = 20
export const KENSAURUS_EVENTS_MAX_PROPS_BYTES = 4000
export const KENSAURUS_EVENTS_MAX_BODY_BYTES = 24 * 1024

/**
 * The one funnel taxonomy every app reports. Anything else is app-specific,
 * still accepted, and documented in that app — not here.
 */
export const KENSAURUS_CANONICAL_EVENTS = [
  'visit',
  'signup',
  'activated',
  'habit',
  'paid',
  'referred',
  'crosslink_click',
  'stamp_earned',
] as const

export type KensaurusCanonicalEvent = (typeof KENSAURUS_CANONICAL_EVENTS)[number]
// `string & {}` keeps autocompletion for the canonical names while allowing
// app-specific extras (non-canonical; see the app's own docs).
export type KensaurusEventName = KensaurusCanonicalEvent | (string & {})

export type KensaurusEventProps = Readonly<Record<string, unknown>>

export const UTM_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
] as const

export interface KensaurusAttribution {
  readonly utm: Readonly<Record<string, string>>
  readonly referrer: string
  readonly landing: string
  readonly ts: string
}

/** Raw landing context; the client turns it into first-touch attribution. */
export interface KensaurusAttributionSource {
  /** `location.search`, with or without the leading `?`. */
  readonly search?: string
  readonly referrer?: string
  readonly landing?: string
}

type MaybePromise<T> = T | Promise<T>

/**
 * Minimal key/value adapter. localStorage on the web, AsyncStorage /
 * Preferences natively — injected, never imported here. Either method may
 * throw; the client swallows it.
 */
export interface KensaurusEventsStorage {
  get(key: string): MaybePromise<string | null | undefined>
  set(key: string, value: string): MaybePromise<void>
}

export interface KensaurusFetchInit {
  readonly method: 'POST'
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly keepalive: boolean
}

export type KensaurusFetch = (url: string, init: KensaurusFetchInit) => Promise<unknown>

export interface KensaurusEventsOptions {
  /** Canonical manifest id or a known alias (normalised on creation). */
  readonly app: string
  readonly endpoint?: string
  /** Persistence for anon id, attribution and once-guards. Memory when omitted. */
  readonly storage?: KensaurusEventsStorage
  /**
   * Mirrors the existing hostname / `!__DEV__` gates: nothing is queued or
   * stored unless this is true, so dev servers and previews stay silent.
   */
  readonly isProduction: boolean | (() => boolean)
  /** Consent gate evaluated at send time; a false drops the pending batch. */
  readonly consent?: () => MaybePromise<boolean>
  /** Signed-in kenji user id, when the app has one. */
  readonly userId?: () => MaybePromise<string | null | undefined>
  /** Overrides the minted anon id (e.g. a device id the app already keeps). */
  readonly anonId?: () => MaybePromise<string | null | undefined>
  /** Landing context for first-touch attribution; omit natively. */
  readonly attribution?: () => KensaurusAttributionSource | null | undefined
  /** Defaults to the global fetch, resolved at send time. */
  readonly fetch?: KensaurusFetch
  readonly now?: () => Date
  /** Debounce before a queued batch is sent. 0 sends on the next microtask. */
  readonly flushDelayMs?: number
  /** Receives swallowed errors (never rethrown). */
  readonly onError?: (error: unknown) => void
}

export interface KensaurusEventsClient {
  /** Canonical app id the client reports under. */
  readonly app: string
  /** Queue an event; batches are flushed automatically. Never throws. */
  track(event: KensaurusEventName, props?: KensaurusEventProps): void
  /** Send whatever is queued now (page hide, app background). */
  flush(): Promise<void>
  /** `visit`, at most once per local calendar day. Resolves true when sent. */
  trackVisit(props?: KensaurusEventProps): Promise<boolean>
  /**
   * Send `event` once per storage (`kensaurus_once:<key>`). Use for `signup`
   * and `activated`, keyed so a re-install cannot double count on the same
   * device. Resolves true when sent.
   */
  trackOnce(key: string, event: KensaurusEventName, props?: KensaurusEventProps): Promise<boolean>
  /** Production gate and consent, resolved. */
  isEnabled(): Promise<boolean>
  getAnonId(): Promise<string>
  /** First-touch attribution: captured on first call, then read back. */
  captureAttribution(): Promise<KensaurusAttribution | null>
}

interface QueuedEvent {
  readonly event: string
  readonly props: Readonly<Record<string, unknown>>
  readonly ts: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function createMemoryStorage(): KensaurusEventsStorage {
  const map = new Map<string, string>()
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value)
    },
  }
}

/** Parses a query string without URLSearchParams (uneven on React Native). */
export function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = search.startsWith('?') ? search.slice(1) : search
  if (raw === '') return out
  for (const pair of raw.split('&')) {
    if (pair === '') continue
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1)
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
      if (!(key in out)) out[key] = decodeURIComponent(rawValue.replace(/\+/g, ' '))
    } catch {
      // Malformed percent-encoding: skip the pair rather than the visit.
    }
  }
  return out
}

/** First-touch attribution from a landing context (pure; no storage). */
export function attributionFromSource(
  source: KensaurusAttributionSource,
  now: Date,
): KensaurusAttribution {
  const params = parseQuery(source.search ?? '')
  const utm: Record<string, string> = {}
  for (const key of UTM_PARAMS) {
    const value = params[key]
    if (value) utm[key] = value.slice(0, 200)
  }
  return {
    utm,
    referrer: (source.referrer ?? '').slice(0, 500),
    landing: source.landing ?? '',
    ts: now.toISOString(),
  }
}

function byteLength(value: string): number {
  // UTF-8 length without TextEncoder (absent on some RN runtimes).
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return '"[unserializable]"'
  }
}

/**
 * Keeps props under the ingest's per-event cap by dropping the largest
 * entries first and flagging the truncation, so one oversized payload
 * cannot get a whole batch rejected.
 */
export function capProps(props: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const entries = Object.entries(props).filter(([, v]) => v !== undefined)
  let out: Record<string, unknown> = Object.fromEntries(entries)
  if (byteLength(safeStringify(out)) <= KENSAURUS_EVENTS_MAX_PROPS_BYTES) return out
  const bySize = entries
    .map(([k, v]) => ({ k, v, size: byteLength(safeStringify(v)) }))
    .sort((a, b) => a.size - b.size)
  while (bySize.length > 0) {
    bySize.pop()
    out = { ...Object.fromEntries(bySize.map(({ k, v }) => [k, v])), _truncated: true }
    if (byteLength(safeStringify(out)) <= KENSAURUS_EVENTS_MAX_PROPS_BYTES) return out
  }
  return { _truncated: true }
}

function localDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function mintAnonId(): string {
  const cryptoApi = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // Fall through to the timestamp id.
    }
  }
  return `anon-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

function schedule(callback: () => void, delayMs: number): void {
  const timers = globalThis as unknown as {
    setTimeout?: (cb: () => void, ms: number) => unknown
  }
  if (delayMs > 0 && typeof timers.setTimeout === 'function') {
    timers.setTimeout(callback, delayMs)
    return
  }
  void Promise.resolve().then(callback)
}

// ── Client ──────────────────────────────────────────────────────────────────

export function createKensaurusEvents(options: KensaurusEventsOptions): KensaurusEventsClient {
  const app = canonicalAppId(options.app)
  const endpoint = options.endpoint ?? KENSAURUS_EVENTS_INGEST_URL
  const storage = options.storage ?? createMemoryStorage()
  const now = options.now ?? (() => new Date())
  const flushDelayMs = options.flushDelayMs ?? 250
  const report = (error: unknown) => {
    try {
      options.onError?.(error)
    } catch {
      // Error reporting must not throw either.
    }
  }

  const queue: QueuedEvent[] = []
  let flushScheduled = false
  let inFlight: Promise<void> | null = null
  let anonIdCache: string | null = null
  let attributionCache: KensaurusAttribution | null | undefined

  const isProduction = (): boolean => {
    try {
      return typeof options.isProduction === 'function'
        ? options.isProduction()
        : options.isProduction
    } catch (error) {
      report(error)
      return false
    }
  }

  const hasConsent = async (): Promise<boolean> => {
    if (!options.consent) return true
    try {
      return await options.consent()
    } catch (error) {
      report(error)
      return false
    }
  }

  const storageGet = async (key: string): Promise<string | null> => {
    try {
      return (await storage.get(key)) ?? null
    } catch (error) {
      report(error)
      return null
    }
  }

  const storageSet = async (key: string, value: string): Promise<boolean> => {
    try {
      await storage.set(key, value)
      return true
    } catch (error) {
      report(error)
      return false
    }
  }

  const getAnonId = async (): Promise<string> => {
    if (anonIdCache) return anonIdCache
    if (options.anonId) {
      try {
        const provided = await options.anonId()
        if (provided) {
          anonIdCache = provided
          return provided
        }
      } catch (error) {
        report(error)
      }
    }
    const existing = await storageGet(KENSAURUS_ANON_ID_STORAGE_KEY)
    if (existing) {
      anonIdCache = existing
      return existing
    }
    const fresh = mintAnonId()
    if (!(await storageSet(KENSAURUS_ANON_ID_STORAGE_KEY, fresh))) {
      // Matches the legacy clients: a storage-less browser still reports.
      return 'anon-unavailable'
    }
    anonIdCache = fresh
    return fresh
  }

  const captureAttribution = async (): Promise<KensaurusAttribution | null> => {
    if (attributionCache !== undefined) return attributionCache
    const stored = await storageGet(KENSAURUS_ATTRIBUTION_STORAGE_KEY)
    if (stored) {
      try {
        attributionCache = JSON.parse(stored) as KensaurusAttribution
        return attributionCache
      } catch (error) {
        report(error)
      }
    }
    let source: KensaurusAttributionSource | null | undefined
    try {
      source = options.attribution?.()
    } catch (error) {
      report(error)
    }
    if (!source) {
      attributionCache = null
      return null
    }
    const attribution = attributionFromSource(source, now())
    // Only persist a landing worth attributing; a bare visit stays capturable.
    if (Object.keys(attribution.utm).length > 0 || attribution.referrer) {
      await storageSet(KENSAURUS_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution))
      attributionCache = attribution
    }
    return attribution
  }

  const send = async (batch: QueuedEvent[]): Promise<void> => {
    const [anonId, userId, attribution] = await Promise.all([
      getAnonId(),
      (async () => {
        try {
          return (await options.userId?.()) ?? undefined
        } catch (error) {
          report(error)
          return undefined
        }
      })(),
      captureAttribution(),
    ])
    const referrer = attribution?.referrer || undefined
    const envelope = {
      app,
      anon_id: anonId,
      ...(userId ? { user_id: userId } : {}),
      utm: attribution?.utm ?? {},
    }
    const doFetch: KensaurusFetch | undefined =
      options.fetch ?? (globalThis as unknown as { fetch?: KensaurusFetch }).fetch
    if (!doFetch) return

    // Split by count and by bytes so neither ingest cap is hit.
    let chunk: QueuedEvent[] = []
    let chunkBytes = byteLength(safeStringify(envelope))
    const flushChunk = async () => {
      if (chunk.length === 0) return
      const body = safeStringify({
        ...envelope,
        events: chunk.map((ev) => ({
          event: ev.event,
          props: capProps({ ...ev.props, referrer }),
          ts: ev.ts,
        })),
      })
      chunk = []
      chunkBytes = byteLength(safeStringify(envelope))
      try {
        await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        })
      } catch (error) {
        report(error)
      }
    }
    for (const ev of batch) {
      const size = byteLength(safeStringify(ev)) + 64
      if (
        chunk.length >= KENSAURUS_EVENTS_MAX_BATCH ||
        (chunk.length > 0 && chunkBytes + size > KENSAURUS_EVENTS_MAX_BODY_BYTES)
      ) {
        await flushChunk()
      }
      chunk.push(ev)
      chunkBytes += size
    }
    await flushChunk()
  }

  const flush = async (): Promise<void> => {
    if (inFlight) await inFlight
    if (queue.length === 0) return
    const batch = queue.splice(0, queue.length)
    inFlight = (async () => {
      try {
        if (!isProduction() || !(await hasConsent())) return
        await send(batch)
      } catch (error) {
        report(error)
      } finally {
        inFlight = null
      }
    })()
    await inFlight
  }

  const track = (event: KensaurusEventName, props: KensaurusEventProps = {}): void => {
    try {
      if (!isProduction()) return
      queue.push({ event, props, ts: now().toISOString() })
      if (flushScheduled) return
      flushScheduled = true
      schedule(() => {
        flushScheduled = false
        void flush()
      }, flushDelayMs)
    } catch (error) {
      report(error)
    }
  }

  const isEnabled = async (): Promise<boolean> => isProduction() && (await hasConsent())

  const trackVisit = async (props: KensaurusEventProps = {}): Promise<boolean> => {
    try {
      if (!(await isEnabled())) return false
      const today = localDay(now())
      if ((await storageGet(KENSAURUS_VISIT_DAY_STORAGE_KEY)) === today) return false
      if (!(await storageSet(KENSAURUS_VISIT_DAY_STORAGE_KEY, today))) return false
      track('visit', props)
      return true
    } catch (error) {
      report(error)
      return false
    }
  }

  const trackOnce = async (
    key: string,
    event: KensaurusEventName,
    props: KensaurusEventProps = {},
  ): Promise<boolean> => {
    try {
      if (!(await isEnabled())) return false
      const storageKey = `${KENSAURUS_ONCE_STORAGE_PREFIX}${key}`
      if (await storageGet(storageKey)) return false
      if (!(await storageSet(storageKey, now().toISOString()))) return false
      track(event, props)
      return true
    } catch (error) {
      report(error)
      return false
    }
  }

  return {
    app,
    track,
    flush,
    trackVisit,
    trackOnce,
    isEnabled,
    getAnonId,
    captureAttribution,
  }
}

// ── Browser helpers (SSR-safe: everything is resolved lazily) ───────────────

interface BrowserGlobals {
  readonly location?: { hostname: string; search: string; pathname: string }
  readonly document?: { referrer: string }
  readonly localStorage?: {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
  }
}

function browser(): BrowserGlobals | null {
  const g = globalThis as unknown as { window?: BrowserGlobals }
  return typeof g.window === 'undefined' ? null : g.window
}

/** `kensaur.us` and any subdomain (talk.kensaur.us …); false server-side. */
export function isKensaurusProductionHost(hostname?: string): boolean {
  const host = hostname ?? browser()?.location?.hostname
  if (!host) return false
  return host === 'kensaur.us' || host.endsWith('.kensaur.us')
}

/** localStorage adapter that tolerates private mode and frameless windows. */
export function browserStorage(): KensaurusEventsStorage {
  return {
    get: (key) => {
      try {
        return browser()?.localStorage?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    set: (key, value) => {
      browser()?.localStorage?.setItem(key, value)
    },
  }
}

/** Landing context from the current document; null server-side. */
export function browserAttribution(): KensaurusAttributionSource | null {
  const b = browser()
  if (!b?.location) return null
  return {
    search: b.location.search,
    referrer: b.document?.referrer ?? '',
    landing: b.location.pathname,
  }
}

export type BrowserKensaurusEventsOptions = Omit<
  KensaurusEventsOptions,
  'storage' | 'attribution' | 'isProduction'
> &
  Partial<Pick<KensaurusEventsOptions, 'storage' | 'attribution' | 'isProduction'>>

/**
 * The common web client: localStorage, document attribution, and the
 * production-host gate, each overridable. Safe to create during SSR.
 */
export function createBrowserKensaurusEvents(
  options: BrowserKensaurusEventsOptions,
): KensaurusEventsClient {
  return createKensaurusEvents({
    ...options,
    storage: options.storage ?? browserStorage(),
    attribution: options.attribution ?? browserAttribution,
    isProduction: options.isProduction ?? (() => isKensaurusProductionHost()),
  })
}
