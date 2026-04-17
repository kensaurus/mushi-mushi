---
'@mushi-mushi/core': patch
'@mushi-mushi/web': patch
'@mushi-mushi/react': patch
'@mushi-mushi/react-native': patch
'@mushi-mushi/vue': patch
'@mushi-mushi/svelte': patch
'@mushi-mushi/angular': patch
'@mushi-mushi/cli': patch
'@mushi-mushi/mcp': patch
---

Republish all SDK packages with resolved dependency specifiers.

The 0.1.0 tarballs were published with `"@mushi-mushi/core": "workspace:*"` (and similar) baked into `dependencies` because `changeset publish` ran without `changeset version` having rewritten the workspace protocol. Every external `npm install` failed with `EUNSUPPORTEDPROTOCOL`.

This patch republishes every SDK package with real semver ranges in its dependencies. A new pre-publish guard (`scripts/check-workspace-protocol.mjs`) and post-publish verifier (`scripts/verify-published-tarballs.mjs`) prevent recurrence.
