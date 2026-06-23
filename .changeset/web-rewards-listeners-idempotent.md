---
"@mushi-mushi/web": patch
---

# v1.21.1 — Post-release SDK reliability fixes

- **Rewards listeners install once**: web rewards now wires its route/click/dwell listeners exactly once per page. Previously every `identify()` / `identifyWithToken()` call re-wrapped `history.pushState` and re-added the `popstate`/`click`/`MutationObserver` handlers, leaking listeners and double-counting activity and reward events. Re-identifying a user no longer re-installs DOM hooks.
