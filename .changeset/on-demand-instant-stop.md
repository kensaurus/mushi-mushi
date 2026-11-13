---
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
---

Stopping a Journeys recording window now takes effect on the next page load. With `trackSessions: 'on-demand'` the SDK reads its settings past the browser's HTTP cache, which could keep serving a stopped window for up to about 6 minutes. Apps on the default setting keep the cached read. The core bundle budget goes from 25.9 to 26.0 kB for this option.
