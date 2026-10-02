---
"@mushi-mushi/react-native": minor
---

`useMushi()` gains `getReporterUpdates()`, `onReporterUpdate(cb)` (refreshed when the app returns to the foreground, so a host feedback band or tab dot can show unread updates) and `getNotificationPrefs()` / `setNotificationPrefs({ email })` for email updates with double opt-in. `markReportRead(id)` is now one request to the v2 mark-read route, falling back to the per-notification routes on an older server.

The report sheet reaches web parity:
- **Free text first.** Type chips are optional. "Idea" files a feature request.
- **Easier to send.** Send enables after a few words (`widget.minDescriptionLength`, default 8), or right away when a screenshot is attached.
- **Timeline thread.** The thread shows the report's timeline: what happened and when, in the reporter's language, with the developer's replies.
- **Reduce Motion.** The sheet opens and closes instantly when Reduce Motion is on.
- **Receipt.** After sending, the form becomes a receipt with "Track it" and "Done".
- **Email opt-in.** When the app offers email updates, the receipt asks for an address. It is never pre-ticked, and a confirmation email goes out first.
- **Return toast.** A short "The developer replied" / "Your bug is fixed" toast appears when the app returns to the foreground: once per session, once a day, and only on devices that sent a report. Turn it off with `notifications: { toast: false }`.
