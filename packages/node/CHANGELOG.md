# @mushi-mushi/node

## 0.2.1

### Patch Changes

- 6e01dc7: Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):
  - **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
  - **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
  - **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

  No runtime behaviour changes. No breaking changes for consumers.

- Updated dependencies [6e01dc7]
  - @mushi-mushi/core@0.3.1

## 0.2.0

### Minor Changes

- 81336e9: Initial release — `@mushi-mushi/node` server-side instrumentation SDK.
  - Framework middleware: Express (`/express`), Fastify (`/fastify`), Hono (`/hono`).
  - `attachUnhandledHook()` for `unhandledRejection` / `uncaughtException` → Mushi reports.
  - Automatic W3C Trace Context + `sentry-trace` header propagation for bidirectional Sentry/Datadog correlation.
  - Never throws — transport failures warn once and continue so instrumentation can't take down the host service.

### Patch Changes

- Updated dependencies [81336e9]
  - @mushi-mushi/core@0.3.0
