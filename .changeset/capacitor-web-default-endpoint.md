---
'@mushi-mushi/capacitor': patch
---

The web fallback (`ionic serve`, browser previews) now sends reports to the hosted Mushi API when `configure()` has no `endpoint`, the same default as `@mushi-mushi/web` and the README. It used to leave the client unset, so every `report()` threw "endpoint not configured". Set `endpoint` only when self-hosting.
