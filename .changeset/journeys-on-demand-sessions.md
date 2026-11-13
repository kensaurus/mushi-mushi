---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
---

New `trackSessions: 'on-demand'` for the Journey optimizer. In this mode the SDK sends no session, heartbeat or page-view request until you ask for one. You can open a recording window on the console's Journeys page (for 1 hour, 1 day or 1 week, for 10%, 50% or all visitors), or open your app with `?mushi_journeys=1` to record your own tab. Each device is drawn into or out of the sample once and keeps that result, so a visitor is never half recorded. The check uses the runtime config the SDK already loads, so outside a window it adds no request. `true` (the default) and `false` work as before.
