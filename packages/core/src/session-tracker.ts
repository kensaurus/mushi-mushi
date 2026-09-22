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
 *   - Passes the same gate as product events (analytics-gate.ts): nothing is
 *     sent when `analytics.enabled` is false, under DNT / GPC, in automation
 *     or crawler browsers, or before consent is granted. A later
 *     setConsent('granted') starts the session; 'denied' stops it mid-page.
 *   - No PII by default. `reporter_token_hash` is the same opaque device
 *     fingerprint already used in reports. `user_id_hash` is only set when
 *     the host app identifies the user.
 *   - Routes are sent as the pathname only and the referrer as its origin, so
 *     query strings (reset tokens, emails in links) never leave the page.
 *   - Respects the SDK-level `trackSessions: false` opt-out option.
 */

import { getSessionId } from './session';
import { analyticsBlockReason, onAnalyticsConsentChange, resolveAnalyticsConsent } from './analytics-gate';
import type { MushiAnalyticsConfig, MushiApiClient, MushiSessionEventPayload } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Heartbeat interval — keep sessions alive and update page-view count. */
const HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute

// ─── State ───────────────────────────────────────────────────────────────────

let _client: MushiApiClient | null = null;
let _sdkVersion: string | undefined;
let _userIdHash: string | null = null;
let _reporterToken: string | null = null;
let _pageViewCount = 0;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _initialized = false;
/** True while the gate allows sending; flips with consent. */
let _active = false;
let _started = false;
let _unsubscribeConsent: (() => void) | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function currentRoute(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname;
}

function referrerOrigin(): string | null {
  if (typeof document === 'undefined' || !document.referrer) return null;
  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
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
    // Wire name kept for older servers; the value is the raw token (hashed server-side).
    reporter_token_hash: _reporterToken,
    user_id_hash: _userIdHash,
    user_agent: userAgent(),
    sdk_version: _sdkVersion,
    ...extra,
  };
}

function send(payload: MushiSessionEventPayload): void {
  if (!_client || !_active) return;
  // Fire-and-forget — best-effort; errors don't propagate to the host app.
  _client.postSessionEvent(payload).catch(() => { /* intentionally silent */ });
}

function recordPageView(route: string): void {
  if (!_active) return;
  _pageViewCount += 1;
  send(buildPayload('page_view', { route }));
}

/** Begin (or resume after a re-grant) sending: session_start plus heartbeats. */
function activate(): void {
  if (_active || !_initialized) return;
  _active = true;
  if (!_started) {
    _started = true;
    _pageViewCount = 1;
    send(buildPayload('session_start', { route: currentRoute(), referrer: referrerOrigin() }));
  }
  _heartbeatTimer = setInterval(() => {
    send(buildPayload('session_heartbeat', { route: currentRoute() }));
  }, HEARTBEAT_INTERVAL_MS);
}

/** Stop sending immediately (consent denied). Listeners stay but go quiet. */
function deactivate(): void {
  _active = false;
  if (_heartbeatTimer != null) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface SessionTrackerOptions {
  client: MushiApiClient;
  sdkVersion?: string;
  /** The raw per-project reporter token; the server stores only its sha256. */
  reporterToken?: string | null;
  /** @deprecated Renamed to `reporterToken` (it always carried the raw token, never a hash). */
  reporterTokenHash?: string | null;
  userIdHash?: string | null;
  /** Project the stored analytics consent is keyed on (the SDK passes its projectId). */
  projectId?: string;
  /** The SDK's `analytics` block: sessions pass the same gate as product events. */
  analytics?: MushiAnalyticsConfig;
}

/**
 * Initialise the session tracker. Call once at SDK init for web environments.
 * Subsequent calls on the same page are no-ops (idempotent).
 *
 * Emits, once the analytics gate allows it: session_start, heartbeats every
 * minute, session_end on visibilitychange/pagehide, and page_view on history
 * API navigation. Under `consent: 'required'` nothing is sent until
 * setConsent('granted').
 */
export function initSessionTracker(opts: SessionTrackerOptions): void {
  if (_initialized || typeof window === 'undefined') return;
  // Disabled, DNT / GPC or automation: stay fully inert for this page.
  if (analyticsBlockReason(opts.analytics) !== null) return;
  _initialized = true;

  _client = opts.client;
  _sdkVersion = opts.sdkVersion;
  _reporterToken = opts.reporterToken ?? opts.reporterTokenHash ?? null;
  _userIdHash = opts.userIdHash ?? null;

  // session_end on visibility-change to hidden / pagehide
  const onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      send(buildPayload('session_end', { route: currentRoute() }));
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onHide, { passive: true });
  }
  window.addEventListener('pagehide', () => {
    send(buildPayload('session_end', { route: currentRoute() }));
  }, { passive: true });

  // page_view on History API navigation (SPA route changes)
  patchHistoryForPageViews();

  _unsubscribeConsent = onAnalyticsConsentChange((state) => {
    if (state === 'granted') activate();
    else deactivate();
  });
  if (resolveAnalyticsConsent(opts.projectId ?? '', opts.analytics) === 'granted') activate();
}

/**
 * Record a page view manually — call from framework router hooks where the
 * history patch may fire too early (e.g. React Router v7 loader transitions).
 */
export function trackPageView(route?: string): void {
  if (!_initialized || !_client) return;
  recordPageView(route ?? currentRoute());
}

/** Update the user identity after a Mushi.identify() call. */
export function updateSessionIdentity(userIdHash: string | null): void {
  _userIdHash = userIdHash;
}

/** Tear down timers (e.g. in tests or SSR environments). */
export function destroySessionTracker(): void {
  deactivate();
  _unsubscribeConsent?.();
  _unsubscribeConsent = null;
  _initialized = false;
  _started = false;
  _client = null;
}

// ─── History patch (SPA page views) ─────────────────────────────────────────

let _historyPatched = false;

function patchHistoryForPageViews(): void {
  if (_historyPatched || typeof history === 'undefined') return;
  _historyPatched = true;

  // pushState navigation = new page view; replaceState = same page, skip.
  // Decided at wrap time: comparing against `history.pushState` inside the
  // wrapper never matches, because by then that property is the wrapper.
  const wrap = (original: History['pushState'] | History['replaceState'], countsAsPageView: boolean) =>
    function (this: History, ...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      if (countsAsPageView) recordPageView(currentRoute());
      return result;
    };

  history.pushState = wrap(history.pushState, true);
  history.replaceState = wrap(history.replaceState, false);

  // popstate (back/forward)
  window.addEventListener('popstate', () => {
    recordPageView(currentRoute());
  }, { passive: true });
}
