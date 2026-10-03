---
"@mushi-mushi/core": minor
---

Add `@mushi-mushi/core/reporter-channels`: typed calls for the reporter loop v2 routes — the unread badge / next-visit feed (`getUpdates`), one-call mark-read, the report timeline, and the reporter's own email and push opt-in (`getPrefs` / `setPrefs`, `subscribePush`, and `subscribeBrowserPush` for the permission → service worker → subscription flow). The API client gains one `reporterRequest` passthrough that the subpath builds on; the main entry stays inside its size budget. `MushiConfig.notifications.webPush.serviceWorkerPath` and `MushiRuntimeSdkConfig.reporter` (`emailEnabled`, `pushEnabled`, `vapidPublicKey`) are typed.

`@mushi-mushi/core/reporter-ui` also gains the widget rules that web and React Native share:
- `reporterCanSend` / `reporterRequiredLength`: 8 characters by default, 0 with an attachment.
- `reporterChipToReport`: maps a chip to the report category.
- `reporterTimelineEntryText` and `isReporterConversation`: render the timeline.
- `reporterShouldShowToast` / `reporterToastMessage`: the next-visit toast.
- `isPlausibleReporterEmail`: a quick email check.

Receipt, email opt-in and toast copy ships in en/ja/es/th. `MushiNotificationsConfig` is exported (`toast`, `email`, `emailFromIdentity`, `webPush`).
