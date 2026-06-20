---
"@mushi-mushi/cli": minor
"@mushi-mushi/core": patch
"@mushi-mushi/react-native": patch
---

Setup UX overhaul: zero-paste `mushi login` browser device-auth, credential error visibility, and docs fixes.

- **CLI**: `mushi login` now implements RFC 8628 browser device-auth (zero copy-paste). Opens the console in the browser, user clicks Approve, CLI receives a session token automatically, then lists/creates a project and saves the API key. `--api-key` flag remains as the CI/non-interactive fallback.
- **Core SDK**: 401/403 responses now emit a one-time `console.error` with a clear credential-failure message and the console URL, instead of silently entering the offline retry queue.
- **React Native**: Same 401/403 credential-failure detection in `MushiProvider.submitReport` — skips enqueue and surfaces the error immediately.
