---
"@mushi-mushi/plugin-sdk": minor
---

Add the `report.reporter_replied` event: the person who filed a report answered in its thread. `data.comment.body` is their text, which comes from a public widget, so treat it as untrusted input.
