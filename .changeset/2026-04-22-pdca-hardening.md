---
"@mushi-mushi/web": minor
"@mushi-mushi/core": minor
"@mushi-mushi/react": minor
"@mushi-mushi/vue": minor
"@mushi-mushi/svelte": minor
"@mushi-mushi/angular": minor
"@mushi-mushi/react-native": minor
"@mushi-mushi/capacitor": minor
"@mushi-mushi/node": minor
"mushi-mushi": minor
---

Full-PDCA dogfood hardening wave (2026-04-22).

Web SDK:
- New `@mushi-mushi/web/test-utils` entry-point exposing `triggerBug()`,
  `openReport()`, and `waitForQueueDrain()` for deterministic Playwright
  round-trips. Import from `@mushi-mushi/web/test-utils` — zero cost at
  runtime for production bundles.
- Tightened size-limit budget to 15 KB gzipped (previously 30 KB
  uncompressed). No API changes.

Core SDK:
- No code changes; bumped for consistency with the `web` SDK so
  downstream frameworks pick up the new test-utils exports transitively.

Framework SDKs (react / vue / svelte / angular / react-native /
capacitor / node):
- No code changes. Coupled minor bump so the workspace stays on a single
  MAJOR.MINOR track; patch-only drift across adapters has historically
  caused dependency-resolution confusion for customers.

Launcher:
- Rewired the Claude Code agent adapter behind the new
  `MUSHI_ENABLE_CLAUDE_CODE_AGENT=1` flag and wired it up to the local
  `claude` CLI (binary path overridable via `MUSHI_CLAUDE_CODE_BIN`).
  The README "Status" column now reflects "working — opt-in".
