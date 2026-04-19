/**
 * Wave E §3c — stable device fingerprint hash.
 *
 * Hashes a deliberately small set of long-lived device characteristics so
 * the same browser keeps the same hash across sessions, but moving to a
 * new browser/device produces a different one. This lets the server
 * detect cross-account abuse (same hash → many reporter accounts) without
 * needing fingerprint.js or any other entropy-heavy library.
 *
 * Privacy notes:
 *   - We never send the raw inputs, only the SHA-256 hex digest.
 *   - The set is intentionally low-entropy on purpose; this is "is this the
 *     same device" not "who is this user". For high-stakes anti-fraud you
 *     should still combine with server-side IP/geo signals.
 *   - Cached in localStorage so subsequent calls are zero-cost.
 */

const CACHE_KEY = 'mushi_fingerprint_hash';

interface FingerprintInputs {
  userAgent: string;
  platform: string;
  language: string;
  timezone: string;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  deviceMemory: number | undefined;
  hardwareConcurrency: number | undefined;
}

function collectInputs(): FingerprintInputs {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const scr = typeof screen !== 'undefined' ? screen : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;
  return {
    userAgent: nav?.userAgent ?? 'unknown',
    platform: nav?.platform ?? 'unknown',
    language: nav?.language ?? 'en',
    timezone: Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone ?? 'UTC',
    screenWidth: scr?.width ?? 0,
    screenHeight: scr?.height ?? 0,
    pixelRatio: win?.devicePixelRatio ?? 1,
    deviceMemory: (nav as NavigatorWithDeviceMemory | undefined)?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
  };
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback (Node 18+ test envs, very old browsers): non-cryptographic but
  // good enough for the "are these two requests from the same device" use
  // case the server makes of this value.
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `fbk_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Returns a stable per-device hash. Cached in localStorage; first call is
 * one SHA-256, subsequent calls are a localStorage read.
 *
 * Returns `null` outside browser-like environments (SSR, web workers
 * without crypto.subtle) so callers can omit the field gracefully.
 */
export async function getDeviceFingerprintHash(): Promise<string | null> {
  if (typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) return cached;
  }

  const inputs = collectInputs();
  const serialised = JSON.stringify(inputs);
  const hash = await sha256Hex(serialised);

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(CACHE_KEY, hash);
    } catch {
      // localStorage quota / private mode — caller still gets the hash.
    }
  }
  return hash;
}

/** Test/diagnostic helper — never include in shipped reports. */
export function _resetFingerprintCacheForTests(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // ignore
    }
  }
}
