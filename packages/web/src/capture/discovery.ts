/**
 * Mushi Mushi v2.1 — passive inventory discovery (whitepaper §6 hybrid mode).
 *
 * What this captures
 * ──────────────────
 *   - location.pathname, normalized to a route TEMPLATE (e.g.
 *     /practice/abc-123 → /practice/[id]) using either an explicit list
 *     of templates from the host framework's route config OR a small
 *     heuristic that collapses uuid / numeric / 24-char-hex segments.
 *   - document.title
 *   - all `[data-testid]` values currently in the DOM
 *   - the most recent N fetch/XHR paths captured by the existing
 *     network capturer (we do NOT instrument fetch ourselves — we
 *     borrow its observations to keep responsibility in one place)
 *   - a ≤200-char DOM summary built from <h1> / <title> / <main>
 *   - sanitized query-param keys (keys only, never values)
 *   - a SHA-256 of (userId || sessionId) so the server can count
 *     distinct users without storing identity
 *
 * What this does NOT capture
 * ──────────────────────────
 *   - any other DOM content
 *   - query-param VALUES, fragments, or hashes (only key names)
 *   - cookies, localStorage, sessionStorage
 *   - input values, focused elements, or scroll positions
 *   - the user's IP or any device fingerprint (the server already
 *     redacts what it gets, but we never send any)
 *
 * Throttling
 * ──────────
 *   At most one emission per (route, throttleMs) window. Default 60s.
 *   This keeps the ingest volume on a high-traffic SPA bounded — even
 *   a customer with a million PVs/day generates at most ~1.4M rows.
 */

import type { MushiDiscoverInventoryConfig } from '@mushi-mushi/core';

export interface DiscoveryEvent {
  route: string;
  page_title: string | null;
  dom_summary: string | null;
  testids: string[];
  network_paths: string[];
  query_param_keys: string[];
  user_id_hash: string | null;
  observed_at: string;
}

export interface DiscoveryCaptureOptions {
  config: MushiDiscoverInventoryConfig;
  /** Returns the recent fetch/XHR paths from the network capturer. */
  getRecentNetworkPaths: () => string[];
  /** Returns the current user identifier (or null) for hash input. */
  getUserId: () => string | null;
  /** Stable session id for dedup when no userId is set. */
  getSessionId: () => string;
  /** Called when a new discovery event is ready to ship. */
  onEvent: (e: DiscoveryEvent) => void;
}

export interface DiscoveryCapture {
  destroy: () => void;
  /** Emit immediately for the current pathname. Used on init. */
  flushNow: () => void;
}

const DEFAULT_THROTTLE_MS = 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX24_RE = /^[0-9a-f]{20,}$/i;
const NUMERIC_RE = /^\d+$/;
const SLUG_HASHY_RE = /^[a-z0-9]{16,}$/i;

/**
 * Collapse a single path segment to a template placeholder when it
 * looks like an opaque identifier. We are deliberately conservative
 * — if a heuristic isn't confident, we leave the segment alone, since
 * over-collapsing is worse than under-collapsing for the proposer.
 */
export function normalizeSegment(seg: string): string {
  if (seg.length === 0) return seg;
  if (UUID_RE.test(seg)) return '[id]';
  if (HEX24_RE.test(seg)) return '[id]';
  if (NUMERIC_RE.test(seg)) return '[id]';
  // Heuristic: a single segment of 16+ alphanumeric chars with at least
  // one digit is almost certainly an id, not a slug. (`thai-language` →
  // keep; `sku_abc12345xyz` → collapse.)
  if (SLUG_HASHY_RE.test(seg) && /\d/.test(seg)) return '[id]';
  return seg;
}

/**
 * Normalize a pathname to a route template, preferring an exact-match
 * against `routeTemplates` if the host has provided them.
 *
 *   /practice/abc-123              + ['/practice/[id]'] → '/practice/[id]'
 *   /practice/01H8H8…             without templates    → '/practice/[id]'
 *   /tags/thai-language           without templates    → '/tags/thai-language'
 */
export function normalizeRoute(
  pathname: string,
  templates: string[] | undefined,
): string {
  // Strip trailing slash so /a and /a/ look the same to the proposer.
  const clean = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
  if (templates?.length) {
    const matched = matchTemplate(clean, templates);
    if (matched) return matched;
  }
  return '/' + clean
    .split('/')
    .filter((s) => s.length > 0)
    .map(normalizeSegment)
    .join('/');
}

/**
 * Walk the host's static route templates and pick the one whose shape
 * matches the live pathname. `[id]`-style placeholders match any
 * single segment.
 */
function matchTemplate(pathname: string, templates: string[]): string | null {
  const segs = pathname.split('/').filter((s) => s.length > 0);
  // Sort longer-first so /a/b/[c] beats /a/b on a 3-segment URL.
  const sorted = [...templates].sort(
    (a, b) => b.split('/').length - a.split('/').length,
  );
  for (const tpl of sorted) {
    const tplSegs = tpl.split('/').filter((s) => s.length > 0);
    if (tplSegs.length !== segs.length) continue;
    let ok = true;
    for (let i = 0; i < tplSegs.length; i++) {
      const t = tplSegs[i]!;
      const s = segs[i]!;
      if (t.startsWith('[') && t.endsWith(']')) continue;
      if (t.startsWith(':')) continue;
      if (t === s) continue;
      ok = false;
      break;
    }
    if (ok) return '/' + tplSegs.join('/');
  }
  return null;
}

function readTestids(): string[] {
  if (typeof document === 'undefined') return [];
  const out = new Set<string>();
  const els = document.querySelectorAll('[data-testid]');
  for (const el of Array.from(els)) {
    const v = el.getAttribute('data-testid');
    if (v && v.length > 0 && v.length < 120) out.add(v);
  }
  return Array.from(out).sort();
}

function readQueryParamKeys(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const params = new URLSearchParams(window.location.search);
    const out = new Set<string>();
    params.forEach((_, key) => out.add(key));
    return Array.from(out).sort();
  } catch {
    return [];
  }
}

/**
 * Build a ≤200-char summary from the document's most prominent text.
 * We try `<h1>` first (most apps put the page heading there), fall
 * back to `<title>`, then `<main>`'s first paragraph, then null.
 */
function readDomSummary(): string | null {
  if (typeof document === 'undefined') return null;
  const trim = (s: string | null | undefined) =>
    (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const h1 = trim(document.querySelector('h1')?.textContent);
  if (h1) return h1;
  const title = trim(document.title);
  if (title) return title;
  const main = trim(document.querySelector('main')?.textContent);
  return main || null;
}

/**
 * SHA-256 (lowercase hex) of `userId || sessionId`, using the platform
 * SubtleCrypto. Falls back to `null` if crypto.subtle isn't available
 * (rare; means we won't dedupe distinct users on this client). Never
 * throws.
 */
async function hashUserId(input: string | null): Promise<string | null> {
  if (!input || typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i]!.toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    return null;
  }
}

/**
 * Stand up the discovery capturer. Returns a disposer.
 *
 * Implementation notes
 * ────────────────────
 *  - We hook `pushState` / `replaceState` because `popstate` alone misses
 *    SPA navigations triggered by frameworks calling `history.pushState`
 *    directly (Next.js / React Router both do this).
 *  - The first emission fires after a 100ms delay so the host app has
 *    a chance to settle the new DOM before we read testids.
 *  - Hash-only changes (`#section`) are intentionally ignored; they're
 *    not real navigations as far as the inventory is concerned.
 */
export function createDiscoveryCapture(opts: DiscoveryCaptureOptions): DiscoveryCapture {
  const {
    config,
    getRecentNetworkPaths,
    getUserId,
    getSessionId,
    onEvent,
  } = opts;

  const throttleMs = config.throttleMs ?? DEFAULT_THROTTLE_MS;
  const captureSummary = config.captureDomSummary !== false;
  const userIdSource = config.userIdSource ?? 'auto';

  const lastEmittedAt = new Map<string, number>();
  let lastPath: string | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  async function emitForCurrent() {
    if (typeof window === 'undefined') return;
    const route = normalizeRoute(window.location.pathname, config.routeTemplates);
    const now = Date.now();
    const last = lastEmittedAt.get(route) ?? 0;
    if (now - last < throttleMs) return;
    lastEmittedAt.set(route, now);

    let userIdInput: string | null = null;
    if (userIdSource === 'auto') {
      userIdInput = getUserId() ?? getSessionId();
    } else if (userIdSource === 'session-only') {
      userIdInput = getSessionId();
    }

    const event: DiscoveryEvent = {
      route,
      page_title: typeof document !== 'undefined'
        ? (document.title || '').slice(0, 300) || null
        : null,
      dom_summary: captureSummary ? readDomSummary() : null,
      testids: readTestids(),
      network_paths: getRecentNetworkPaths().slice(-50),
      query_param_keys: readQueryParamKeys(),
      user_id_hash: await hashUserId(userIdInput),
      observed_at: new Date().toISOString(),
    };
    onEvent(event);
  }

  function scheduleEmit() {
    if (pendingTimer) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      void emitForCurrent();
    }, 100);
  }

  function onMaybeNavigation() {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname + window.location.search;
    if (path === lastPath) return;
    lastPath = path;
    scheduleEmit();
  }

  if (typeof window === 'undefined') {
    return {
      destroy: () => undefined,
      flushNow: () => undefined,
    };
  }

  // Patch history.pushState / replaceState.
  const originalPush = window.history.pushState.bind(window.history);
  const originalReplace = window.history.replaceState.bind(window.history);
  const patchedPush: typeof window.history.pushState = function patched(
    ...args
  ) {
    const out = originalPush(...args);
    onMaybeNavigation();
    return out;
  };
  const patchedReplace: typeof window.history.replaceState = function patched(
    ...args
  ) {
    const out = originalReplace(...args);
    onMaybeNavigation();
    return out;
  };
  window.history.pushState = patchedPush;
  window.history.replaceState = patchedReplace;

  const onPop = () => onMaybeNavigation();
  window.addEventListener('popstate', onPop);

  // Initial emission for the landing page.
  scheduleEmit();

  return {
    destroy() {
      window.removeEventListener('popstate', onPop);
      // Best-effort restoration; if another piece of code patched it
      // after us, leave it alone.
      if (window.history.pushState === patchedPush) {
        window.history.pushState = originalPush;
      }
      if (window.history.replaceState === patchedReplace) {
        window.history.replaceState = originalReplace;
      }
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      lastEmittedAt.clear();
    },
    flushNow() {
      // Bypass throttle on explicit flush.
      lastEmittedAt.clear();
      void emitForCurrent();
    },
  };
}

// Pure exports for the unit tests.
export const __test = { matchTemplate };
