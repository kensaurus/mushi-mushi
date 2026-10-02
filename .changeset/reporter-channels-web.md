---
"@mushi-mushi/web": minor
---

New reporter-loop methods on the Mushi instance: `getReporterUpdates()`, `markReportRead(id)`, `onReporterUpdate(cb)` (draw your own unread badge; it refreshes with the inbox), `getNotificationPrefs()` / `setNotificationPrefs({ email })` (email updates with double opt-in — a confirmation email goes out first, every email has one-click unsubscribe) and `subscribeReporterPush()` (call it from a "Notify me" click; needs `notifications: { webPush: { serviceWorkerPath } }` and push turned on for the project). Nothing is opted in by default; offer email or push only when `/v1/sdk/config` says the project has them.
