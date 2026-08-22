---
"@mushi-mushi/server": patch
---

Reports list API accepts `session` and `end_user` query filters so the console can browse all reports from one SDK session or one identified end user (reports.session_id / reports.end_user_id). Admin: the report-detail Session chip now deep-links to the session-filtered list, and the Reporter chip filters by the durable end-user id when the reporter is identified (falls back to the per-device token hash for anonymous reporters); both filters render removable context chips on /reports.
