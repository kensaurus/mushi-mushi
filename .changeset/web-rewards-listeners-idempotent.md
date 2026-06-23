---
"@mushi-mushi/web": patch
---

fix(web): rewards activity listeners are now installed exactly once per page. `initRewards` runs on every `identify()` / `identifyWithToken()` call; previously each call re-wrapped `history.pushState` over the already-wrapped function and re-added the `popstate`/`click`/`MutationObserver` handlers, leaking listeners and double-counting activity/reward events over a session. Re-identifying a user no longer re-installs DOM hooks.
