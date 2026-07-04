---
'@mushi-mushi/cli': minor
---

Browser sign-in failures are no longer silent, and `mushi doctor --auth` diagnoses the handshake.

- `listProjects` / `mintProjectKey` now throw a typed `DeviceAuthRequestError` (with HTTP status and the server's message, after one automatic retry on transient failures) instead of returning `[]` / `null`. An API outage can no longer masquerade as "no projects yet" and silently drop you back to manual key entry — the exact "browser says CLI connected! but the terminal returned to the prompts" failure users reported.
- Every fallback to manual entry now prints why, plus a pointer to `npx mushi-mushi doctor --auth`.
- New `mushi doctor --auth` check group: device-auth route reachability (state-free probe), system clock skew vs the server (skewed clocks expire sign-in codes), and saved-credential validity via whoami.
- The wizard emits a `wizard_env_written` setup-funnel event (fire-and-forget, opt out with `MUSHI_NO_TELEMETRY=1`) so incomplete-setup drop-off is visible end-to-end.
