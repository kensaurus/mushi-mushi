---
'@mushi-mushi/web': patch
---

Render the project's app icon in the widget using a favicon-candidate fallback chain (`renderAppIconHtml` + `bindFaviconFallbacks`), and show the host page's favicon in the report-flow header when available. Generic/placeholder favicons are detected and skipped in favor of clean initials, so the widget never shows a broken or default browser icon.

This ships the app-icon rendering that already landed in source but was never published (the web package was not version-bumped in the previous release).
