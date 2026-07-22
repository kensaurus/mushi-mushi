---
"@mushi-mushi/web": minor
---

Phase 3 SDK capability parity:

- **`@mushi-mushi/web/otel`** — new subpath: `createBrowserOtelSpanProcessor(mushi, { otelPresent: context })` forwards OTel error spans to Mushi as programmatic reports. Dependency-injection design (caller passes an import from `@opentelemetry/api`) avoids dynamic-import probing that breaks Vite's static analysis. Size-limit gated at ≤5 KB gzip. 16 unit tests.

- **`@mushi-mushi/web/headless`** — new subpath: zero-widget capture bundle. Exports `createHeadlessCapture({ projectId, apiKey })` (programmatic `captureEvent`/`captureException` over fetch, no DOM mutations), browser capture primitives (`createConsoleCapture`, `createNetworkCapture`, `createPerformanceCapture`, etc.), and the OTel bridge. Size-limit gated at ≤35 KB gzip. 17 unit tests. Both subpaths are tree-shakeable and independently published — applications that skip the widget pay zero widget bytes.
