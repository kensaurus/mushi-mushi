---
"@mushi-mushi/core": minor
---

Add `@mushi-mushi/core/reporter-channels`: typed calls for the reporter loop v2 routes — the unread badge / next-visit feed (`getUpdates`), one-call mark-read, the report timeline, and the reporter's own email and push opt-in (`getPrefs` / `setPrefs`, `subscribePush`, and `subscribeBrowserPush` for the permission → service worker → subscription flow). The API client gains one `reporterRequest` passthrough that the subpath builds on; the main entry stays inside its size budget. `MushiConfig.notifications.webPush.serviceWorkerPath` and `MushiRuntimeSdkConfig.reporter` (`emailEnabled`, `pushEnabled`, `vapidPublicKey`) are typed.
