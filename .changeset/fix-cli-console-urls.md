---
"@mushi-mushi/cli": patch
"mushi-mushi": patch
"create-mushi-mushi": patch
---

Fix broken console URLs in CLI — setup wizard now opens the correct admin path

The `npx mushi-mushi` setup wizard and `mushi login` were sending users to
`https://kensaur.us/mushi-mushi/projects` (missing the `/admin` segment), which
times out and does not resolve. All hardcoded console URLs in `cli-shared.ts`,
`commands/diagnostics.ts`, `commands/project.ts`, and `index.ts` now route
through the `consoleUrl()` / `resolveConsoleUrlSync()` helpers that include the
correct `/admin` base path. The published dist previously predated this fix.

Also corrects the `index.ts` help text: `MUSHI_API_KEY` is a `report:write`
ingest key (from Onboarding → Verify), not a Settings → API Keys BYOK key.
