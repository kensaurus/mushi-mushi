---
"@mushi-mushi/plugin-slack-app": patch
---

Redesign the `report.classified` Slack notification for clearer triage at a glance.

- Severity-led header (`🔴 High bug report`) instead of a category-led one.
- Report summary rendered as a blockquote, with a graceful `_No summary provided_` fallback.
- Two-column field grid for **Severity**, **Type**, **AI confidence**, and **Tags** (when present).
- Clearer action labels: **Open in Console** and a **Dispatch auto-fix?** confirmation.
- Footer context line with the short report id, and a trailing divider so stacked alerts read cleanly in a busy channel.
