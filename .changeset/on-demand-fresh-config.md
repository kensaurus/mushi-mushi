---
"@mushi-mushi/web": patch
---

`trackSessions: 'on-demand'` now decides from the freshly fetched runtime config only. The cached copy the SDK applies on load could still hold a recording window that had been stopped in the console, so a returning visitor kept recording until the window's original end time. If the fetch fails, nothing is recorded.
