---
"@mushi-mushi/admin": patch
"@mushi-mushi/brand": patch
---

Fix Copilot review follow-ups from PR #255: `guideLiveOverlay` metrics now pluralize singular counts correctly ("1 error" instead of "1 errors"), and `build-tokens.mjs` now emits primitive CSS variables before semantic aliases so `--mushi-font-mono`'s intended fallback isn't silently overridden by its own primitive.
