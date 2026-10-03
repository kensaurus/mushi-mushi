---
"@mushi-mushi/mcp": patch
---

`import_sentry_issues` can now pull a whole Sentry backlog: `sinceDays` (1-90) limits the search to recently seen issues, and `cursor` takes the returned `nextCursor` to fetch the next 10 until it comes back null. `sentryProject` picks another of the project's Sentry projects when one app reports to two (for example a frontend and a backend).
