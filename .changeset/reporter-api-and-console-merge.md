---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/react': minor
'@mushi-mushi/react-native': minor
'@mushi-mushi/cli': minor
---

Add a cross-platform Reporter API, contributor hall-of-fame, and a headless fix-merge CLI.

## @mushi-mushi/core

- Add the Reporter API to `MushiSDKInstance`: `listMyReports()`, `listMyComments(reportId)`, and `replyToReport(reportId, body)` let an anonymous reporter view and follow up on their own submissions, keyed to the persistent reporter token.
- Add `getHallOfFame(limit?)` plus the matching `MushiApiClient.getHallOfFame()` and the new `MushiHallOfFameEntry` type for the public contributor leaderboard.

## @mushi-mushi/web

- Implement the Reporter API and `getHallOfFame()` on the web SDK instance. All methods fail soft (return `[]` / `null` instead of throwing) when offline or before a reporter token exists, so they are safe to call on first render.

## @mushi-mushi/react

- Expose the Reporter API on the `useMushi()` hook (`listMyReports`, `listMyComments`, `replyToReport`, `getHallOfFame`, `getReputation`, `getTier`) as memoised, render-stable callbacks with no-op fallbacks before the SDK is ready.
- Re-export `MushiReporterReport`, `MushiReporterComment`, `MushiHallOfFameEntry`, `MushiReputationResult`, and `MushiTierResult` for host-app typing.

## @mushi-mushi/react-native

- Add optional in-app screenshot capture via `react-native-view-shot` (declared as an optional peer dependency — no-ops gracefully when not installed).
- Re-export `MushiReporterReport`, `MushiReporterComment`, and `MushiHallOfFameEntry` so React Native host apps can type the Reporter API.

## @mushi-mushi/cli

- Add `mushi fixes merge <fixId> [--method squash|merge|rebase]` to squash-merge a fix PR and mark the linked report Fixed without leaving the terminal (auto-readies draft PRs first).
- Add `mushi fixes refresh-ci <fixId>` to pull the latest GitHub Actions check-run status on demand. Both commands accept `--json` for scripting and require an admin API key with `mcp:write` scope.
