# @mushi-mushi/core

> **Your AI wrote it. Mushi tells you why it broke.**

Core types, API client, and shared utilities for every Mushi SDK package.

> **You almost certainly don't need to install this directly.** Run `npx mushi-mushi` and the wizard will pick the right framework SDK ([`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react), [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue), [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte), [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular), [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native), [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor), or [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web)) which depends on this package.

## What's Inside

- **Types**: `MushiConfig`, `MushiReport`, `MushiEnvironment`, and all shared interfaces
- **API Client**: Fetch-based HTTP client with retry and exponential backoff. Tags every internal request with `X-Mushi-Internal: <kind>` so framework SDKs can filter their own traffic out of network capture and `apiCascade`. Ships HMAC-signed reporter helpers (`getLatestSdkVersion`, `listReporterReports`, `listReporterComments`, `replyToReporterReport`) for the two-way reply pipeline, plus `postDiscoveryEvent` (v2.1) for the passive inventory channel
- **Pre-Filter**: On-device Stage 0 spam/gibberish filter (runs client-side, zero server cost)
- **Offline Queue**: IndexedDB-backed queue with auto-sync on reconnect
- **Environment Capture**: Browser/device snapshot — viewport, user agent (with **User-Agent Client Hints** when supported), connection info, screen + DPR, accessibility prefs (`prefers-reduced-motion`, `prefers-color-scheme`, `prefers-contrast`), online/displayMode/title, and a one-shot **page load timing** read from `PerformanceNavigationTiming` (TTFB, DOMContentLoaded, FCP, LCP)
- **Reporter Token**: Anonymous persistent identity for report attribution
- **Session ID**: Tab-scoped session correlation
- **Rate Limiter**: Token bucket self-throttle to prevent API flooding
- **Breadcrumb Buffer** (1.0+ — `createBreadcrumbBuffer`): 50-entry ring of `{timestamp, category, level, message, data?}` rows; framework SDKs auto-capture route changes, `console.error/warn`, `[data-testid]` clicks, and SDK lifecycle events. Snapshot is attached to every `MushiReport` (server promotes it to a dedicated `reports.breadcrumbs` jsonb column for GIN-indexed filtering)
- **Exception Normaliser** (1.0+ — `normaliseThrown`): turns any thrown value (`Error`, string, plain object, `null`, `undefined`) into a stable `{ name, message, stack?, cause? }` shape with truncated stacks and cyclic-cause guards. Powers `Mushi.captureException()` in `@mushi-mushi/web`

## Public types added in 0.7 → 0.11

| Type                       | Purpose                                                                                       |
|----------------------------|-----------------------------------------------------------------------------------------------|
| `MushiPreset`              | `'production-calm' \| 'beta-loud' \| 'internal-debug' \| 'manual-only'` posture bundles.      |
| `MushiWidgetAnchor`        | Raw-CSS positioning (`top` / `right` / `bottom` / `left`) for the widget launcher.            |
| `MushiPrivacyConfig`       | `maskSelectors`, `blockSelectors`, `allowUserRemoveScreenshot` for screenshot redaction.       |
| `MushiUrlMatcher`          | `string \| RegExp` element used by `capture.ignoreUrls` and `apiCascade.ignoreUrls`.          |
| `MushiApiCascadeConfig`    | Object form of `proactive.apiCascade` so URL filters can be declared per-host-app.            |
| `MushiDiagnosticsResult`   | Return shape of `Mushi.diagnose()` (CSP, runtime-config, capture, widget health).             |
| `MushiSdkVersionInfo`      | Response shape for `getLatestSdkVersion(packageName)`; powers the outdated-banner UI.         |
| `MushiTimelineEntry`       | `{ ts, kind: 'route' \| 'click' \| 'request' \| 'log' \| 'screen', payload }` repro entries. |
| `MushiReporterReport`      | Reporter-facing report row (HMAC-authed) with `unread_count` for the widget badge.            |
| `MushiReporterComment`     | Reporter-facing comment row (HMAC-authed) tagged `author_kind: 'admin' \| 'reporter'`.        |
| `MushiDiscoverInventoryConfig` | Mushi v2.1 — fine-grained controls for `capture.discoverInventory` (`enabled`, `throttleMs`, `routeTemplates`, `userIdSource`, `captureDomSummary`). Pass `true` for defaults. |
| `MushiDiscoveryEventPayload`   | Mushi v2.1 — wire shape for `POST /v1/sdk/discovery`. Mirrored server-side by `_shared/schemas.ts::discoveryEventSchema`; route + page title + testids + network paths + query-param **keys only** + sha256 user id hash. |
| `MushiBreadcrumb`              | 1.0+ — `{ timestamp, category, level: 'debug' \| 'info' \| 'warning' \| 'error' \| 'critical', message, data? }`. Mirrors the Sentry breadcrumb shape so the admin can interleave Mushi + Sentry breadcrumbs on one timeline. |
| `MushiSentryContext`           | 1.0+ — rich Sentry handshake the SDK captures via `@sentry/browser` v7/v8/v9: `eventId`, `replayId`, `traceId`, `spanId`, `transaction`, `release`, `environment`, `user`, `tags`, `breadcrumbs`, `issueUrl`, `mushiReportId` (bidirectional). |
| `MushiCaptureExceptionOptions` | 1.0+ — options for `Mushi.captureException(err, opts)`: `level`, `tags`, `extras`, `category`, `userIntent` overrides for the structured report. |
| `NormalisedException`          | 1.0+ — return type of `normaliseThrown(err)` (`{ name, message, stack?, cause? }`); used internally by `captureException` and exposed for adapters that want to ship their own thin wrappers. |
| `MushiBannerLink`              | 1.8+ — flat action on the rich banner layout: `{ label, href? }` opens an external URL in a new tab, `{ label, featureRequest: true }` opens the widget in feature-request mode. Consumed via `MushiBannerConfig.links`. |
| `screenshotSensitiveHint` (on `MushiWidgetConfig`) | 1.19+ — privacy caption under the screenshot preview: `true` = localized default, `string` = custom copy, `false` = hide caption (preview + Remove remain). Console-configurable via `GET /v1/sdk/config`. See [`docs/SDK_SCREENSHOT_PREVIEW.md`](../../docs/SDK_SCREENSHOT_PREVIEW.md). |

Constants: `MUSHI_INTERNAL_HEADER` (`'X-Mushi-Internal'`),
`MUSHI_INTERNAL_INIT_MARKER`, and the `MushiInternalRequestKind` literal union
are re-exported so framework adapters can build their own self-noise filters.

## Usage

```typescript
import {
  createApiClient,
  createPreFilter,
  captureEnvironment,
  createRateLimiter,
  MUSHI_INTERNAL_HEADER,
} from '@mushi-mushi/core';
```

This package is used internally by `@mushi-mushi/web` and `@mushi-mushi/react`. Most consumers should use those packages instead.

## Bundle Size

~3.15 KB brotli (limit: 15 KB)

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 51 edge functions · 298 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
