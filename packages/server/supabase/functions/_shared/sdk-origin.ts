/**
 * FILE: packages/server/supabase/functions/_shared/sdk-origin.ts
 * PURPOSE: Where an SDK key checked in from, as one of five kinds, plus a
 *          short sample of the origin that is safe to store. Feeds
 *          project_api_key_origins (one row per key and kind, written on the
 *          ingest heartbeat in auth.ts) and the sdk_seen_localhost /
 *          sdk_seen_live funnel steps (docs/plan-simplicity-2026-10.md §4b
 *          row 1, Phase 0).
 *
 * Why a table and not project_api_keys.last_seen_origin: that column keeps
 * only the latest origin, so a key seen live and then from localhost reads
 * "localhost", and "never seen live" cannot be proven.
 *
 * Kinds:
 *   localhost  a dev machine: the rule report-origin.ts uses for report
 *              URLs (a loopback host WITH a port, a private network address,
 *              *.localhost / *.local / *.test), so a key check-in and a
 *              report from the same page agree.
 *   live_web   any other http(s) origin.
 *   native     a store app: a Capacitor or Android webview scheme, a
 *              loopback host with NO port (Capacitor on Android serves
 *              https://localhost to real users; report-origin.ts counts it as
 *              deployed too), or, with no Origin, the React Native SDK or a
 *              native HTTP stack in the User-Agent.
 *   server     no Origin and the Node SDK or a non-browser client (CLI, CI,
 *              curl, a server script).
 *   unknown    anything else: `Origin: null`, file://, a browser User-Agent
 *              with no Origin, nothing at all.
 *
 * The sample is scheme + host (+ port) only. The heartbeat falls back to the
 * Referer header, which carries a full URL, so paths, queries, fragments and
 * credentials are dropped here, never stored. No sample is kept for server
 * or unknown check-ins.
 *
 * Pure: no Deno globals, so vitest imports it.
 */

import { isLocalDevUrl } from './report-origin.ts'

export const SDK_ORIGIN_KINDS = ['localhost', 'live_web', 'native', 'server', 'unknown'] as const
export type SdkOriginKind = (typeof SDK_ORIGIN_KINDS)[number]

/** Kinds that mean the app reached real users: the plan's "Go live". */
export const LIVE_ORIGIN_KINDS: ReadonlySet<SdkOriginKind> = new Set(['live_web', 'native'])

/** Longest origin sample stored (a host name is at most 253 characters). */
export const MAX_ORIGIN_SAMPLE_LEN = 200

/** Webview schemes a store app's page runs under. */
const NATIVE_SCHEMES: ReadonlySet<string> = new Set(['capacitor:', 'ionic:', 'android-app:'])

/** Native HTTP stacks and app shells (radar/operator-detectors.ts APP_CLIENT_UA, without the browser-ish ones). */
export const NATIVE_UA = /okhttp|cfnetwork|dalvik|expo|react-?native/i

/** Every desktop and mobile browser sends a Mozilla/5.0 product token. */
const BROWSER_UA = /mozilla\//i

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

export interface SdkOriginInput {
  /** The Origin header, else the Referer header. */
  origin: string | null | undefined
  userAgent: string | null | undefined
  /** X-Mushi-SDK-Package, e.g. @mushi-mushi/web, @mushi-mushi/react-native, @mushi-mushi/node. */
  sdkPackage?: string | null
}

export interface SdkOriginClassification {
  kind: SdkOriginKind
  /** scheme://host[:port], lowercase; null when there is nothing safe to keep. */
  sample: string | null
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * Scheme and host only. `URL.origin` is the string "null" for non-special
 * schemes such as capacitor://, so build it from the parts. `host` never
 * includes userinfo, so `https://user:pass@x` keeps only `https://x`.
 */
export function sanitizeOriginSample(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.toLowerCase() === 'null') return null
  const url = parse(trimmed)
  if (!url || !url.host) return null
  const sample = `${url.protocol}//${url.host}`.toLowerCase()
  return sample.length > MAX_ORIGIN_SAMPLE_LEN ? sample.slice(0, MAX_ORIGIN_SAMPLE_LEN) : sample
}

function classifyNoOrigin(userAgent: string | null | undefined, sdkPackage: string | null | undefined): SdkOriginKind {
  const pkg = (sdkPackage ?? '').toLowerCase()
  if (pkg.includes('react-native')) return 'native'
  if (pkg.includes('/node')) return 'server'
  const ua = (userAgent ?? '').trim()
  if (!ua) return 'unknown'
  if (NATIVE_UA.test(ua)) return 'native'
  // A browser always sends Origin on a cross-origin POST; a Mozilla UA
  // without one is a proxy or a stripped request, not a server.
  if (BROWSER_UA.test(ua)) return 'unknown'
  return 'server'
}

/** Classify one SDK check-in. Never throws. */
export function classifySdkOrigin(input: SdkOriginInput): SdkOriginClassification {
  const raw = typeof input.origin === 'string' ? input.origin.trim() : ''
  if (!raw) return { kind: classifyNoOrigin(input.userAgent, input.sdkPackage), sample: null }

  const url = parse(raw)
  const sample = sanitizeOriginSample(raw)
  if (!url || !sample) return { kind: 'unknown', sample: null }

  const scheme = url.protocol.toLowerCase()
  if (NATIVE_SCHEMES.has(scheme)) return { kind: 'native', sample }
  if (scheme !== 'http:' && scheme !== 'https:') return { kind: 'unknown', sample: null }

  // Test the sanitized sample, not the raw header: same answer, and no path
  // or query reaches the pattern.
  if (isLocalDevUrl(sample)) return { kind: 'localhost', sample }
  // A loopback host with no port is a Capacitor webview in a store build.
  if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) && !url.port) return { kind: 'native', sample }
  return { kind: 'live_web', sample }
}

/** The funnel step a first check-in of this kind reaches, if any. */
export function funnelStepForOriginKind(kind: SdkOriginKind): 'sdk_seen_localhost' | 'sdk_seen_live' | null {
  if (kind === 'localhost') return 'sdk_seen_localhost'
  if (LIVE_ORIGIN_KINDS.has(kind)) return 'sdk_seen_live'
  return null
}

/**
 * Per-isolate throttle for the origin write on the ingest heartbeat: at most
 * one write per (key, kind) per window. The table's own WHERE clause repeats
 * the window across isolates. Bounded so a flood of keys cannot grow it.
 */
export class OriginWriteThrottle {
  private readonly seen = new Map<string, number>()

  constructor(
    private readonly windowMs: number,
    private readonly maxEntries: number,
  ) {}

  /** True when the caller should write now (and records that it did). */
  shouldWrite(keyId: string, kind: SdkOriginKind, nowMs: number): boolean {
    const id = `${keyId}:${kind}`
    const last = this.seen.get(id)
    if (last !== undefined && nowMs - last < this.windowMs) return false
    if (this.seen.size >= this.maxEntries && last === undefined) {
      // Drop the oldest entry (Map keeps insertion order).
      const oldest = this.seen.keys().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
    this.seen.delete(id)
    this.seen.set(id, nowMs)
    return true
  }

  /** Forget a write that failed, so the next check-in retries it. */
  forget(keyId: string, kind: SdkOriginKind): void {
    this.seen.delete(`${keyId}:${kind}`)
  }
}
