---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
---

Add config-driven custom categories to the Mushi SDK.

- `MushiWidgetConfig.categories` accepts an array of `MushiCustomCategory` objects, each with an `id`, `label`, optional `description`, `intents`, `icon`, and `baseCategory` mapping to a built-in `MushiReportCategory`.
- When `categories` is set, the widget renders the host-defined list instead of the default built-in categories.
- Custom categories with `intents` show the intent selection step; those without skip straight to the details step.
- `MushiReport.userCategory` carries the raw custom category id through to the server for storage in `reports.user_category`.
- `openWith` and `report` deep-link APIs now accept `MushiReportCategory | string` so host apps can pre-select a custom category.
- `MushiCustomCategory` is now exported from `@mushi-mushi/core`.
