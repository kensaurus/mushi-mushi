---
"@mushi-mushi/cli": patch
"mushi-mushi": patch
---

The setup wizard's first run is easier:

- No more false "newer version 0.40.2 → 1.37.0" line on every run. The wizard now checks the package you ran (`mushi-mushi`, `create-mushi-mushi`, or the CLI for `mushi init`) against its own latest version, and says nothing when you are on it.
- `--yes` now adds the init snippet to your entry file, the same safe way the interactive run does (a marker block a re-run updates in place, only for plain-import entry files). When it can't, it names the one file to paste the snippet into.
- New `--dry-run`: prints what the wizard would install and write, then stops. No sign-in, no install, no file changes.
- When a run ends with only the app's ingest key (a pasted or `--api-key` key, or a reused one), the wizard says your editor's MCP server needs a key that can read reports, and offers one browser approval to make it (or prints `npx mushi-mushi login --project-id <id>` under `--yes`). `mushi setup` prints the same one command in a non-interactive shell, and no longer asks for the project again when it upgrades the key.
- After the test report, the wizard prints the one call that sends a sample bug from your own app, for your framework, plus `npx mushi-mushi test` for no code change.
