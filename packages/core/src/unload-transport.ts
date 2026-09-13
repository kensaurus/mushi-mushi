/**
 * FILE: packages/core/src/unload-transport.ts
 * PURPOSE: Pagehide-safe report delivery (fetch keepalive + sendBeacon).
 *
 * OVERVIEW:
 * - fetch({ keepalive: true }) keeps custom X-Mushi-* headers (Sentry 2024+ primary)
 * - sendBeacon cannot set headers, so it wraps credentials in a beacon envelope
 *   that only the same-origin tunnel unwraps
 *
 * NOTES:
 * - Beacon payloads over 60 KiB are skipped (browser sendBeacon limit ~64 KiB)
 * - Never put the API key in the query string
 */

export const MUSHI_BEACON_MAX_BYTES = 60 * 1024;

export interface MushiBeaconEnvelope {
  mushiBeacon: true;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export function isMushiBeaconEnvelope(value: unknown): value is MushiBeaconEnvelope {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return rec.mushiBeacon === true && typeof rec.path === 'string' && rec.headers !== null && typeof rec.headers === 'object';
}

export function buildBeaconEnvelope(opts: {
  path: string;
  headers: Record<string, string>;
  body: unknown;
}): MushiBeaconEnvelope {
  return {
    mushiBeacon: true,
    path: opts.path,
    headers: opts.headers,
    body: opts.body,
  };
}

/** True when the URL is same-origin or relative (safe for sendBeacon + tunnel). */
export function isSameOriginOrRelative(url: string, origin = typeof location !== 'undefined' ? location.origin : ''): boolean {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  if (!origin) return false;
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}

export function extractTunnelPath(url: string): string {
  try {
    const parsed = url.startsWith('/') ? new URL(url, 'https://tunnel.local') : new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export interface SendOnUnloadOptions {
  url: string;
  headers: Record<string, string>;
  body: string;
  path?: string;
  fetchImpl?: typeof fetch;
  sendBeacon?: (url: string, data: Blob) => boolean;
}

/**
 * Deliver one JSON POST during pagehide. Prefers fetch keepalive (headers).
 * Falls back to sendBeacon with a credential envelope on same-origin URLs.
 */
export function sendOnUnload(opts: SendOnUnloadOptions): boolean {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (fetchImpl) {
    try {
      void fetchImpl(opts.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...opts.headers,
        },
        body: opts.body,
        keepalive: true,
      });
      return true;
    } catch {
      // fall through to beacon
    }
  }

  const beacon = opts.sendBeacon ?? (typeof navigator !== 'undefined' ? navigator.sendBeacon?.bind(navigator) : undefined);
  if (!beacon || !isSameOriginOrRelative(opts.url)) return false;

  let parsedBody: unknown = opts.body;
  try {
    parsedBody = JSON.parse(opts.body) as unknown;
  } catch {
    parsedBody = opts.body;
  }

  const envelope = JSON.stringify(
    buildBeaconEnvelope({
      path: opts.path ?? extractTunnelPath(opts.url),
      headers: opts.headers,
      body: parsedBody,
    }),
  );
  if (envelope.length > MUSHI_BEACON_MAX_BYTES) return false;

  try {
    return beacon(opts.url, new Blob([envelope], { type: 'application/json' }));
  } catch {
    return false;
  }
}

let pageUnloading = false;

export function markPageUnloading(): void {
  pageUnloading = true;
}

export function isPageUnloading(): boolean {
  return pageUnloading;
}

/** Test-only reset. */
export function resetPageUnloadingForTests(): void {
  pageUnloading = false;
}
