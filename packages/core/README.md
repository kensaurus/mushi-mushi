# @mushi-mushi/core

Core types, API client, and utilities for the Mushi Mushi SDK.

> **You almost certainly don't need to install this directly.** Run `npx mushi-mushi` and the wizard will pick the right framework SDK ([`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react), [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue), [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte), [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular), [`@mushi-mushi/react-native`](https://npmjs.com/package/@mushi-mushi/react-native), [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor), or [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web)) which depends on this package.

## What's Inside

- **Types**: `MushiConfig`, `MushiReport`, `MushiEnvironment`, and all shared interfaces
- **API Client**: Fetch-based HTTP client with retry and exponential backoff. Tags every internal request with `X-Mushi-Internal: <kind>` so framework SDKs can filter their own traffic out of network capture and `apiCascade`. Ships HMAC-signed reporter helpers (`getLatestSdkVersion`, `listReporterReports`, `listReporterComments`, `replyToReporterReport`) for the two-way reply pipeline, plus `postDiscoveryEvent` (v2.1) for the passive inventory channel
- **Pre-Filter**: On-device Stage 0 spam/gibberish filter (runs client-side, zero server cost)
- **Offline Queue**: IndexedDB-backed queue with auto-sync on reconnect
- **Environment Capture**: Browser/device snapshot (viewport, user agent, connection info)
- **Reporter Token**: Anonymous persistent identity for report attribution
- **Session ID**: Tab-scoped session correlation
- **Rate Limiter**: Token bucket self-throttle to prevent API flooding

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
