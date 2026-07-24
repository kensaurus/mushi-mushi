---
'@mushi-mushi/core': minor
'@mushi-mushi/node': minor
'@mushi-mushi/web': minor
'@mushi-mushi/cli': minor
---

**SDK: PII scrubbing, XHR capture, hash-router inventory, and Node middleware hardening**

### @mushi-mushi/core
- New `scrubUrl(url, options?)` export: scrubs sensitive query-param keys (`token`, `password`, `api_key`, `secret`, `auth`, `session`, `email`, `phone`, `ssn`, JWT-shaped values under innocent keys) to `[Scrubbed]`, decodes percent-encoding before matching, handles hash-router query fragments (`#/path?query`), and never throws on malformed input.
- New `scrubPii(text)` export: redacts emails → `[REDACTED_EMAIL]`, phones → `[REDACTED_PHONE]`, JWT-shaped tokens (three dot-separated `eyJ…` segments) → `[REDACTED_JWT]`, SSNs → `[REDACTED_SSN]`, and CC-shaped strings → `[REDACTED_CC]`.

### @mushi-mushi/web
- **Global XHR capture**: `init()` now patches both `XMLHttpRequest` and `window.fetch`. Every network request — including legacy jQuery/axios XHR calls — is captured as a `MushiNetworkEntry` and appears in the Network breadcrumbs tab. `destroy()` removes the patches; if another APM tool (Sentry, Datadog) has since wrapped the same globals the SDK detects the unsafe state and leaves the native references alone.
- Network entries include `captureMethod: 'fetch' | 'xhr'` and an optional `correlationId` linking to synchronous console errors captured during the same request. URLs are PII-scrubbed at capture time (before truncation).
- **Hash-router inventory**: `discovery` now subscribes to `hashchange` and stores `'/#' + hashPath` entries so hash-routed SPAs appear in Inventory. `routeTemplates` authored with or without the `/#` prefix are both matched. Hash query params (`#/path?key=value`) are stripped before template matching; param *keys* (never values) are still collected for filter metadata.
- Timeline route/href fields are now passed through `scrubUrl` before storage.
- `beforeSend` hook 2s timeout now applies per-report (not globally).

### @mushi-mushi/node
- `captureReport` scrubs `description`, `environment.url`, `error.message`, and `error.stack` before the payload leaves the process.
- `mushiExpressErrorHandler` scrubs `req.originalUrl` with `scrubUrl` before embedding it in the report description.
- `mushiTraceMiddleware` scrubs the request URL for span names and `http.url` trace attributes.
- `mushiExpressErrorHandler` and `ExpressMiddlewareOptions` are now exported from the main entry point (`@mushi-mushi/node`).

### @mushi-mushi/cli
- `mushi doctor --host-app` (Check 7b) detects `HashRouter`/`createHashRouter`/`location.hash`/`hashchange` in host source files and warns when `/#/`-prefixed `routeTemplates` are missing from the Mushi init call. Advisory-only; runs under `--full` mode.
