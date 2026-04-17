# @mushi-mushi/plugin-linear

## 0.2.0

### Minor Changes

- 7567cee: Plugin marketplace — initial public release.
  - **@mushi-mushi/plugin-sdk**: framework-agnostic plugin runtime with HMAC signature verification, replay protection (delivery-ID dedup), in-memory dedup store, and Express + Hono middleware adapters. Plugin authors register one async function per event name (or a wildcard `'*'` handler) and the SDK handles signature checks, JSON parsing, timeouts, and structured error responses.
  - **@mushi-mushi/plugin-linear**: official Linear adapter — turns `report.created` events into Linear issues with project + label routing.
  - **@mushi-mushi/plugin-pagerduty**: official PagerDuty adapter — escalates `report.dedup_grouped` and severity-tagged events into incidents on the configured service.
  - **@mushi-mushi/plugin-zapier**: official Zapier adapter — exposes Mushi events as a Zapier-compatible webhook source so non-engineers can route reports anywhere Zapier reaches.

### Patch Changes

- Updated dependencies [7567cee]
  - @mushi-mushi/plugin-sdk@0.2.0
