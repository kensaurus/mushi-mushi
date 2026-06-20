---
"@mushi-mushi/web": patch
---

Widget now shows real app/site icons (favicon with initials fallback).

The web widget renders a project/app icon chip via the new
`renderAppIconHtml` / `bindFaviconFallbacks` helpers, using the favicon
resolution exported from `@mushi-mushi/core` (multi-candidate CDN chain that
degrades to project initials when no favicon is available or a generic
placeholder is detected). The report-flow header also shows the host page's
favicon when present. Picks up the matching `@mushi-mushi/core` patch.
