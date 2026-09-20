/**
 * FILE: packages/core/src/event-tracker.ts
 * PURPOSE: Client-side product-analytics tracker behind `Mushi.track()`.
 *
 * Batches named events and flushes them to POST /v1/sdk/events. Modelled on
 * session-tracker.ts (module state, idempotent init) but with a batch buffer,
 * an interval flush, a pagehide flush (the API client already switches to
 * keepalive during unload) and a small localStorage spill for unsent batches.
 *
 * Privacy:
 *   - `anon_id` is the same opaque per-project reporter token the SDK already
 *     uses for reports and sessions; identify() attaches the host's user id.
 *   - Honours navigator.doNotTrack / globalPrivacyControl unless the host
 *     opts out (`respectDoNotTrack: false`).
 *   - `consent: 'required'` buffers up to 50 events in memory until
 *     setConsent('granted'); 'denied' drops the buffer and disables tracking.
 *   - Every string property runs through the caller-supplied PII scrubber and
 *     the shared property contract in analytics-taxonomy.ts.
 *   - `sampleRate` is decided once per person (hash of anon_id), never per
 *     event, so funnels stay consistent.
 */

import type { MushiAnalyticsConfig, MushiApiClient, MushiProductEventPayload } from './types';
import {
  EVENT_PROPERTY_LIMITS,
  isValidEventName,
  propertiesWithinByteLimit,
  sanitizeEventProperties,
  type MushiEventProperties,
  type MushiSurface,
} from './analytics-taxonomy';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EventTrackerOptions {
  client: MushiApiClient;
  projectId: string;
  anonId: string | null;
  sdkVersion?: string;
  userId?: string | null;
  config?: MushiAnalyticsConfig;
  /** PII scrubber for string values (the SDK passes createPiiScrubber().scrub). */
  scrub?: (s: string) => string;
  /** Optional session id resolver (the SDK passes getSessionId). */
  getSessionId?: () => string;
}

type BufferedEvent = { name: string; ts: string; properties: MushiEventProperties; dedup_key?: string };

type ResolvedConfig = {
  enabled: boolean;
  consent: 'implied' | 'required';
  sampleRate: number;
  respectDoNotTrack: boolean;
  autoPageviews: boolean;
  flushIntervalMs: number;
  surface: MushiSurface;
  propertyAllowlist: string[];
};

// ─── State ───────────────────────────────────────────────────────────────────

let _client: MushiApiClient | null = null;
let _projectId = '';
let _anonId: string | null = null;
let _userId: string | null = null;
let _userTraits: Record<string, unknown> | null = null;
let _sdkVersion: string | undefined;
let _config: ResolvedConfig = defaults();
let _scrub: ((s: string) => string) | undefined;
let _getSessionId: (() => string) | undefined;
let _buffer: BufferedEvent[] = [];
let _consentBuffer: BufferedEvent[] = [];
let _consent: 'granted' | 'denied' | 'pending' = 'granted';
let _sampledIn = true;
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _initialized = false;
let _flushing = false;
let _pendingIdentify = false;

const CONSENT_BUFFER_MAX = 50;
const SPILL_MAX = 200;
const SPILL_TTL_MS = 24 * 60 * 60 * 1000;

function defaults(): ResolvedConfig {
  return {
    enabled: true,
    consent: 'implied',
    sampleRate: 1,
    respectDoNotTrack: true,
    autoPageviews: false,
    flushIntervalMs: 5_000,
    surface: 'web',
    propertyAllowlist: [],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function storageKey(kind: 'spill' | 'consent'): string {
  return 'mushi_events_' + kind + '_' + _projectId;
}

/** True when the browser signals Do Not Track or Global Privacy Control. */
export function dntActive(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  if (nav.globalPrivacyControl === true) return true;
  const winDnt = typeof window !== 'undefined' ? (window as Window & { doNotTrack?: string }).doNotTrack : undefined;
  const dnt = nav.doNotTrack ?? nav.msDoNotTrack ?? winDnt;
  return dnt === '1' || dnt === 'yes';
}

/** Stable [0,1) from a string (FNV-1a 32-bit). */
function hashToUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0) / 0x100000000;
}

function readStoredConsent(): 'granted' | 'denied' | null {
  try {
    const v = localStorage.getItem(storageKey('consent'));
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

function writeStoredConsent(v: 'granted' | 'denied'): void {
  try {
    localStorage.setItem(storageKey('consent'), v);
  } catch {
    /* storage unavailable */
  }
}

function readSpill(): BufferedEvent[] {
  try {
    const raw = localStorage.getItem(storageKey('spill'));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { at: number; events: BufferedEvent[] };
    if (!parsed || Date.now() - parsed.at > SPILL_TTL_MS) {
      localStorage.removeItem(storageKey('spill'));
      return [];
    }
    return Array.isArray(parsed.events) ? parsed.events.slice(0, SPILL_MAX) : [];
  } catch {
    return [];
  }
}

function writeSpill(events: BufferedEvent[]): void {
  try {
    if (events.length === 0) {
      localStorage.removeItem(storageKey('spill'));
      return;
    }
    localStorage.setItem(storageKey('spill'), JSON.stringify({ at: Date.now(), events: events.slice(-SPILL_MAX) }));
  } catch {
    /* storage unavailable or full */
  }
}

function buildPayload(events: BufferedEvent[]): MushiProductEventPayload {
  return {
    anon_id: _anonId,
    user_id: _userId,
    user_traits: _userTraits,
    session_id: _getSessionId ? _getSessionId() : null,
    sdk_version: _sdkVersion,
    surface: _config.surface,
    events,
  };
}

async function flushNow(): Promise<void> {
  if (!_client || _flushing) return;
  if (_buffer.length === 0 && !_pendingIdentify) return;
  _flushing = true;
  const batch = _buffer.splice(0, EVENT_PROPERTY_LIMITS.maxServerBatch);
  if (_pendingIdentify) {
    batch.unshift({ name: 'identify', ts: now(), properties: {} });
    _pendingIdentify = false;
  }
  try {
    const res = await _client.postProductEvents(buildPayload(batch));
    if (!res.ok) {
      writeSpill([...readSpill(), ...batch.filter((e) => e.name !== 'identify')]);
    } else {
      writeSpill([]);
    }
  } catch {
    writeSpill([...readSpill(), ...batch.filter((e) => e.name !== 'identify')]);
  } finally {
    _flushing = false;
  }
  if (_buffer.length >= EVENT_PROPERTY_LIMITS.maxClientBatch) void flushNow();
}

function enqueue(ev: BufferedEvent): void {
  if (_consent === 'denied') return;
  if (_consent === 'pending') {
    if (_consentBuffer.length < CONSENT_BUFFER_MAX) _consentBuffer.push(ev);
    return;
  }
  _buffer.push(ev);
  if (_buffer.length >= EVENT_PROPERTY_LIMITS.maxClientBatch) void flushNow();
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** True when tracking is active for this person (enabled, consented, sampled in, no DNT). */
export function isEventTrackingActive(): boolean {
  return _initialized && _config.enabled && _consent === 'granted' && _sampledIn;
}

/** The anonymous id events are keyed on, or null when tracking is off. */
export function getEventAnonymousId(): string | null {
  if (!_initialized || _consent === 'denied') return null;
  if (_config.respectDoNotTrack && dntActive()) return null;
  return _anonId;
}

/**
 * Initialise the tracker. Idempotent per page. Safe to call in SSR (no-op).
 */
export function initEventTracker(opts: EventTrackerOptions): void {
  if (_initialized) return;
  if (typeof window === 'undefined') return;
  const cfg = opts.config ?? {};
  _config = { ...defaults(), ...stripUndefined(cfg), propertyAllowlist: cfg.propertyAllowlist ?? [] };
  if (!_config.enabled) return;
  if (_config.respectDoNotTrack && dntActive()) return; // no events, no anon id persisted

  _initialized = true;
  _client = opts.client;
  _projectId = opts.projectId;
  _anonId = opts.anonId;
  _userId = opts.userId ?? null;
  _sdkVersion = opts.sdkVersion;
  _scrub = opts.scrub;
  _getSessionId = opts.getSessionId;

  const rate = Math.min(1, Math.max(0, _config.sampleRate));
  _sampledIn = rate >= 1 ? true : rate <= 0 ? false : hashToUnit(_anonId ?? 'anon') < rate;
  if (!_sampledIn) return;

  const stored = readStoredConsent();
  if (_config.consent === 'required') _consent = stored ?? 'pending';
  else _consent = stored === 'denied' ? 'denied' : 'granted';

  // Replay a previous page's unsent batch.
  const spill = readSpill();
  if (spill.length > 0) _buffer.push(...spill);

  const interval = Math.max(1_000, _config.flushIntervalMs);
  _flushTimer = setInterval(() => { void flushNow(); }, interval);

  const onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') void flushNow();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide, { passive: true });
  window.addEventListener('pagehide', () => { void flushNow(); }, { passive: true });

  if (_config.autoPageviews) patchHistory();
}

/**
 * Record a named event. Invalid names are dropped; properties are sanitised
 * per analytics-taxonomy.ts. Returns true when the event was queued.
 */
export function trackEvent(
  name: string,
  properties?: Record<string, unknown>,
  opts?: { dedupKey?: string; ts?: string; reserved?: MushiEventProperties },
): boolean {
  if (!_initialized || !_config.enabled || !_sampledIn) return false;
  if (!isValidEventName(name)) return false;
  const { properties: props } = sanitizeEventProperties(properties, {
    allowlist: _config.propertyAllowlist,
    scrub: _scrub,
  });
  let merged: MushiEventProperties = props;
  if (opts?.reserved) {
    const { properties: res } = sanitizeEventProperties(opts.reserved, { allowReserved: true, scrub: _scrub });
    merged = { ...props, ...res };
  }
  merged.$surface = _config.surface;
  if (typeof location !== 'undefined' && merged.$route === undefined) merged.$route = location.pathname;
  if (!propertiesWithinByteLimit(merged)) return false;
  enqueue({
    name,
    ts: opts?.ts ?? now(),
    properties: merged,
    ...(opts?.dedupKey ? { dedup_key: opts.dedupKey } : {}),
  });
  return true;
}

/** Grant or deny consent. Granting releases the pending buffer. */
export function setEventConsent(state: 'granted' | 'denied'): void {
  writeStoredConsent(state);
  if (!_initialized) {
    _consent = state;
    return;
  }
  if (state === 'denied') {
    _consent = 'denied';
    _buffer = [];
    _consentBuffer = [];
    writeSpill([]);
    return;
  }
  const wasPending = _consent === 'pending';
  _consent = 'granted';
  if (wasPending && _consentBuffer.length > 0) {
    _buffer.push(..._consentBuffer);
    _consentBuffer = [];
    void flushNow();
  }
}

/** Called from identify(): stitches anonymous history to the person. */
export function updateEventIdentity(userId: string | null, traits?: Record<string, unknown> | null): void {
  _userId = userId;
  _userTraits = traits ?? null;
  if (_initialized && userId) {
    _pendingIdentify = true;
    void flushNow();
  }
}

/** Flush immediately (tests, before navigation). */
export function flushEvents(): Promise<void> {
  return flushNow();
}

/** Tear down timers (tests / SSR). */
export function destroyEventTracker(): void {
  if (_flushTimer != null) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  _initialized = false;
  _client = null;
  _buffer = [];
  _consentBuffer = [];
  _consent = 'granted';
  _sampledIn = true;
  _pendingIdentify = false;
  _userId = null;
  _userTraits = null;
  _config = defaults();
}

// ─── Optional auto page views ────────────────────────────────────────────────

let _historyPatched = false;

function patchHistory(): void {
  if (_historyPatched || typeof history === 'undefined') return;
  _historyPatched = true;
  const original = history.pushState;
  history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
    const result = original.apply(this, args);
    trackEvent('pageview');
    return result;
  };
  window.addEventListener('popstate', () => { trackEvent('pageview'); }, { passive: true });
}
