---
"@mushi-mushi/core": major
"@mushi-mushi/web": major
"@mushi-mushi/react": major
---

SDK observability v1 — Sentry-style breadcrumbs, sticky tags, structured `captureException`, and a rich Sentry handshake.

The SDK now ships a first-class observability surface so the bug your monitoring missed lands in Mushi alongside the route, the breadcrumb trail, the active Sentry trace, and any tags you've stuck on the session — without the embedder having to plumb that context through the report payload by hand.

This is the **1.0** milestone we've been tagging in the readmes: the public APIs introduced here are the ones we'll keep stable through the rest of the v1 line. There are no breaking changes from v0.9 — every new method is additive — but the version bump signals "this surface is now the supported way to enrich Mushi reports".

### `@mushi-mushi/web` — power-user instance methods

```typescript
const mushi = Mushi.init({ projectId: 'proj_xxx', apiKey: 'mushi_xxx' });

// Identify the active reporter (also forwarded to @sentry/browser if loaded).
mushi.identify({ id: 'usr_42', email: 'aya@example.com', segment: 'beta' });

// Sticky scalar tags. Up to 64 keys; values are string | number | boolean.
// Tags ride on every subsequent report and are GIN-indexed server-side
// (`?tag=plan:pro` filter on /v1/admin/reports).
mushi.setTag('feature', 'checkout-v2');
mushi.setTags({ plan: 'pro', region: 'apac', experiment: 'B' });
mushi.clearTag('experiment');

// Manual breadcrumbs. Route changes / console.error / [data-testid] clicks
// are captured automatically by `installAutoBreadcrumbs()`.
mushi.addBreadcrumb({
  category: 'business',
  level: 'info',
  message: 'cart.checkout_started',
  data: { itemCount: 3, currency: 'JPY' },
});

// Structured exception capture. Accepts Error, string, plain object, null,
// or undefined — anything `try { } catch (e) { }` can land on. The SDK
// normalises the throw, attaches the breadcrumb buffer + sticky tags +
// active Sentry context, and submits as a `bug` report.
try {
  await runCheckout();
} catch (err) {
  mushi.captureException(err, {
    level: 'error',
    tags: { surface: 'checkout' },
    extras: { orderId: 'ord_123' },
  });
}
```

### `@mushi-mushi/web` — Sentry handshake v2

The widget now auto-detects `@sentry/browser` v7 / v8 / v9 and captures the full active scope into `MushiReport.sentryContext`: `eventId`, `replayId`, `traceId`, `spanId`, `transaction`, `release`, `environment`, `user`, breadcrumbs, tags, and a deep-link `issueUrl`. In the other direction, every Sentry event raised after a Mushi report is tagged with `mushi.report_id`, so the admin's report drawer can render `Open in Sentry →` and the Sentry issue page can deep-link back into Mushi without any host-app glue code.

### `@mushi-mushi/core` — new public modules

- **`createBreadcrumbBuffer(options?)`** — 50-entry ring buffer of `{ timestamp, category, level, message, data? }`. Long messages truncate at 500 chars *at insert time* so a runaway log line can't push useful crumbs out of the buffer. PII scrubbing runs at report-snapshot time (not at insert) so in-app debugging stays unredacted while the wire payload stays clean.
- **`normaliseThrown(thrown)`** — turns any thrown value (`Error`, string, plain object, `null`, frozen `DOMException`) into `{ name, message, stack?, cause? }` with an 8 KB stack cap and cyclic-cause guards. Powers `Mushi.captureException()`; exposed so adapters (Vue / Svelte / Angular / RN) can ship their own thin wrappers without re-implementing the normalisation.
- **`captureEnvironment()` expansion** — same one-call API, richer payload: viewport + screen + DPR, **User-Agent Client Hints** when supported (`brands`, `mobile`, `platform`, `model`, plus the high-entropy values resolved out-of-band and folded back in on the next capture), accessibility prefs (`prefers-reduced-motion`, `prefers-color-scheme`, `prefers-contrast`), online / displayMode / page title, and a one-shot **page-load timing** read from `PerformanceNavigationTiming` (TTFB, DOMContentLoaded, FCP, LCP). Every individual field stays optional so a Safari / Firefox / iOS WebView still produces a useful payload.

### New public types

| Type | Notes |
|---|---|
| `MushiBreadcrumb` | `{ timestamp, category, level: 'debug' \| 'info' \| 'warning' \| 'error' \| 'critical', message, data? }`. Mirrors the Sentry breadcrumb shape so the admin can interleave Mushi + Sentry breadcrumbs on one timeline. |
| `MushiSentryContext` | Rich Sentry handshake captured via `@sentry/browser`. Exposed as `SentryContext` re-export from `@mushi-mushi/web`. |
| `MushiCaptureExceptionOptions` | `{ level?, tags?, extras?, category?, userIntent? }` overrides passed to `captureException(err, opts)`. |
| `NormalisedException` | Return type of `normaliseThrown(err)`. |

### Server-side enrichment (already shipped)

The Mushi server promotes the new fields to dedicated columns: `reports.breadcrumbs` (jsonb, GIN-indexed), `reports.tags` (jsonb, GIN-indexed), and `reports.sentry_trace_id` / `reports.sentry_release` / `reports.sentry_environment` (each backed by a partial b-tree index). The admin's `GET /v1/admin/reports` endpoint accepts `?tag=key:value`, `?trace=<sentry_trace_id>`, `?release=<…>`, and `?sentryEnv=<…>` for filtered/cross-linked views. Deduplication groups still apply, and the list-row hover popover (`BreadcrumbPeek`) renders the last 5 SDK breadcrumbs without an N+1 fetch.

### Migration

No breaking changes. `Mushi.init()` keeps its existing config shape; the new instance methods are additive. To opt in to auto-breadcrumbs, call `installAutoBreadcrumbs()` once after `init()` (or omit it — manual `addBreadcrumb()` continues to work either way). PII scrubbing remains opt-out per the existing `capture.scrubPii` config.

`@mushi-mushi/react` re-exports the new types and methods through its hook surface; no consumer code change needed beyond bumping the dependency.
