/**
 * FILE: packages/core/src/session-tracker.ts
 * PURPOSE: Lightweight session-lifecycle tracking for the Mushi SDK.
 *
 * Emits best-effort events to /v1/sdk/session so the console can show per-
 * project activity analytics (DAU/WAU, page views, identified vs. anonymous
 * user split, top routes). Mirrors the postDiscoveryEvent pattern: 1 retry,
 * no offline queue, fire-and-forget after visibility-change.
 *
 * Privacy:
 *   - No PII by default. `reporter_token_hash` is the same opaque device
 *     fingerprint already used in reports. `user_id_hash` is only set when
 *     the host app calls Mushi.identify().
 *   - Respects the SDK-level `trackSessions: false` opt-out option.
 *   - Respects a DNT / Global Privacy Control header at the SDK init layer;
 *     callers should check `shouldRespectDnt()` before calling `initSession`.
 */

import { getSessionId } from './session';
import type { MushiApiClient, MushiSessionEventPayload } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Heartbeat interval — keep sessions alive and update page-view count. */
const HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute

// ─── State ───────────────────────────────────────────────────────────────────

let _client: MushiApiClient | null = null;
let _sdkVersion: string | undefined;
let _userIdHash: string | null = null;
let _reporterTokenHash: string | null = null;
let _pageViewCount = 0;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _initialized = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function currentRoute(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname + window.location.search;
}

function userAgent(): string | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.userAgent ?? null;
}

function buildPayload(
  kind: MushiSessionEventPayload['kind'],
  extra?: Partial<MushiSessionEventPayload>,
): MushiSessionEventPayload {
  return {
    kind,
    session_id: getSessionId(),
    ts: now(),
    page_view_count: _pageViewCount,
    reporter_token_hash: _reporterTokenHash,
    user_id_hash: _userIdHash,
    user_agent: userAgent(),
    sdk_version: _sdkVersion,
    ...extra,
  };
}

function send(payload: MushiSessionEventPayload): void {
  if (!_client) return;
  // Fire-and-forget — best-effort; errors don't propagate to the host app.
  _client.postSessionEvent(payload).catch(() => { /* intentionally silent */ });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface SessionTrackerOptions {
  client: MushiApiClient;
  sdkVersion?: string;
  reporterTokenHash?: string | null;
  userIdHash?: string | null;
}

/**
 * Initialise the session tracker. Call once at SDK init for web environments.
 * Subsequent calls on the same page are no-ops (idempotent).
 *
 * Emits: session_start immediately, heartbeats every minute, session_end on
 * visibilitychange/pagehide, and page_view on history API navigation.
 */
export function initSessionTracker(opts: SessionTrackerOptions): void {
  if (_initialized || typeof window === 'undefined') return;
  _initialized = true;

  _client = opts.client;
  _sdkVersion = opts.sdkVersion;
  _reporterTokenHash = opts.reporterTokenHash ?? null;
  _userIdHash = opts.userIdHash ?? null;

  const entryRoute = currentRoute();
  _pageViewCount = 1;

  // 1. session_start
  send(buildPayload('session_start', {
    route: entryRoute,
    referrer: typeof document !== 'undefined' ? (document.referrer ?? null) : null,
  }));

  // 2. Heartbeat — keeps last_seen_at fresh and pushes page_view_count updates
  _heartbeatTimer = setInterval(() => {
    send(buildPayload('session_heartbeat', { route: currentRoute() }));
  }, HEARTBEAT_INTERVAL_MS);

  // 3. session_end on visibility-change to hidden / pagehide
  const onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      send(buildPayload('session_end', { route: currentRoute() }));
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onHide, { passive: true });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      send(buildPayload('session_end', { route: currentRoute() }));
    }, { passive: true });
  }

  // 4. page_view on History API navigation (SPA route changes)
  patchHistoryForPageViews();
}

/**
 * Record a page view manually — call from framework router hooks where the
 * history patch may fire too early (e.g. React Router v7 loader transitions).
 */
export function trackPageView(route?: string): void {
  if (!_initialized || !_client) return;
  _pageViewCount += 1;
  send(buildPayload('page_view', { route: route ?? currentRoute() }));
}

/** Update the user identity after a Mushi.identify() call. */
export function updateSessionIdentity(userIdHash: string | null): void {
  _userIdHash = userIdHash;
}

/** Tear down timers (e.g. in tests or SSR environments). */
export function destroySessionTracker(): void {
  if (_heartbeatTimer != null) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
  _initialized = false;
  _client = null;
}

// ─── History patch (SPA page views) ─────────────────────────────────────────

let _historyPatched = false;

function patchHistoryForPageViews(): void {
  if (_historyPatched || typeof history === 'undefined') return;
  _historyPatched = true;

  const wrap = (original: History['pushState'] | History['replaceState']) =>
    function (this: History, ...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      // pushState navigation = new page view; replaceState = same page, skip
      if (original === history.pushState) {
        _pageViewCount += 1;
        send(buildPayload('page_view', { route: currentRoute() }));
      }
      return result;
    };

  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);

  // popstate (back/forward)
  window.addEventListener('popstate', () => {
    _pageViewCount += 1;
    send(buildPayload('page_view', { route: currentRoute() }));
  }, { passive: true });
}
