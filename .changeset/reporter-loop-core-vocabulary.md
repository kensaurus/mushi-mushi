---
"@mushi-mushi/core": minor
---

Add `@mushi-mushi/core/reporter-ui`, the one reporter-facing vocabulary for every SDK widget. `reporterStatus(report, locale)` maps all 14 internal report statuses onto eight end-user states ("Received", "Looking into it", "Fix in progress", "Fixed in v1.4", "Waiting on you", …) with the duplicate-group and feature-request variants, and never shows a raw status. `reporterTimelineText(kind, params, locale)` renders thread events from fixed templates, so internal category and severity never reach a reporter. Copy ships in English, Japanese, Spanish and Thai. It is a separate subpath, so the size of the main entry is unchanged.

`MushiReporterReport` gains the reporter-safe v2 fields (`title`, `user_category`, `page`, `app_version`, `screenshot_thumb_url`, `group_bucket`, `closed_reason`, `fixed_in_version`, `awaiting_reporter`, `followed`, `last_event_at`, `last_event_preview`); `category` and `severity` become optional and deprecated, because the server no longer sends them to reporters.
