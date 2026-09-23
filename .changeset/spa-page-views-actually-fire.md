---
'@mushi-mushi/core': patch
'@mushi-mushi/web': patch
---

Record SPA page views. The session tracker's history patch decided push-vs-replace with `original === history.pushState` *inside* the wrapper — always false once the wrapper is installed — so no `page_view` was ever emitted from a `pushState` navigation. In `@mushi-mushi/web` it was doubly dead: the shared history patch captures the native `History.prototype.pushState` and replaces `history.pushState`, discarding core's wrapper entirely. Two of five live projects had zero `session_page_views` across more than a thousand sessions each.

- `@mushi-mushi/core`: the navigation kind is fixed at wrap time; new `patchHistory: false` option for hosts that own the history patch and call `trackPageView()` themselves.
- `@mushi-mushi/web`: initialises the tracker with `patchHistory: false` and reports `pushState` / `popstate` through its own shared history subscriber, torn down on `destroy()`.

No API change for hosts. Apps that already call `trackPageView()` from a router hook are unaffected: the web layer only reports history navigations, and a router hook that fires on the same navigation would now double-count — pass `trackSessions: false` or drop the hook.
