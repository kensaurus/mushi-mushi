---
'@mushi-mushi/cli': minor
---

Setup is now a zero-copy-paste browser sign-in. `mushi init` (and `npx mushi-mushi` / `npm create mushi-mushi`, which delegate to it) lead with **"Sign in with your browser"** — the RFC 8628 device-auth flow already used by `mushi login`. The console approval page hands the CLI a scoped token, then the wizard lets you pick or create a project and mints the SDK key for you. No more hunting for a Project ID UUID or an API key in the console.

### Why
Users reported the old wizard was confusing: it asked for a Project ID and API key up front with no easy way to know what to paste (the screenshot pain point). The browser path removes both prompts for the common case and mirrors `gh auth login`, `vercel login`, and `stripe login`.

### What changed
- **`mushi init` wizard**: new `acquireCredentials` step. Precedence: explicit `--project-id`/`--api-key` flags (CI) → saved credentials from a prior login (offer to reuse) → **browser sign-in (default)** → manual paste fallback. Any browser-path failure falls back to manual entry; the wizard never hard-fails.
- **`mushi project create`**: rewritten on the shared device-auth flow. Fixes three bugs: it no longer points at a dead hardcoded endpoint, no longer links to a 404 `/sign-up` console URL, and no longer tells you to copy a BYOK-type key (it mints the correct `report:write` SDK ingest key server-side). `--no-browser` prints the URL for headless/SSH; `--name` skips the prompt.
- **`mushi login`**: refactored onto the same shared `device-auth` primitives (DRY) while keeping its terminal UX (a dot per pending poll, precise per-state error messages).
- **New `device-auth.ts` module**: the RFC 8628 client (`startDeviceAuth`, `pollDeviceToken`, `waitForCliToken`, `listProjects`, `createProject`, `mintProjectKey`) is now implemented once and shared across `init`, `login`, and `project create`. Every request carries a 15s timeout so a hung network never wedges setup. Covered by new unit tests.
