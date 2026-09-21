/**
 * FILE: packages/react-native/src/analytics/session-tracker.ts
 * PURPOSE: Session lifecycle tracking on React Native, the data behind the
 *          console's Activity and Users & Funnels views for mobile projects.
 *
 * OVERVIEW:
 * - The core session tracker (`@mushi-mushi/core` session-tracker.ts) needs
 *   window, document and history, none of which exist on native, so RN gets
 *   this port driven by AppState instead (same approach as event-tracker.ts).
 * - session_start when the provider mounts, a heartbeat every 60 s while the
 *   app is in the foreground, session_end when it leaves the foreground, and
 *   page_view when the host reports a screen change through setScreen().
 * - Coming back to the foreground within RESUME_WINDOW_MS continues the same
 *   session; after a longer absence a new session id starts, matching the
 *   30-minute convention of mobile analytics.
 * - Transport is `MushiApiClient.postSessionEvent()`, the same
 *   POST /v1/sdk/session the web SDK uses. Best-effort, no queue.
 *
 * PRIVACY:
 * - Follows the event tracker's consent: nothing is sent until it resolves to
 *   'granted' (a persisted choice is read first), a later setConsent('granted')
 *   starts the session and 'denied' stops it mid-run. `analytics.enabled:false`
 *   reads as denied, so one switch turns off both surfaces.
 *
 * USAGE:
 * - Created by MushiProvider next to the event tracker; no React import here
 *   so the module is unit-testable with fake timers.
 */

import { newUuid, type MushiApiClient, type MushiSessionEventPayload } from '@mushi-mushi/core'

const HEARTBEAT_INTERVAL_MS = 60_000
/** Background time after which returning to the foreground starts a new session. */
export const RESUME_WINDOW_MS = 30 * 60_000

/** The consent surface of the RN event tracker the session tracker follows. */
export interface RNSessionConsentSource {
  ready: Promise<void>
  consentState(): 'granted' | 'denied' | 'pending'
  onConsentChange(listener: (state: 'granted' | 'denied') => void): () => void
}

export interface RNSessionTrackerOptions {
  /** Resolved lazily so the provider can hand over the client after mount. */
  client: MushiApiClient | null | (() => MushiApiClient | null)
  /** Per-install reporter token; may resolve asynchronously (SecureStore load). */
  getReporterToken: () => string | null | Promise<string | null>
  /** Current screen route or name, sent as `route`. */
  getRoute?: () => string | null
  consent: RNSessionConsentSource
  /** First session id; the provider passes its per-launch id so reports and sessions line up. */
  sessionId?: string
  sdkVersion?: string
  /** Stands in for navigator.userAgent, e.g. `mushi-react-native/1.2.0 (ios 17.5)`. */
  userAgent?: string | null
  /** Clock, injectable for tests. */
  now?: () => number
}

export interface RNSessionTracker {
  /** Feed AppState 'change' events. 'active' and 'background' matter; 'inactive' is ignored. */
  onAppStateChange(state: string): void
  /** The host moved to a new screen. */
  pageView(route: string): void
  /** Stop timers and listeners. Sends nothing. */
  destroy(): void
}

export function createRNSessionTracker(opts: RNSessionTrackerOptions): RNSessionTracker {
  const clock = opts.now ?? Date.now
  const resolveClient = (): MushiApiClient | null =>
    typeof opts.client === 'function' ? opts.client() : opts.client

  let sessionId = opts.sessionId ?? `sess_${newUuid()}`
  let pageViewCount = 0
  let started = false
  let allowed = false
  let foreground = true
  let destroyed = false
  let backgroundedAt: number | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  function route(): string | null {
    return opts.getRoute?.() ?? null
  }

  function send(
    kind: MushiSessionEventPayload['kind'],
    extra?: Partial<MushiSessionEventPayload>,
  ): void {
    const client = resolveClient()
    if (!client || !allowed || destroyed) return
    const base = {
      kind,
      session_id: sessionId,
      ts: new Date(clock()).toISOString(),
      page_view_count: pageViewCount,
      user_agent: opts.userAgent ?? null,
      sdk_version: opts.sdkVersion,
    }
    // Fire-and-forget: the reporter token may still be loading from SecureStore.
    void Promise.resolve(opts.getReporterToken())
      .then((token) => client.postSessionEvent({ ...base, reporter_token_hash: token, ...extra }))
      .catch(() => undefined)
  }

  function stopHeartbeat(): void {
    if (heartbeat != null) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  function startHeartbeat(): void {
    stopHeartbeat()
    heartbeat = setInterval(() => send('session_heartbeat', { route: route() }), HEARTBEAT_INTERVAL_MS)
  }

  function startSession(): void {
    started = true
    pageViewCount = 1
    send('session_start', { route: route() })
    startHeartbeat()
  }

  function activate(): void {
    if (allowed || destroyed) return
    allowed = true
    if (!foreground) return
    if (!started) startSession()
    else startHeartbeat()
  }

  function deactivate(): void {
    allowed = false
    stopHeartbeat()
  }

  // Re-read the state rather than trusting the event: a grant must not switch
  // on sessions when the host set analytics.enabled:false.
  const unsubscribe = opts.consent.onConsentChange(() => {
    if (opts.consent.consentState() === 'granted') activate()
    else deactivate()
  })

  void opts.consent.ready
    .then(() => {
      if (opts.consent.consentState() === 'granted') activate()
    })
    .catch(() => undefined)

  return {
    onAppStateChange(state) {
      if (destroyed) return
      if (state === 'active') {
        if (foreground) return
        foreground = true
        const away = backgroundedAt == null ? 0 : clock() - backgroundedAt
        backgroundedAt = null
        if (!allowed) return
        if (!started || away >= RESUME_WINDOW_MS) {
          sessionId = `sess_${newUuid()}`
          startSession()
        } else {
          send('session_heartbeat', { route: route() })
          startHeartbeat()
        }
        return
      }
      // 'inactive' (iOS app switcher, notification centre, incoming call) is
      // transitional and usually returns to 'active'; only 'background' ends
      // the foreground run.
      if (state !== 'background' || !foreground) return
      foreground = false
      backgroundedAt = clock()
      stopHeartbeat()
      if (started) send('session_end', { route: route() })
    },
    pageView(next) {
      if (!allowed || !started || !foreground) return
      pageViewCount += 1
      send('page_view', { route: next })
    },
    destroy() {
      destroyed = true
      deactivate()
      unsubscribe()
    },
  }
}
