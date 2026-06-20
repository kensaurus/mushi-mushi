---
"@mushi-mushi/cli": minor
"mushi-mushi": patch
"create-mushi-mushi": patch
"@mushi-mushi/core": patch
"@mushi-mushi/react-native": patch
---

Setup UX overhaul: zero-copy-paste browser sign-in is now the default everywhere.

The #1 reported setup pain was the first-run wizard asking users to hunt down a
Project ID (UUID) and an API key in the console and paste them in. The
RFC 8628 browser device-auth that previously only lived in `mushi login` is now
the recommended path across the whole CLI, matching `gh auth login`,
`vercel login`, and `stripe login`. Manual paste is kept only as an
expert/self-hosted/CI fallback.

- **`mushi init` / `npx mushi-mushi` / `npm create mushi-mushi`**: the wizard now
  opens a browser, you click **Approve**, and it picks or creates a project and
  mints the SDK key for you — no UUID, no key paste. Falls back to manual entry
  if the browser flow can't complete. `--project-id` / `--api-key` still skip the
  prompts for CI.
- **`mushi login`**: unchanged UX, now built on the same shared device-auth
  client.
- **`mushi project create`**: rewritten to use browser sign-in too. Fixes three
  bugs in the old paste-based flow — a dead `api.mushimushi.dev` endpoint
  default, a `/sign-up` link that 404s, and an instruction to copy a BYOK key
  from Settings → API Keys (the wrong key type for SDK ingest).
- **New shared module** `device-auth.ts` (start → poll → list/create project →
  mint key) so the flow is implemented and tested once.
- **Core SDK**: 401/403 responses now emit a one-time `console.error` with a
  clear credential-failure message and the console URL, instead of silently
  entering the offline retry queue.
- **React Native**: same 401/403 credential-failure detection in
  `MushiProvider.submitReport` — skips enqueue and surfaces the error
  immediately.
