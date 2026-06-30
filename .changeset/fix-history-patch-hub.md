---
"@mushi-mushi/web": patch
---

Centralize History API patching in a single subscriber hub (`history-patch.ts`) so timeline, discovery, breadcrumbs, rewards, and proactive-triggers no longer stack nested `pushState`/`replaceState` wrappers. Fix `Mushi.destroy()` LIFO teardown order (rewards → breadcrumbs → discovery → timeline).
