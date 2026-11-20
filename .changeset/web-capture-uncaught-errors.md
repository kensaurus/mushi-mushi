---
"@mushi-mushi/web": patch
---

Reports now include uncaught errors and unhandled promise rejections in their console log. An exception thrown in an event handler never passes through `console.*`, so it was missing from the report and the diagnosis even when it was the cause.
