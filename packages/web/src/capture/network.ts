import type { MushiNetworkEntry, MushiUrlMatcher, MushiTracePropagationConfig } from '@mushi-mushi/core';
import { getInternalRequestKind, getRequestUrl, shouldIgnoreMushiUrl } from '../internal-requests';

const MAX_ENTRIES = 30;

// W3C traceparent version byte (always "00" for the current spec).
const TRACEPARENT_VERSION = '00';

/**
 * Generate a cryptographically random W3C traceparent header value.
 *
 * Format: 00-<traceId:32hex>-<spanId:16hex>-01
 * We use the Web Crypto API (always available in modern browsers and Deno).
 * This is intentionally hand-rolled (~20 lines) to avoid pulling the full
 * OTel JS SDK into the widget bundle.
 */
function generateTraceparent(): { traceparent: string; traceId: string; spanId: string } {
  const traceBytes = crypto.getRandomValues(new Uint8Array(16));
  const spanBytes = crypto.getRandomValues(new Uint8Array(8));
  const toHex = (bytes: Uint8Array) =>
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const traceId = toHex(traceBytes);
  const spanId = toHex(spanBytes);
  return {
    traceparent: `${TRACEPARENT_VERSION}-${traceId}-${spanId}-01`,
    traceId,
    spanId,
  };
}

/**
 * Returns true if `url` matches any entry in the corsUrls allowlist.
 * Strings are substring-matched; RegExp values are tested against the full URL.
 */
function matchesCorsUrls(url: string, corsUrls: Array<string | RegExp>): boolean {
  for (const pattern of corsUrls) {
    if (typeof pattern === 'string') {
      if (url.includes(pattern)) return true;
    } else {
      if (pattern.test(url)) return true;
    }
  }
  return false;
}

export interface NetworkCapture {
  getEntries(): MushiNetworkEntry[];
  clear(): void;
  updateOptions(options: NetworkCaptureOptions): void;
  destroy(): void;
}

export interface NetworkCaptureOptions {
  apiEndpoint?: string;
  ignoreUrls?: MushiUrlMatcher[];
  tracePropagation?: MushiTracePropagationConfig;
  sessionId?: string;
}

export function createNetworkCapture(options: NetworkCaptureOptions = {}): NetworkCapture {
  const entries: MushiNetworkEntry[] = [];
  const originalFetch = globalThis.fetch;
  let activeOptions = options;

  // eslint-disable-next-line prefer-const
  let fetchWrapper: typeof globalThis.fetch;
  globalThis.fetch = fetchWrapper = async function mushiFetchInterceptor(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startTime = Date.now();
    const method = init?.method?.toUpperCase() ?? 'GET';
    const url = getRequestUrl(input);
    const internalKind = getInternalRequestKind(input, init);
    const shouldRecord = !internalKind && !shouldIgnoreMushiUrl(url, activeOptions);

    // Inject W3C traceparent when trace propagation is enabled and the URL
    // matches the allowlist. We create a new RequestInit to avoid mutating
    // the caller's object.
    let traceId: string | undefined;
    let patchedInit = init;

    const tp = activeOptions.tracePropagation;
    if (
      shouldRecord &&
      tp?.enabled &&
      tp.corsUrls?.length &&
      matchesCorsUrls(url, tp.corsUrls)
    ) {
      const { traceparent, traceId: tid } = generateTraceparent();
      traceId = tid;
      const existingHeaders = init?.headers
        ? new Headers(init.headers as HeadersInit)
        : new Headers();
      existingHeaders.set('traceparent', traceparent);
      if (activeOptions.sessionId) {
        existingHeaders.set('x-mushi-session', activeOptions.sessionId);
      }
      patchedInit = { ...init, headers: existingHeaders };
    }

    try {
      const response = await originalFetch.call(globalThis, input, patchedInit);

      if (shouldRecord) {
        addEntry({
          method,
          url: truncateUrl(url),
          status: response.status,
          duration: Date.now() - startTime,
          timestamp: startTime,
          ...(traceId ? { traceId } : {}),
        });
      }

      return response;
    } catch (error) {
      if (shouldRecord) {
        addEntry({
          method,
          url: truncateUrl(url),
          status: 0,
          duration: Date.now() - startTime,
          timestamp: startTime,
          error: error instanceof Error ? error.message : 'Network error',
          ...(traceId ? { traceId } : {}),
        });
      }
      throw error;
    }
  };

  function addEntry(entry: MushiNetworkEntry): void {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.shift();
    }
  }

  return {
    getEntries() {
      return [...entries];
    },
    clear() {
      entries.length = 0;
    },
    updateOptions(nextOptions) {
      activeOptions = nextOptions;
    },
    destroy() {
      // Only restore if our wrapper is still active — prevents clobbering
      // another tool's fetch instrumentation (Sentry, Datadog, etc.) that
      // may have wrapped on top of us after Mushi initialized.
      if (globalThis.fetch === fetchWrapper) {
        globalThis.fetch = originalFetch;
      }
    },
  };
}

function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (path.length > 200) {
      return parsed.origin + path.slice(0, 200) + '...';
    }
    return parsed.origin + path;
  } catch {
    return url.slice(0, 200);
  }
}
