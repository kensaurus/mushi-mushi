---
"@mushi-mushi/cli": patch
"@mushi-mushi/web": patch
---

## CLI browser sign-in

- Two-phase token claim: browser waits until the CLI actually picks up the token (`GET /device/status`), fixing "browser says connected, terminal stuck"
- Per-machine `client_id` stored in `~/.config/mushi/config.json`; a new login on the same machine supersedes older pending approvals
- Token poll retries on **429** and **408** automatically
- Re-run validates saved credentials via `GET /v1/sync/whoami` before reinstalling

## SDK runtime config & widget

- Single server normalizer (`_shared/sdk-config.ts`) — explicit-only emission so console defaults cannot clobber host-wired banner trigger or capture flags
- Client `mergeRuntimeConfig()` preserves host `trigger: 'banner'` when runtime sends default `launcher: 'auto'`
- Capture flags merge key-by-key; only console-explicit values override host init
- Report description/email/reply drafts persist across widget re-renders
- Screenshot and element-picker buttons hide when unavailable; inline error when capture fails

## Admin console

- Shared `runStatusChipTone()` for status chips across pages
- CLI auth page shows waiting → connected based on actual token claim (stale-tab help after 45s)
