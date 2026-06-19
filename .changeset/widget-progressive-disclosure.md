---
"@mushi-mushi/web": minor
"@mushi-mushi/core": patch
---

Widget: progressive disclosure for category list + offline queue delivery guard

- **web**: Category step now shows only the primary "bug" option by default; a "More issue types →" toggle reveals the remaining categories. Back navigation added for `success`, `account`, and `cross-app-reports` steps. Back button now renders with "← Back" label. Panel width 384px→360px and max-height 640px→480px for better fit on smaller viewports.
- **core**: Offline queue no longer retries forever on undeliverable reports. `MAX_DELIVERY_ATTEMPTS = 8` drops a row after 8 transient failures; `MAX_QUEUE_AGE_MS = 24h` hard-evicts stale rows on the next flush, including legacy rows that predate the per-row attempt counter.
