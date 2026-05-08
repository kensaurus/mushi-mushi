import type { MushiSentryConfig, MushiSentryContext } from '@mushi-mushi/core';

/**
 * Sentry integration — boosted 2026-05-07.
 *
 * Goal: when a host has Sentry installed (v7, v8, or v9), every Mushi
 * report carries enough trace data for the admin to pivot directly into
 * Sentry's MCP / web UI without the user manually pasting links.
 *
 * Detection strategy:
 *   1. v8/v9 expose `Sentry.lastEventId()`, `Sentry.getCurrentScope()`,
 *      `Sentry.getReplay()`, `Sentry.getActiveSpan()`. The global lives
 *      under `window.Sentry`; the SDK wraps internals in
 *      `__SENTRY__.version === '8'` or `'9'`.
 *   2. v7 exposes `Sentry.getCurrentHub()` and writes hub state under
 *      `window.__SENTRY__.hub`.
 *   3. Replay can also be on `window.__SENTRY_REPLAY__` for sites that
 *      attach the replay integration manually.
 *
 * Every probe is wrapped in a `try/catch` because Sentry's APIs change
 * between point releases — a v8.13.0 method can throw "not a function"
 * on v8.0.0. We accept partial captures by design; the goal is "as much
 * context as we can get" rather than "all or nothing".
 */
export type { MushiSentryContext as SentryContext };

// ---- Detection layer --------------------------------------------------------

interface SentryV8Like {
  lastEventId?: () => string | undefined;
  getCurrentScope?: () => SentryScopeLike | undefined;
  getActiveSpan?: () => SentrySpanLike | undefined;
  getRootSpan?: (span: SentrySpanLike) => SentrySpanLike | undefined;
  getReplay?: () => SentryReplayLike | undefined;
  getClient?: () => SentryClientLike | undefined;
  setTag?: (key: string, value: string | number | boolean) => void;
  setContext?: (name: string, ctx: Record<string, unknown> | null) => void;
  addBreadcrumb?: (crumb: Record<string, unknown>) => void;
}

interface SentryV7Like {
  getCurrentHub?: () => SentryHubLike | undefined;
  setTag?: (key: string, value: string | number | boolean) => void;
  setContext?: (name: string, ctx: Record<string, unknown> | null) => void;
  addBreadcrumb?: (crumb: Record<string, unknown>) => void;
}

interface SentryHubLike {
  getClient?: () => SentryClientLike | undefined;
  getScope?: () => SentryScopeLike | undefined;
  configureScope?: (cb: (scope: SentryScopeLike) => void) => void;
}

interface SentryScopeLike {
  getLastEventId?: () => string | undefined;
  getUser?: () => Record<string, unknown> | undefined;
  getTags?: () => Record<string, string | number | boolean> | undefined;
  getTransactionName?: () => string | undefined;
  getTransaction?: () => { name?: string } | undefined;
  getSpan?: () => SentrySpanLike | undefined;
  getSession?: () => { sid?: string } | undefined;
  getBreadcrumbs?: () => Record<string, unknown>[] | undefined;
  setTag?: (key: string, value: string | number | boolean) => void;
  setContext?: (name: string, ctx: Record<string, unknown> | null) => void;
  // Internal API: most Sentry SDK versions expose breadcrumbs at
  // `_breadcrumbs` even when there's no public getter for it. We use
  // it as a last-resort fallback inside a try/catch.
  _breadcrumbs?: Record<string, unknown>[];
}

interface SentrySpanLike {
  spanContext?: () => { traceId?: string; spanId?: string };
  // v7 stored these directly on the span object.
  traceId?: string;
  spanId?: string;
}

interface SentryReplayLike {
  getReplayId?: () => string | undefined;
}

interface SentryClientLike {
  getOptions?: () => { release?: string; environment?: string; dsn?: string } | undefined;
  getDsn?: () => { projectId?: string; host?: string; publicKey?: string } | undefined;
}

function getSentryGlobal(): SentryV8Like | SentryV7Like | undefined {
  try {
    const w = globalThis as Record<string, unknown>;
    if (w.Sentry) return w.Sentry as SentryV8Like | SentryV7Like;
    return undefined;
  } catch {
    return undefined;
  }
}

function getSentryReplayGlobal(): SentryReplayLike | undefined {
  try {
    const w = globalThis as Record<string, unknown>;
    return w.__SENTRY_REPLAY__ as SentryReplayLike | undefined;
  } catch {
    return undefined;
  }
}

function detectSentrySdkFamily(): MushiSentryContext['sdk'] {
  try {
    const w = globalThis as Record<string, unknown>;
    const meta = w.__SENTRY__ as { version?: string } | undefined;
    const sentry = w.Sentry as Record<string, unknown> | undefined;
    if (meta?.version === '9' || (sentry && typeof sentry.lastEventId === 'function')) {
      // v9 dropped `getCurrentHub` entirely; presence of `lastEventId`
      // as a top-level fn distinguishes v8/v9 from v7.
      return meta?.version === '9' ? 'v9' : 'v8';
    }
    if (meta?.version === '8') return 'v8';
    if (sentry && typeof (sentry as SentryV7Like).getCurrentHub === 'function') return 'v7';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---- Public surface ---------------------------------------------------------

/**
 * Snapshot the current Sentry scope. `_config` is reserved for future
 * `useReplay`/`enrichWithSeer` toggles — for now every host that has
 * Sentry available gets the full snapshot.
 *
 * `breadcrumbsLimit` defaults to 30 (Sentry's own default `maxBreadcrumbs`).
 * Callers can pass a smaller value when ingest payload size matters
 * (mobile clients on lossy networks, etc.).
 */
export function captureSentryContext(
  _config: MushiSentryConfig,
  options: { breadcrumbsLimit?: number } = {},
): MushiSentryContext {
  const limit = Math.max(0, options.breadcrumbsLimit ?? 30);
  const out: MushiSentryContext = {};
  const sentry = getSentryGlobal();
  if (!sentry) return out;
  out.sdk = detectSentrySdkFamily();

  // 1) eventId — Sentry v8/v9 exposes a top-level `lastEventId()`. v7
  // pulls it off the active scope.
  try {
    const v8 = sentry as SentryV8Like;
    if (typeof v8.lastEventId === 'function') {
      out.eventId = v8.lastEventId() ?? undefined;
    } else {
      const v7 = sentry as SentryV7Like;
      const scope = v7.getCurrentHub?.()?.getScope?.();
      out.eventId = scope?.getLastEventId?.() ?? undefined;
    }
  } catch {
    // Swallow — different Sentry versions throw "not a function" on
    // arbitrary internals between point releases.
  }

  // 2) Scope — user / tags / transaction / breadcrumbs / session.
  let scope: SentryScopeLike | undefined;
  try {
    const v8 = sentry as SentryV8Like;
    if (typeof v8.getCurrentScope === 'function') {
      scope = v8.getCurrentScope();
    } else {
      const v7 = sentry as SentryV7Like;
      scope = v7.getCurrentHub?.()?.getScope?.();
    }
  } catch {
    // Sentry not available
  }
  if (scope) {
    try {
      const user = scope.getUser?.();
      if (user) {
        out.user = {
          id: typeof user.id === 'string' ? user.id : undefined,
          email: typeof user.email === 'string' ? user.email : undefined,
          username: typeof user.username === 'string' ? user.username : undefined,
          ip_address: typeof user.ip_address === 'string' ? user.ip_address : undefined,
        };
      }
    } catch {
      // Swallow — Sentry's scope methods change shape across releases.
    }
    try {
      const tags = scope.getTags?.();
      if (tags && typeof tags === 'object') {
        // Filter to scalar values — `setTag` accepts arrays in some
        // Sentry versions but our schema is scalar-only and the LLM
        // grounding relies on `key=string` shapes anyway.
        const pruned: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(tags)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            pruned[k] = v;
          }
        }
        if (Object.keys(pruned).length > 0) out.tags = pruned;
      }
    } catch {
      // Swallow.
    }
    try {
      // v8 uses `getTransactionName`; v7 used `getTransaction()?.name`.
      out.transactionName =
        scope.getTransactionName?.() ?? scope.getTransaction?.()?.name ?? undefined;
    } catch {
      // Swallow.
    }
    try {
      out.sessionId = scope.getSession?.()?.sid ?? undefined;
    } catch {
      // Swallow.
    }
    try {
      // Public getter when present, fall back to the internal `_breadcrumbs`
      // array which has lived at the same path since Sentry 5.
      const raw = scope.getBreadcrumbs?.() ?? scope._breadcrumbs ?? [];
      if (Array.isArray(raw) && raw.length > 0) {
        const sliced = raw.slice(-limit);
        out.breadcrumbs = sliced.map((b) => {
          const r = b as Record<string, unknown>;
          return {
            timestamp:
              typeof r.timestamp === 'number'
                ? // Sentry stores breadcrumb timestamps in seconds; convert
                  // to ms so the field is comparable to Mushi's own.
                  r.timestamp < 1e12
                  ? Math.round(r.timestamp * 1000)
                  : r.timestamp
                : undefined,
            category: typeof r.category === 'string' ? r.category : undefined,
            level: typeof r.level === 'string' ? r.level : undefined,
            message: typeof r.message === 'string' ? r.message : undefined,
            type: typeof r.type === 'string' ? r.type : undefined,
            data:
              r.data && typeof r.data === 'object'
                ? (r.data as Record<string, unknown>)
                : undefined,
          };
        });
      }
    } catch {
      // Swallow.
    }
  }

  // 3) Trace — ask Sentry for the active span and read its trace/span ids.
  try {
    const v8 = sentry as SentryV8Like;
    let span: SentrySpanLike | undefined;
    if (typeof v8.getActiveSpan === 'function') {
      span = v8.getActiveSpan();
    } else if (scope?.getSpan) {
      span = scope.getSpan();
    }
    if (span) {
      const ctx = span.spanContext?.();
      out.traceId = ctx?.traceId ?? span.traceId ?? undefined;
      out.spanId = ctx?.spanId ?? span.spanId ?? undefined;
    }
  } catch {
    // Swallow — `getActiveSpan` errored on v8.0.0 - v8.5.0 when no
    // tracing integration was configured. Reading is best-effort.
  }

  // 4) Client options — release + environment + DSN-derived issue url.
  let client: SentryClientLike | undefined;
  try {
    const v8 = sentry as SentryV8Like;
    if (typeof v8.getClient === 'function') {
      client = v8.getClient();
    } else {
      const v7 = sentry as SentryV7Like;
      client = v7.getCurrentHub?.()?.getClient?.();
    }
  } catch {
    // Swallow.
  }
  if (client) {
    try {
      const opts = client.getOptions?.();
      if (opts?.release) out.release = opts.release;
      if (opts?.environment) out.environment = opts.environment;
    } catch {
      // Swallow.
    }
    try {
      // DSN parts — used to synthesize a deeplink to the issue.
      const dsn = client.getDsn?.();
      if (dsn?.host && dsn?.projectId && out.eventId) {
        // The org slug is not directly exposed by Sentry's DSN object;
        // we synthesize the canonical events URL which Sentry redirects
        // to the right issue. Falls back to undefined when we can't
        // construct a valid URL.
        const orgHost = dsn.host.replace(/^o\d+\./, '');
        out.issueUrl = `https://${orgHost}/issues/?query=${encodeURIComponent(out.eventId)}`;
      }
    } catch {
      // Swallow.
    }
  }

  // 5) Replay — try the modern `getReplay()` first, fall back to the
  // legacy `__SENTRY_REPLAY__` global some integrations attach manually.
  try {
    const v8 = sentry as SentryV8Like;
    const replay = v8.getReplay?.() ?? getSentryReplayGlobal();
    out.replayId = replay?.getReplayId?.() ?? undefined;
  } catch {
    // Swallow.
  }

  return out;
}

/**
 * Bidirectional linkage. Call this *after* a successful Mushi report
 * submission with the server-assigned report id. We drop a tag on
 * Sentry's current scope so any subsequent Sentry events from the
 * same session reference the Mushi report. We also write a
 * `mushi_report` context block that the Sentry MCP `search_events`
 * tool surfaces on the issue page.
 *
 * Best-effort and silent on failure — a Sentry that's mid-bootstrap
 * or an SDK version with a different scope API must never break a
 * report that's already been accepted by Mushi.
 */
export function tagSentryScope(reportId: string, options: { reportUrl?: string } = {}): void {
  const sentry = getSentryGlobal();
  if (!sentry) return;
  try {
    // v8/v9: top-level `setTag` + `setContext` write to the active scope.
    const v8 = sentry as SentryV8Like;
    if (typeof v8.setTag === 'function') {
      v8.setTag('mushi.report_id', reportId);
      if (options.reportUrl) v8.setTag('mushi.report_url', options.reportUrl);
    }
    if (typeof v8.setContext === 'function') {
      v8.setContext('mushi_report', {
        id: reportId,
        ...(options.reportUrl ? { url: options.reportUrl } : {}),
        captured_at: new Date().toISOString(),
      });
    }
    // Also drop a Sentry breadcrumb so the link is visible in the
    // breadcrumb timeline of the next Sentry event the user
    // produces, not just on the scope.
    if (typeof v8.addBreadcrumb === 'function') {
      v8.addBreadcrumb({
        category: 'mushi',
        type: 'info',
        level: 'info',
        message: `Mushi report submitted (${reportId})`,
        data: { report_id: reportId, ...(options.reportUrl ? { url: options.reportUrl } : {}) },
      });
    }
  } catch {
    // Sentry not available
  }

  // v7 fallback: configure the scope on the active hub.
  try {
    const v7 = sentry as SentryV7Like;
    const scope = v7.getCurrentHub?.()?.getScope?.();
    if (scope) {
      scope.setTag?.('mushi.report_id', reportId);
      if (options.reportUrl) scope.setTag?.('mushi.report_url', options.reportUrl);
      scope.setContext?.('mushi_report', {
        id: reportId,
        ...(options.reportUrl ? { url: options.reportUrl } : {}),
      });
    }
  } catch {
    // Swallow.
  }
}

// ---- Feedback interceptor (kept from prior revision) -----------------------

export interface SentryFeedbackInterceptor {
  start(): void;
  stop(): void;
}

export function createSentryFeedbackInterceptor(
  _config: MushiSentryConfig,
  onFeedback: (feedback: { eventId?: string; message: string; email?: string; name?: string }) => void,
): SentryFeedbackInterceptor {
  let observer: MutationObserver | null = null;

  function start() {
    if (typeof MutationObserver === 'undefined') return;

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.getAttribute('data-sentry-feedback')) {
            interceptFeedbackForm(node);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function interceptFeedbackForm(container: HTMLElement) {
    const form = container.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', () => {
      const formData = new FormData(form);
      onFeedback({
        message: (formData.get('message') as string) ?? '',
        email: (formData.get('email') as string) ?? undefined,
        name: (formData.get('name') as string) ?? undefined,
      });
    });
  }

  function stop() {
    observer?.disconnect();
    observer = null;
  }

  return { start, stop };
}
