# @mushi-mushi/plugin-slack-app

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
