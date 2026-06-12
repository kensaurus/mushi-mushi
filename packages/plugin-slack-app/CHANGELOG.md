# @mushi-mushi/plugin-slack-app

## 0.2.6

### Patch Changes

- ae878a1: Redesign the `report.classified` Slack notification for clearer triage at a glance.
  - Severity-led header (`🔴 High bug report`) instead of a category-led one.
  - Report summary rendered as a blockquote, with a graceful `_No summary provided_` fallback.
  - Two-column field grid for **Severity**, **Type**, **AI confidence**, and **Tags** (when present).
  - Clearer action labels: **Open in Console** and a **Dispatch auto-fix?** confirmation.
  - Footer context line with the short report id, and a trailing divider so stacked alerts read cleanly in a busy channel.

- Updated dependencies [ae878a1]
  - @mushi-mushi/plugin-sdk@0.7.0

## 0.2.5

### Patch Changes

- 144906a: Integrations & QA notification wave, plus correctness/security hardening.

  **Web SDK** — Added opt-in W3C trace-context propagation: when `capture.tracePropagation.enabled` is set with a `corsUrls` allowlist, outbound fetch requests carry `traceparent` and `x-mushi-session` headers and the generated `traceId` is recorded on the network entry, so frontend reports correlate with backend spans. Fixed a wiring bug where the config and session id were never passed through to the network capture, leaving the feature unreachable.

  **Node SDK** — New Express/Hono-style middleware (`@mushi-mushi/node`) that reads `traceparent` / `x-mushi-session` and posts backend spans to `/v1/ingest/spans` for trace correlation.

  **CLI** — New `integrations`, `slack`, `qa`, `tdd`, and `keys` commands. `mushi doctor --qa-stories` now queries the real `/qa-coverage` endpoint (the previous `/qa-stories` list path returned 404).

  **MCP** — New TDD and notification tools. `get_qa_story_run` now resolves the run via the runs list instead of a non-existent single-run route.

  **plugin-slack-app** — Manifest OAuth redirect URL and scopes corrected.

  **Security** — Slack OAuth `state` is now HMAC-signed and verified (with expiry and constant-time comparison) on the callback, closing a cross-tenant token-write vector, and the OAuth `redirect_uri` now points at the registered Supabase functions callback. (Server-side; ships via the edge-function deploy.)

## 0.2.4

### Patch Changes

- Updated dependencies [0c66aa9]
  - @mushi-mushi/plugin-sdk@0.6.0

## 0.2.3

### Patch Changes

- Updated dependencies
  - @mushi-mushi/plugin-sdk@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [84118af]
  - @mushi-mushi/plugin-sdk@0.4.0

## 0.2.1

### Patch Changes

- 6e01dc7: Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):
  - **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
  - **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
  - **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

  No runtime behaviour changes. No breaking changes for consumers.

- Updated dependencies [6e01dc7]
  - @mushi-mushi/plugin-sdk@0.3.1

## 0.2.0

### Minor Changes

- 81336e9: Wave G3 — plugin marketplace deepens from webhooks to first-class apps.
  - `@mushi-mushi/plugin-sdk`: runtime Zod-like event envelope validation (`event-schema`) and a `mushi-plugin` dev CLI with `simulate | sign | verify` for local plugin development.
  - `@mushi-mushi/plugin-jira` (new): Atlassian OAuth 2.0 (3LO) + PKCE install flow, `JiraClient` for create / transition / comment, bidirectional handler that maps Mushi events (`report.created`, `status.changed`, `fix.applied`) to Jira issue lifecycle.
  - `@mushi-mushi/plugin-slack-app` (new): Slack App manifest, request-signature verification, OAuth v2 install, `/mushi` slash command router (replaces the legacy incoming-webhook-only plugin).

### Patch Changes

- Updated dependencies [81336e9]
  - @mushi-mushi/plugin-sdk@0.3.0
