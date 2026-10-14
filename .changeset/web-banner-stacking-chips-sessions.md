---
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
---

`bannerConfig.zIndex` now works. The widget's host element used to sit at z-index 99999 and capped everything inside it, so the banner covered your own sheets and dialogs whatever number you gave it. Set it below your overlays (for example `130` under a `200` sheet) and they cover the banner. The launcher and panel keep their own `zIndex` (default 99999, panel one above).
Report types you pass in `categories` with a built-in id (`slow`, `visual`, `confusing`) now relabel that chip instead of showing a second copy of it after "More…". "More…" only appears when there are other types to show.
The session tracker sends far fewer requests. Opening and closing a sheet that pushes a history entry on the same page no longer counts as a page view, closing a tab sends one `session_end` instead of two, and heartbeats pause while the tab is hidden. One minute of reading went from about 10 requests to 2. Session durations are measured the same way as before.
