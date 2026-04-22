---
'@mushi-mushi/adapters': patch
'@mushi-mushi/angular': patch
'@mushi-mushi/capacitor': patch
'@mushi-mushi/cli': patch
'@mushi-mushi/core': patch
'@mushi-mushi/mcp': patch
'@mushi-mushi/mcp-ci': patch
'@mushi-mushi/node': patch
'@mushi-mushi/plugin-jira': patch
'@mushi-mushi/plugin-linear': patch
'@mushi-mushi/plugin-pagerduty': patch
'@mushi-mushi/plugin-sdk': patch
'@mushi-mushi/plugin-sentry': patch
'@mushi-mushi/plugin-slack-app': patch
'@mushi-mushi/plugin-zapier': patch
'@mushi-mushi/react': patch
'@mushi-mushi/react-native': patch
'@mushi-mushi/svelte': patch
'@mushi-mushi/vue': patch
'@mushi-mushi/wasm-classifier': patch
'@mushi-mushi/web': patch
'create-mushi-mushi': patch
'mushi-mushi': patch
---

Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):

- **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
- **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
- **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

No runtime behaviour changes. No breaking changes for consumers.
