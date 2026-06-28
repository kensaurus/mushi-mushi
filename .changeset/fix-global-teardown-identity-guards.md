---
"@mushi-mushi/web": patch
---

Fix `Mushi.destroy()` leaving stale global wrappers after teardown. `history.pushState`, `globalThis.fetch`, and `console.error/warn` are now restored with an identity check (only unwrap if our wrapper is still installed), preventing clobbering of Sentry, Datadog, or other instrumentation that wrapped the same globals after Mushi. Teardown order is now LIFO (breadcrumbs before timeline) to correctly unwind the wrapper chain.
