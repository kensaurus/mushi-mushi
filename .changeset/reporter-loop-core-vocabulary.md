---
"@mushi-mushi/core": minor
---

Add `@mushi-mushi/core/reporter-ui`, the one reporter-facing vocabulary for every SDK widget. `reporterStatus(report, locale)` maps all 14 internal report statuses onto eight end-user states ("Received", "Looking into it", "Fix in progress", "Fixed in v1.4", "Waiting on you", …) with the duplicate-group and feature-request variants, and never shows a raw status. `reporterTimelineText(kind, params, locale)` renders thread events from fixed templates, so internal category and severity never reach a reporter. Copy ships in English, Japanese, Spanish and Thai. It is a separate subpath, so the size of the main entry is unchanged.
