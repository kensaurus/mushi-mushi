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
 *
 * SPA page views:
 *   The history patch below decides push-vs-replace at wrap time (comparing
 *   against `history.pushState` inside the wrapper never matches, because by
 *   then that property is the wrapper). Hosts that already own a history
 *   patch (`@mushi-mushi/web`'s shared one) pass `patchHistory: false` and
 *   call `trackPageView()` themselves — a second wrapper assigned to
 *   `history.pushState` silently discards this one, which is how the web SDK
 *   recorded zero SPA page views across >1,000 sessions per project.
 */

import { getSessionId } from './session';
import { analyticsBlockReason, onAnalyticsConsentChange, resolveAnalyticsConsent } from './analytics-gate';
import type { MushiAnalyticsConfig, MushiApiClient, MushiSessionEventPayload } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Longest a visible session goes without a request. The server keeps
 * `last_seen_at` from every event kind, and an open session's duration is
 * `last_seen_at - started_at`, so a heartbeat only has to follow 60s of
 * silence; it is skipped while other events keep `last_seen_at` fresh, and
 * paused while the tab is hidden (session_end already recorded the hide).
 */
const HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute

// ─── State ───────────────────────────────────────────────────────────────────

let _client: MushiApiClient | null = null;
let _sdkVersion: string | undefined;
let _userIdHash: string | null = null;
let _reporterToken: string | null = null;
let _pageViewCount = 0;
let _heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
/** Pathname of the last page view sent; a navigation that keeps it is not a new page. */
let _lastRoute: string | null = null;
/** True once session_end went out for the current hidden period. */
let _endSent = false;
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
  scheduleHeartbeat();
}

function clearHeartbeat(): void {
  clearTimeout(_heartbeatTimer);
}

/** (Re)arm the heartbeat 60s after the latest request, only while visible. */
function scheduleHeartbeat(): void {
  clearHeartbeat();
  if (!_active || globalThis.document?.visibilityState === 'hidden') return;
  _heartbeatTimer = setTimeout(() => {
    send(buildPayload('session_heartbeat', { route: currentRoute() }));
  }, HEARTBEAT_INTERVAL_MS);
}

function recordPageView(route: string): void {
  if (!_active) return;
  // pushState / popstate that keep the pathname (a sheet that pushes a
  // history entry for the back button, a query or #fragment change) are not
  // a new page: the server strips query and hash, so they were duplicate
  // views of the route being read, one POST each.
  if (route === _lastRoute) return;
  _lastRoute = route;
  _pageViewCount += 1;
  send(buildPayload('page_view', { route }));
}

/** One session_end per hidden period: a hide followed by pagehide is one exit. */
function sendSessionEnd(): void {
  if (_endSent || !_active) return;
  _endSent = true;
  send(buildPayload('session_end', { route: currentRoute() }));
  // The page is going away (or hidden): nothing to keep alive until it is back.
  clearHeartbeat();
}

/** Begin (or resume after a re-grant) sending: session_start plus heartbeats. */
function activate(): void {
  if (_active || !_initialized) return;
  _active = true;
  if (!_started) {
    _started = true;
    _pageViewCount = 1;
    _lastRoute = currentRoute();
    send(buildPayload('session_start', { route: _lastRoute, referrer: referrerOrigin() }));
  } else {
    scheduleHeartbeat();
  }
}

// Module-level so a destroy → re-init on the same page re-adds the SAME
// functions, which addEventListener ignores: one session_end per hide, not
// one per init. After destroy they stay attached but send() is a no-op.
function onHide(): void {
  if (document.visibilityState === 'hidden') {
    sendSessionEnd();
  } else {
    // Back from hidden: the next hide is a new exit, and the heartbeat resumes.
    _endSent = false;
    scheduleHeartbeat();
  }
}

function onPagehide(): void {
  sendSessionEnd();
}

/** Restored from the back/forward cache: the same session carries on. */
function onPageshow(event: PageTransitionEvent): void {
  if (!event.persisted) return;
  _endSent = false;
  scheduleHeartbeat();
}

/** Stop sending immediately (consent denied). Listeners stay but go quiet. */
function deactivate(): void {
  _active = false;
  clearHeartbeat();
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
  /**
   * Install the built-in `history.pushState` / `popstate` patch that emits
   * `page_view` events. Default `true`. Pass `false` when the host already
   * owns a history patch and will call `trackPageView()` itself — stacking a
   * second wrapper on `history.pushState` is exactly how this tracker's page
   * views got overwritten and silently dropped in `@mushi-mushi/web`.
   */
  patchHistory?: boolean;
  /** Project the stored analytics consent is keyed on (the SDK passes its projectId). */
  projectId?: string;
  /** The SDK's `analytics` block: sessions pass the same gate as product events. */
  analytics?: MushiAnalyticsConfig;
}

/**
 * Initialise the session tracker. Call once at SDK init for web environments.
 * Subsequent calls on the same page are no-ops (idempotent).
 *
 * Emits, once the analytics gate allows it: session_start, a heartbeat after
 * each minute without another request while the tab is visible, one
 * session_end per hide (visibilitychange/pagehide), and page_view when a
 * history API navigation changes the pathname. Under `consent: 'required'`
 * nothing is sent until setConsent('granted').
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
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onHide, { passive: true });
  }
  window.addEventListener('pagehide', onPagehide, { passive: true });
  window.addEventListener('pageshow', onPageshow, { passive: true });

  // page_view on History API navigation (SPA route changes) — unless the
  // host owns the history patch and reports page views via trackPageView().
  if (opts.patchHistory !== false) {
    patchHistoryForPageViews();
  }

  _unsubscribeConsent = onAnalyticsConsentChange((state) => {
    if (state === 'granted') activate();
    else deactivate();
  });
  if (resolveAnalyticsConsent(opts.projectId ?? '', opts.analytics) === 'granted') activate();
}

/**
 * Record a page view manually — call from framework router hooks where the
 * history patch may fire too early (e.g. React Router v7 loader transitions),
 * or from a host that initialised with `patchHistory: false`. A call whose
 * pathname matches the last page view is ignored: it is the same page.
 */
export function trackPageView(route?: string): void {
  if (!_initialized || !_client) return;
  recordPageView(route ?? currentRoute());
}

/** Set the identity heartbeats carry: a SHA-256 hex of the host user id, never the raw id. */
export function updateSessionIdentity(userIdHash: string | null): void {
  // The server links a signed-in user on the first page_view after sign-in
  // (heartbeats never verify), so let the next navigation through even when
  // it keeps the pathname.
  if (userIdHash && userIdHash !== _userIdHash) _lastRoute = null;
  _userIdHash = userIdHash;
}

/** Tear down timers (e.g. in tests or SSR environments). */
export function destroySessionTracker(): void {
  deactivate();
  _unsubscribeConsent?.();
  _unsubscribeConsent = null;
  _initialized = false;
  _started = false;
  _lastRoute = null;
  _endSent = false;
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
