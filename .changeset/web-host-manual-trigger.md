---
"@mushi-mushi/web": patch
---

A host `trigger: 'manual'` or `'attach'` now keeps its launcher when the console sets one. A console `banner`, `auto` or `edge-tab` used to replace it, so an app that draws its own "Report a bug" button got a second, SDK-drawn banner. Only an explicit console `hidden` still applies, so the console can still hide the widget.
