---
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
"@mushi-mushi/capacitor": patch
---

Fix runtime SDK config delivery and native mobile trigger behavior.

- Add public SDK runtime config endpoints, admin persistence, cache headers,
  and typed runtime config support.
- Let web capture modules follow runtime config changes after startup.
- Add native user/metadata/category context wiring and harden mobile overlay
  lifecycle behavior.
- Add Swift Package Manager support for the Capacitor iOS plugin.
