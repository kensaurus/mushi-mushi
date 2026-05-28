---
"@mushi-mushi/core": patch
"@mushi-mushi/cli": patch
"@mushi-mushi/capacitor": patch
---

Fix six edge-case failure paths discovered during the May 27 Copilot code review.

**@mushi-mushi/core**

- Offline queue: permanently evict reports that return HTTP 400, HTTP 422, `INGEST_ERROR`, or `VALIDATION_ERROR` codes — previously one bad report blocked all subsequent retries in the same flush cycle.
- API client: improved error message extraction from non-JSON responses so offline-queue eviction logic receives the structured error code instead of a generic string.

**@mushi-mushi/cli**

- `nudge`: numeric flags (`--min-rating`, `--max-rating`, `--limit`) now validate that values are finite integers in valid ranges; previously NaN propagated silently to the API producing unexpected results.

**@mushi-mushi/capacitor**

- iOS `BreadcrumbCollector`: `maxMessageLength` floor corrected from 50 → 1; the old value silently inflated every breadcrumb message to at least 50 chars, breaking exact-match assertions in downstream tests.
