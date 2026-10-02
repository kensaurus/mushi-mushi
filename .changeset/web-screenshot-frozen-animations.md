---
"@mushi-mushi/web": patch
---

Screenshots no longer come out blank on pages that animate their content in. Inside the snapshot the browser doesn't run CSS animations, so anything with an entrance animation (a fade-in that starts at opacity 0) was captured at its first frame, and the whole screenshot was transparent and reported as "This browser can't capture the page". The capture now turns animations and transitions off in its copy of the page, so it shows the settled page the reporter is looking at. It also tells Chrome the canvas is read back, which removes a console warning.
