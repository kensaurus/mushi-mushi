---
'@mushi-mushi/cli': patch
---

Harden the browser sign-in setup path with fixes from automated code review.

- **Resilient device-auth polling**: `waitForCliToken` (and the `mushi login` poll loop) now tolerate up to 5 consecutive transient poll errors (network blips / 5xx), resetting on any successful poll, instead of aborting a sign-in the moment one request drops. Denial and expiry remain terminal.
- **`mushi init --yes` keeps browser sign-in**: `--yes` no longer forces the legacy manual Project ID + API key paste; it goes straight to the (default) browser sign-in and only falls back to manual entry if that fails.
- **`mushi project create` honors a saved endpoint**: it now resolves the endpoint as `--endpoint` → `MUSHI_API_ENDPOINT` → saved `mushi config endpoint` → Cloud default, so self-hosted users aren't silently redirected to Mushi Cloud.
- **Safer browser open**: `openInBrowser` validates the URL is http(s) and launches via `spawn` with an argument array instead of building a shell command string, removing the command-injection surface (CodeQL).
- **Linear trailing-slash trim**: `normalizeConsoleBase` no longer uses a backtracking `/\/+$/` regex (ReDoS / CodeQL polynomial-regex alert).
- **`mushi connect` flag clarity**: `--write-env` / `--wire-ide` now actually force their action on (overriding a prior `--no-env` / `--no-ide`) instead of being silent no-ops.
