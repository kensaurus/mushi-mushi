---
"@mushi-mushi/web": patch
---

`installActivityListeners` no longer treats `history.replaceState` as a route change for `screen_view_unique_per_day` activity tracking. Frameworks like Next.js shallow routing call `replaceState` heavily, and counting it would widen the activity signal surface beyond the original rewards contract (pre-history-hub behavior). Only `pushState` and `popstate` are tracked.
