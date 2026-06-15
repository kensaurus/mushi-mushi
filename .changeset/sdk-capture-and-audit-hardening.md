---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/react-native': patch
'@mushi-mushi/mcp': patch
'@mushi-mushi/cli': patch
---

Session replay + screenshot annotation capture, client-side payload guarding, and a full-stack audit-hardening pass across the SDK, CLI, and MCP.

## @mushi-mushi/core

- **New:** `checkReportPayloadSize`, `estimateJsonBytes`, `formatBytes`, and `MAX_REPORT_PAYLOAD_BYTES` payload-guard helpers. `checkReportPayloadSize` serializes once and reports a distinct `serializeFailed` outcome (e.g. circular references in metadata) instead of a generic "too large".
- `submitReport` now surfaces a `SERIALIZE_FAILED` error code (separate from `PAYLOAD_TOO_LARGE`) so callers can tell an oversized report apart from one that could not be serialized.
- **Hardening:** the offline retry queue now treats `PAYLOAD_TOO_LARGE` and `SERIALIZE_FAILED` as permanent failures, so a single oversized report can no longer poison-pill the queue and block every later report.

## @mushi-mushi/web

- **New — session replay:** opt-in `capture.replay: 'rrweb' | 'lite' | 'sentry' | 'off'` records a rolling buffer that attaches to the report on submit. rrweb recording masks all text and inputs by default (`maskAllText` + `maskAllInputs`), records continuously from init, and trims the buffer while preserving the most recent full snapshot so replays stay playable. `'off'` is the default.
- **New — screenshot annotation:** the report panel's "Mark up" button opens an interactive overlay (highlight / blur / arrow) so reporters can circle the problem and redact sensitive regions before submitting. The annotation session stays open until the reporter confirms with "Done"; touch strokes now resolve correctly on lift (`touchend`).
- **New — screenshot compression** before upload to keep payloads small.
- **Hardening:** oversized reports are progressively degraded — drop the replay buffer, then the screenshot — before being dropped entirely with a `report:failed` event, so the offline queue is never wedged. The replay capture is now torn down on `Mushi.destroy()` (no observer/listener leak) and guarded against an init/`updateConfig` race that could install a stale capture.

## @mushi-mushi/react-native

- Fix `onReportQueued` / `onReportSynced` callback timing: `onReportQueued` now fires after the report is persisted to the offline queue, and `onReportSynced` fires only when a queued report is actually delivered (wired to the async-storage queue drain) rather than misleadingly firing on direct submission.

## @mushi-mushi/mcp

- Fix `get_reporter_thread`: it now calls the existing `GET /v1/admin/reports/:id/timeline` endpoint (which includes the reporter/admin comment lane plus fix, QA, and status lanes) instead of a non-existent `/comments` route that returned 404.

## @mushi-mushi/cli

- `mushi feedback board` now reads the feature board via `GET /v1/admin/feature-board` with an operator API key (`mcp:read`), fixing the previous 401, and renders real vote counts.
- `mushi doctor --fix` re-runs its checks after applying fixes, so the printed result and exit code reflect the post-fix state.
- Endpoints are normalized consistently (trailing slashes stripped on sub-paths) to prevent double-slash request URLs.
