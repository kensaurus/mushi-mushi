---
"@mushi-mushi/react-native": minor
---

`useMushi()` gains `getReporterUpdates()`, `onReporterUpdate(cb)` (refreshed when the app returns to the foreground, so a host feedback band or tab dot can show unread updates) and `getNotificationPrefs()` / `setNotificationPrefs({ email })` for email updates with double opt-in. `markReportRead(id)` is now one request to the v2 mark-read route, falling back to the per-notification routes on an older server.
