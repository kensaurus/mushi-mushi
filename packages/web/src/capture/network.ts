import type { MushiNetworkEntry, MushiUrlMatcher, MushiTracePropagationConfig } from '@mushi-mushi/core';
import { scrubUrl } from '@mushi-mushi/core';
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

/**
 * Active-request correlation tracker (Phase 3b).
 *
 * When a network request is in-flight we push its correlationId onto this stack.
 * Any console.error/warn or addBreadcrumb() that fires synchronously during the
 * request's lifetime (e.g. inside a catch block that immediately calls console.error)
 * can read the current active ID via `getActiveCorrelationId()`.
 *
 * This is intentionally best-effort.  The correlationId is stamped on the
 * network entry itself (always reliable) — prefer correlating via that field.
 * `getActiveCorrelationId()` is also available synchronously, but coverage is
 * limited:
 *   - ✗ Does NOT work in the caller's own catch block.  JavaScript runs the
 *     wrapper's `finally` (which pops the ID) before the outer `catch` block
 *     executes, so `getActiveCorrelationId()` returns `undefined` there.
 *   - ✗ Does NOT track log lines emitted in other async microtasks scheduled
 *     while a request is in-flight.
 *   - ✓ Works for synchronous console calls made within the mushi wrapper's
 *     own catch/finally (the network entry is already stamped at that point).
 * The ID is exposed as a module-level export so the console capturer and
 * breadcrumb module can read it for cases where it IS available.
 */
const _activeCorrelationStack: string[] = [];

/** Returns the correlationId of the innermost active network request, if any. */
export function getActiveCorrelationId(): string | undefined {
  return _activeCorrelationStack[_activeCorrelationStack.length - 1];
}

/** Generate a compact 8-hex-char correlation ID.  Not cryptographically important. */
function generateCorrelationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function createNetworkCapture(options: NetworkCaptureOptions = {}): NetworkCapture {
  const entries: MushiNetworkEntry[] = [];
  const originalFetch = globalThis.fetch;

  // Capture the original XHR prototype methods before any other library patches them.
  // We only patch if XMLHttpRequest exists (browser / Capacitor WebView).
  const OriginalXHR = typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : null;
  const originalXhrOpen = OriginalXHR ? XMLHttpRequest.prototype.open : null;
  const originalXhrSend = OriginalXHR ? XMLHttpRequest.prototype.send : null;
  const originalXhrSetRequestHeader = OriginalXHR ? XMLHttpRequest.prototype.setRequestHeader : null;

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

    // Phase 3b: generate a correlationId for this request so that console entries
    // and breadcrumbs emitted during this request can be linked back to it.
    const correlationId = shouldRecord ? generateCorrelationId() : undefined;

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

    // Push correlationId onto the active stack so synchronously-called console/breadcrumb
    // capturers can read it (e.g. a catch block that calls console.error immediately).
    if (correlationId) _activeCorrelationStack.push(correlationId);

    try {
      const response = await originalFetch.call(globalThis, input, patchedInit);

      if (shouldRecord) {
        addEntry({
          method,
          url: truncateUrl(url),
          status: response.status,
          duration: Date.now() - startTime,
          timestamp: startTime,
          captureMethod: 'fetch',
          ...(traceId ? { traceId } : {}),
          ...(correlationId ? { correlationId } : {}),
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
          captureMethod: 'fetch',
          ...(traceId ? { traceId } : {}),
          ...(correlationId ? { correlationId } : {}),
        });
      }
      throw error;
    } finally {
      // Pop our ID off the correlation stack regardless of success/error.
      if (correlationId) {
        const idx = _activeCorrelationStack.lastIndexOf(correlationId);
        if (idx !== -1) _activeCorrelationStack.splice(idx, 1);
      }
    }
  };

  // ── Phase 3a: XHR capture ────────────────────────────────────────────────
  // Many popular HTTP libraries (axios ≤1.x, jQuery, legacy code) use
  // XMLHttpRequest rather than fetch.  We monkey-patch the three lifecycle
  // methods to mirror the fetch capture logic above.
  //
  // We use a WeakMap keyed on the XHR instance to store per-request state
  // so we don't pollute the public XHR object.
  type XhrState = {
    method: string;
    url: string;
    startTime: number;
    traceId?: string;
    correlationId?: string;
    shouldRecord: boolean;
    /** readystatechange handler registered during send(); stored here so that
     *  open() can removeEventListener on XHR reuse, preventing duplicate /
     *  garbled entries (both the stale and the new listener would otherwise
     *  fire on the second request's completion). */
    _listener?: () => void;
  };
  const xhrStateMap = typeof WeakMap !== 'undefined' ? new WeakMap<XMLHttpRequest, XhrState>() : null;

  if (OriginalXHR && originalXhrOpen && originalXhrSend && originalXhrSetRequestHeader && xhrStateMap) {
    // Note: XMLHttpRequest.prototype.open has two overloads; we use Function.prototype.apply
    // to avoid TypeScript overload complaints while still intercepting every call.
    const _originalOpen = originalXhrOpen as (...args: unknown[]) => void;

    XMLHttpRequest.prototype.open = function mushiXhrOpen(
      this: XMLHttpRequest,
      ...args: Parameters<typeof XMLHttpRequest.prototype.open>
    ): void {
      const [method, url] = args;
      const urlStr = typeof url === 'string' ? url : String(url);
      // Note: we omit the `getInternalRequestKind` header check used by the
      // fetch path.  XHR headers are set via setRequestHeader() (called after
      // open(), usually before send()), so they are not available here in
      // open().  URL-based filtering via shouldIgnoreMushiUrl covers all
      // Mushi-internal traffic; the SDK's own ingest calls always use fetch.
      const shouldRecord = !shouldIgnoreMushiUrl(urlStr, activeOptions);
      const correlationId = shouldRecord ? generateCorrelationId() : undefined;

      // Determine traceparent ahead of time so we can store it and inject it in .send().
      let traceId: string | undefined;
      let storedTraceparent: string | undefined;

      const tp = activeOptions.tracePropagation;
      if (shouldRecord && tp?.enabled && tp.corsUrls?.length && matchesCorsUrls(urlStr, tp.corsUrls)) {
        const generated = generateTraceparent();
        traceId = generated.traceId;
        storedTraceparent = generated.traceparent;
      }

      // On XHR reuse (open → send → open → send), remove the stale
      // readystatechange listener from the previous send() before overwriting
      // state.  Without this, both the old and the new listener fire on the
      // second request's completion, producing a garbled duplicate entry
      // (old url/method with the new response's status code).
      const _prevXhrState = xhrStateMap.get(this);
      if (_prevXhrState?._listener) {
        this.removeEventListener('readystatechange', _prevXhrState._listener);
      }

      xhrStateMap.set(this, {
        method: String(method).toUpperCase(),
        url: truncateUrl(urlStr),
        startTime: 0, // set in .send()
        shouldRecord,
        ...(traceId ? { traceId } : {}),
        ...(correlationId ? { correlationId } : {}),
        // Attach the traceparent string as an extra prop for injection in .send().
        ...(storedTraceparent ? { _traceparent: storedTraceparent } : {}),
      } as XhrState & { _traceparent?: string });

      _originalOpen.apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.send = function mushiXhrSend(body?: Document | XMLHttpRequestBodyInit | null): void {
      const state = xhrStateMap.get(this) as (XhrState & { _traceparent?: string }) | undefined;
      if (state) {
        state.startTime = Date.now();

        // Inject W3C headers now that open() has been called.
        // Use the traceparent generated during open() to keep traceId consistent.
        const xhrTraceparent = (state as { _traceparent?: string })._traceparent;
        if (xhrTraceparent) {
          originalXhrSetRequestHeader!.call(this, 'traceparent', xhrTraceparent);
          if (activeOptions.sessionId) {
            originalXhrSetRequestHeader!.call(this, 'x-mushi-session', activeOptions.sessionId);
          }
        }

        // Push correlation ID so synchronous readystatechange handlers can read it.
        if (state.correlationId) _activeCorrelationStack.push(state.correlationId);

        // Store the handler on state so that open() can removeEventListener on
        // XHR reuse (see the cleanup block in the open() override above).
        const _readystateHandler = () => {
          if (this.readyState !== 4) return; // DONE

          // Mirror fetch: skip SDK-internal / ignoreUrls traffic so it does not
          // pollute the MAX_ENTRIES ring buffer.
          if (state.shouldRecord) {
            const duration = Date.now() - state.startTime;
            const entry: MushiNetworkEntry = {
              method: state.method,
              url: state.url,
              status: this.status,
              duration,
              timestamp: state.startTime,
              captureMethod: 'xhr',
              ...(state.traceId ? { traceId: state.traceId } : {}),
              ...(state.correlationId ? { correlationId: state.correlationId } : {}),
            };
            if (this.status === 0) {
              entry.error = 'XHR network error or aborted';
            }
            addEntry(entry);
          }

          // Pop correlationId after the final state change.
          if (state.correlationId) {
            const idx = _activeCorrelationStack.lastIndexOf(state.correlationId);
            if (idx !== -1) _activeCorrelationStack.splice(idx, 1);
          }
        };
        state._listener = _readystateHandler;
        this.addEventListener('readystatechange', _readystateHandler);
      }

      originalXhrSend!.call(this, body);
    };
  }

  // Capture the wrappers we installed so destroy() can refuse to restore when
  // another tool (Sentry, Datadog, …) has wrapped XHR on top of us.
  const xhrOpenWrapper = OriginalXHR ? XMLHttpRequest.prototype.open : null;
  const xhrSendWrapper = OriginalXHR ? XMLHttpRequest.prototype.send : null;

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
      // Only restore fetch if our wrapper is still active — prevents clobbering
      // another tool's fetch instrumentation (Sentry, Datadog, etc.) that
      // may have wrapped on top of us after Mushi initialized.
      if (globalThis.fetch === fetchWrapper) {
        globalThis.fetch = originalFetch;
      }
      // Restore XHR only if our wrappers are still the active ones — same
      // clobber-prevention as fetch above (Sentry breadcrumbs wrap XHR too).
      if (OriginalXHR && originalXhrOpen && originalXhrSend) {
        if (xhrOpenWrapper && XMLHttpRequest.prototype.open === xhrOpenWrapper) {
          XMLHttpRequest.prototype.open = originalXhrOpen;
        }
        if (xhrSendWrapper && XMLHttpRequest.prototype.send === xhrSendWrapper) {
          XMLHttpRequest.prototype.send = originalXhrSend;
        }
      }
    },
  };
}

function truncateUrl(url: string): string {
  // Scrub query-string PII (token/email/JWT values) BEFORE truncation so a
  // long path can never push a secret past the cut and back again on replay.
  const scrubbed = scrubUrl(url);
  try {
    const parsed = new URL(scrubbed);
    const path = parsed.pathname + parsed.search;
    if (path.length > 200) {
      return parsed.origin + path.slice(0, 200) + '...';
    }
    return parsed.origin + path;
  } catch {
    return scrubbed.slice(0, 200);
  }
}
