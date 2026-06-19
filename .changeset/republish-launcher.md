---
"mushi-mushi": patch
---

Republish the `npx mushi-mushi` launcher so it tracks the latest `@mushi-mushi/cli` again.

The launcher was accidentally added to the Changesets `ignore` list on 2026-06-15 (PR #181), which froze it at `0.7.9` (pinned to `@mushi-mushi/cli@^0.17.0`) while the CLI kept shipping through `0.18.x`. As a result `npx mushi-mushi` users were stuck a week behind. Un-ignoring the package restores the automatic `workspace:^` patch cascade from the CLI, and this changeset forces an immediate republish that re-pins the launcher to the current CLI range.
